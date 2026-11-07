/**
 * @file The font for outlining a text shape (text → path), from wherever it is available.
 *
 *   Google font  → CSS2 request with text=<the characters used>  → ONE tiny woff2 with exactly those
 *                  glyphs (any script the font covers) → fontkit.
 *   Local font   → Local Font Access: FontData.blob() → fontkit.
 *   anything else → FontUnavailable with a message that says what to do; the text is left untouched.
 *
 * Variable fonts: one parsed instance per (family, style, size) — the weight and optical-size axes are set per instance.
 */

import type { Font } from 'fontkit';
import type { Style } from './googleCss';
import { codePointsOf, textParam } from './googleCss';
import { fetchStyle, fontFileBytes, FontNotFound } from './google';
import { parseFont } from './sfnt';
import { pickFace, localFontBytes, supportsLocalFonts } from './local';
import { googleName, localFacesOf, localHasFiles, localName } from './registry';
import { resolveSource } from './sources';
import { bundledFamily, bundledOutlineFonts } from './bundled';
import { bundledGeneric } from './generic';
import { fontStyles, nearestWeight } from './styles';
import { get } from 'svelte/store';
import { localFonts } from './state';

export class FontUnavailable extends Error {}

export interface OutlineRequest {
  fontFamily: string; fontWeight: number; fontStyle: 'normal' | 'italic';
  fontSize: number; content?: string;
}
export interface OutlineFont {
  font: Font; family: string; source: 'google' | 'local' | 'bundled';
  /** More fonts of the same family for characters `font` lacks (the other script subsets of a bundled font). */
  extras: Font[];
  /** The weight and slant the font really has; text-to-path synthesizes what is missing (bold, italic). */
  weight: number;
  italic: boolean;
  /** The wanted weight / slant did not exist (or was outside the variable range): the nearest style was used. */
  approximated: boolean;
}

const codePointsFor = (t: OutlineRequest, extra?: Iterable<number>) => {
  const s = codePointsOf((t.content ?? '').replace(/[\r\n]/g, ''));
  if (extra) for (const c of extra) s.add(c);
  return s;
};

async function googleOutline(name: string, want: Style, size: number, chars: Set<number>): Promise<OutlineFont> {
  const text = textParam(chars);
  if (chars.size && text === null) {
    throw new FontUnavailable(`This text uses too many different characters (${chars.size}) to be outlined from Google Fonts in one request.`);
  }
  const r = await fetchStyle(name, want, text ?? undefined);
  const rule = r.rules.find(x => x.format === 'woff2') ?? r.rules[0];
  const p = await parseFont(await fontFileBytes(rule.url), { wght: r.actual.weight, opsz: size });
  return { font: p.font, family: r.family, source: 'google', extras: [], weight: p.wght ?? r.actual.weight, italic: r.actual.italic,
    approximated: r.approximated || p.clamped };
}

async function localOutline(name: string, want: Style, size: number): Promise<OutlineFont> {
  if (!localHasFiles()) {
    throw new FontUnavailable(`"${name}" is installed on this computer, but this browser does not let web pages read font files (only Chromium-based browsers do), so it cannot be converted.`);
  }
  const hit = pickFace(localFacesOf(name), want.weight, want.italic);
  if (!hit) throw new FontUnavailable(`"${name}" was not found among the local fonts.`);
  try {
    const p = await parseFont(await localFontBytes(hit.face), { wght: want.weight, opsz: size }, hit.face.postscriptName);
    return { font: p.font, family: hit.face.family, source: 'local', extras: [], weight: p.wght ?? hit.face.weight, italic: hit.face.italic,
      approximated: !hit.exact || p.clamped };
  } catch (e) {
    throw new FontUnavailable(`The local font "${name}" could not be read: ${(e as Error).message}`);
  }
}

// One entry per (family, style, size); an entry made for a larger character set also serves smaller ones.
interface Entry { chars: Set<number> | null; promise: Promise<OutlineFont>; }
const cache = new Map<string, Entry[]>();
const covers = (have: Set<number> | null, need: Set<number>) => have === null || [...need].every(c => have.has(c));

function remember(key: string, e: Entry) {
  const list = cache.get(key) ?? [];
  list.push(e);
  if (list.length > 6) list.shift();
  cache.delete(key); cache.set(key, list);                       // most recent last
  if (cache.size > 40) cache.delete(cache.keys().next().value as string);
  e.promise.catch(() => { const l = cache.get(key); if (l) { const i = l.indexOf(e); if (i >= 0) l.splice(i, 1); } });
}

const unknownMessage = (family: string) => {
  const hint = supportsLocalFonts() && get(localFonts).status !== 'ready'
    ? ' If it is installed on this computer, allow access to your local fonts in the font picker.' : '';
  return `"${family}" is not a Google font and was not found among your local fonts, so it cannot be converted.${hint}`;
};

/**
 * The font for a text shape. `extra` = more characters the same font should cover (so that a whole
 * document needs one download per font instead of one per text).
 */
export async function getOutlineFont(t: OutlineRequest, extra?: Iterable<number>): Promise<OutlineFont> {
  const family = t.fontFamily.trim();
  const want: Style = { weight: t.fontWeight, italic: t.fontStyle === 'italic' };
  const source = await resolveSource(family);

  if (source === 'generic') {
    if (!bundledFamily(family)) throw new FontUnavailable(`"${family}" is a generic family without a bundled font, so it cannot be converted. Choose a specific font.`);
    const size = Math.round(t.fontSize * 10) / 10;
    const b = await bundledOutlineFonts(family, want, size, codePointsFor(t, extra));
    // Comic Neue and Anton cover fewer scripts: the bundled sans-serif fills in, as it does on screen.
    const fill = bundledGeneric(family) === 'cursive' || bundledGeneric(family) === 'fantasy'
      ? (await bundledOutlineFonts('sans-serif', want, size, codePointsFor(t, extra))).fonts : [];
    return { font: b.fonts[0], extras: [...b.fonts.slice(1), ...fill], family: b.family, source: 'bundled', weight: b.weight, italic: b.italic, approximated: false };
  }
  if (source === 'unknown') throw new FontUnavailable(unknownMessage(family));
  // Ask for a weight the family has: a missing bold is synthesized from the nearest weight by the outline code.
  if (source === 'google') { const st = await fontStyles(family); if (st.known) want.weight = nearestWeight(st, want.weight); }

  const size = Math.round(t.fontSize * 10) / 10;
  const key = `${source}|${family.toLowerCase()}|${want.weight}|${+want.italic}|${size}`;
  const need = source === 'google' ? codePointsFor(t, extra) : new Set<number>();
  const hit = cache.get(key)?.find(e => covers(e.chars, need));
  if (hit) return hit.promise;

  const promise = (async (): Promise<OutlineFont> => {
    if (source === 'local') return localOutline(localName(family)!, want, size);
    try { return await googleOutline(googleName(family)!, want, size, need); }
    catch (e) {
      if (e instanceof FontUnavailable) throw e;
      if (localName(family) && localHasFiles()) return localOutline(localName(family)!, want, size);   // offline: the installed copy
      if (e instanceof FontNotFound) throw new FontUnavailable(e.message);
      throw new FontUnavailable(`Google Fonts could not be reached, so "${family}" was not converted (${(e as Error).message}).`);
    }
  })();
  remember(key, { chars: source === 'google' ? need : null, promise });
  return promise;
}

/**
 * Warms the cache: one request per font style covering every text (of any size) that uses it.
 * Errors surface later, per text.
 */
export async function prefetchOutlineFonts(texts: readonly OutlineRequest[]): Promise<void> {
  const union = new Map<string, Set<number>>();                       // family|weight|style → characters
  const styleKey = (t: OutlineRequest) => `${t.fontFamily}|${t.fontWeight}|${t.fontStyle}`;
  for (const t of texts) {
    const u = union.get(styleKey(t)) ?? new Set<number>();
    for (const c of codePointsFor(t)) u.add(c);
    union.set(styleKey(t), u);
  }
  const bySize = new Map<string, OutlineRequest>();
  for (const t of texts) bySize.set(`${styleKey(t)}|${t.fontSize}`, t);
  await Promise.all([...bySize.values()].map(t => getOutlineFont(t, union.get(styleKey(t))).catch(() => undefined)));
}

export const clearOutlineCache = () => cache.clear();
