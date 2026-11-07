/**
 * @file @font-face CSS with the fonts inlined as base64, for SVG export.
 *
 * A font file referenced by URL does not load when the SVG is opened as an <img> or offline; a
 * data: URI does. Two ways to get a small file from Google Fonts:
 *   'text'   CSS2 `text=` → one font cut down to exactly the characters used (smallest; the SVG is not
 *            meant to be re-typed with other characters)
 *   'subset' the normal CSS2 answer is one block per script subset (latin, latin-ext, cyrillic …,
 *            each with a unicode-range); keep only the blocks the text needs (a bit bigger, editable
 *            for any text in those scripts). CSS2 has no `subset=` parameter — this is that idea
 *            done on our side.
 * Google fonts can also be LINKED (an @import of the CSS2 URL — works when the SVG is opened as a
 * page, not when it is used as an <img>). Local fonts are referenced by name by default; embedding
 * puts the whole font file in the SVG — their licences (Arial, Segoe UI …) often forbid that, which is
 * why it is an explicit choice and carries a warning.
 */

import type { Shape, TextShape } from '../utils/types';
import { codePointsOf, rangeMatches, textParam, cssUrl, type FaceRule, type Style } from './googleCss';
import { fetchStyle, fontFileBytes } from './google';
import { resolveSource } from './sources';
import { googleName, localFacesOf, localHasFiles } from './registry';
import { pickFace, localFontBytes } from './local';
import type { SvgSettings } from '../utils/exportSettings';

export type EmbedStrategy = 'text' | 'subset';
export interface EmbedResult { css: string; warnings: string[]; }

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function visibleTexts(shapes: readonly Shape[], out: TextShape[] = []): TextShape[] {
  for (const s of shapes) {
    if (!s.visible) continue;
    if (s.type === 'group') visibleTexts(s.children, out);
    else if (s.type === 'text') out.push(s);
  }
  return out;
}

const mime = (r: FaceRule) => (r.format === 'woff2' ? 'font/woff2' : r.format === 'woff' ? 'font/woff' : 'font/ttf');
const formatOf = (r: FaceRule) => (r.format === 'truetype' ? 'truetype' : r.format ?? 'woff2');

async function faceCss(family: string, r: FaceRule, keepRange: boolean): Promise<string> {
  const data = toBase64(new Uint8Array(await fontFileBytes(r.url)));
  return `@font-face { font-family: '${family.replace(/'/g, '')}'; font-style: ${r.style}; font-weight: ${r.weight}; `
    + `src: url(data:${mime(r)};base64,${data}) format('${formatOf(r)}');`
    + `${keepRange && r.unicodeRange ? ` unicode-range: ${r.unicodeRange};` : ''} }`;
}

export interface FontEmbedOptions { google: SvgSettings['google']; local: SvgSettings['local']; }
const DEFAULT_OPTIONS: FontEmbedOptions = { google: { include: 'embedded', coverage: 'used' }, local: { include: 'reference' } };

const sfntKind = (b: Uint8Array): 'truetype' | 'opentype' | 'collection' | null => {
  const tag = String.fromCharCode(b[0], b[1], b[2], b[3]);
  if (tag === 'ttcf') return 'collection';
  if (tag === 'OTTO') return 'opentype';
  if (tag === 'true' || (b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0)) return 'truetype';
  return null;
};

/**
 * CSS for the fonts the visible texts use (families keep the name the <text> elements refer to).
 * `opts` may also be the old strategy string: 'text' = Google used glyphs, 'subset' = Google full subsets.
 */
export async function embedFontCss(shapes: readonly Shape[], opts: FontEmbedOptions | EmbedStrategy = DEFAULT_OPTIONS): Promise<EmbedResult> {
  const o: FontEmbedOptions = typeof opts === 'string'
    ? { ...DEFAULT_OPTIONS, google: { include: 'embedded', coverage: opts === 'text' ? 'used' : 'full' } }
    : opts;
  const warnings: string[] = [];
  const need = new Map<string, { family: string; want: Style; cps: Set<number> }>();
  for (const t of visibleTexts(shapes)) {
    const want: Style = { weight: t.fontWeight, italic: t.fontStyle === 'italic' };
    const key = `${t.fontFamily}|${want.weight}|${+want.italic}`;
    const e = need.get(key) ?? { family: t.fontFamily, want, cps: new Set<number>() };
    for (const c of codePointsOf((t.content ?? '').replace(/[\r\n]/g, ''))) e.cps.add(c);
    need.set(key, e);
  }

  const imports: string[] = [];
  const blocks: string[] = [];
  const seen = new Set<string>();
  const noted = new Set<string>();
  const note = (key: string, msg: string) => { if (!noted.has(key)) { noted.add(key); warnings.push(msg); } };
  const linked = new Map<string, { name: string; styles: Style[]; cps: Set<number> }>();     // family → what to put in its @import

  for (const { family, want, cps } of need.values()) {
    const source = await resolveSource(family);
    if (source === 'generic') continue;
    if (source === 'unknown') { note(family, `"${family}" is not a Google font and not installed here, so it could not be embedded.`); continue; }

    if (source === 'local') {
      if (o.local.include === 'reference') continue;                 // by name only: the viewer needs it installed
      if (!localHasFiles()) { note(family, `This browser does not let pages read font files, so "${family}" stays a reference (viewers need it installed).`); continue; }
      const hit = pickFace(localFacesOf(family), want.weight, want.italic);
      if (!hit) { note(family, `"${family}" was not found among the local fonts.`); continue; }
      try {
        const bytes = new Uint8Array(await localFontBytes(hit.face));
        const kind = sfntKind(bytes);
        if (!kind || kind === 'collection') { note(family, `"${family}" is stored as a font collection (.ttc) and cannot be embedded; it stays a reference.`); continue; }
        const key = `${hit.face.postscriptName}|${want.weight}|${+want.italic}`;
        if (seen.has(key)) continue;
        seen.add(key);
        blocks.push(`@font-face { font-family: '${family.replace(/'/g, '')}'; font-style: ${want.italic ? 'italic' : 'normal'}; font-weight: ${want.weight}; `
          + `src: url(data:font/${kind === 'opentype' ? 'otf' : 'ttf'};base64,${toBase64(bytes)}) format('${kind}'); }`);
      } catch (e) {
        note(family, `"${family}" could not be embedded: ${(e as Error).message}`);
      }
      continue;
    }

    // Google font
    const name = googleName(family)!;
    try {
      if (o.google.include === 'linked') {
        const r = await fetchStyle(name, want);                       // resolves the style that really exists (a missing one would break the whole URL)
        if (r.approximated) note(`${family}|style`, `${family} has no ${want.weight === 700 ? 'bold' : want.weight === 400 ? 'regular' : want.weight}${want.italic ? ' italic' : ''} style; the nearest one is linked.`);
        const e = linked.get(name) ?? { name, styles: [], cps: new Set<number>() };
        if (!e.styles.some(x => x.weight === r.actual.weight && x.italic === r.actual.italic)) e.styles.push(r.actual);
        for (const c of cps) e.cps.add(c);
        linked.set(name, e);
        continue;
      }
      const used = o.google.coverage === 'used';
      const text = used ? textParam(cps) : null;
      const r = await fetchStyle(name, want, text ?? undefined);
      const useRange = text === null;                                 // whole subsets: keep unicode-range, drop unneeded blocks
      const rules = useRange ? r.rules.filter(x => rangeMatches(x.unicodeRange, cps)) : r.rules;
      if (r.approximated) note(`${family}|style`, `${family} has no ${want.weight === 700 ? 'bold' : want.weight === 400 ? 'regular' : want.weight}${want.italic ? ' italic' : ''} style; the nearest one is embedded.`);
      for (const rule of rules) {
        if (seen.has(rule.url + rule.weight + rule.style)) continue;
        seen.add(rule.url + rule.weight + rule.style);
        blocks.push(await faceCss(name, rule, useRange));
      }
    } catch {
      note(family, `"${family}" could not be ${o.google.include === 'linked' ? 'linked' : 'embedded'} (Google Fonts is unreachable); the SVG text will use the viewer's fonts.`);
    }
  }

  for (const e of linked.values()) {
    const text = o.google.coverage === 'used' ? textParam(e.cps) : null;
    imports.push(`@import url('${cssUrl([{ family: e.name, styles: e.styles }], { text: text ?? undefined, display: 'swap' })}');`);
  }
  return { css: [...imports, ...blocks].join('\n'), warnings };
}
