/**
 * @file Google Fonts CSS2 API: URL builder + response parser. Pure functions.
 *
 * Facts this file relies on (developers.google.com/fonts/docs/css2):
 *   • parameters are `family` (repeatable), `text` (once, applies to all families) and `display`.
 *     There is NO `subset` parameter in CSS2 (only the v1 API had one). Subsetting happens by
 *     `unicode-range`: a plain request answers with one @font-face block per script subset
 *     (commented latin, latin-ext, cyrillic …) and the browser downloads only the ones the
 *     page's characters need. `text=` instead returns ONE block with a font cut down to those characters.
 *   • axis syntax:  Family:wght@400;700   Family:ital,wght@0,400;1,700   — tags alphabetical, tuples sorted
 *     numerically; a style the family does not have is an HTTP 400 for the WHOLE request.
 *   • the file format follows the browser's User-Agent (woff2 for any current browser).
 */

export const CSS2_URL = 'https://fonts.googleapis.com/css2';
export const FONT_HOST = 'fonts.gstatic.com';

export interface Style { weight: number; italic: boolean; }
export interface FamilySpec { family: string; styles?: readonly Style[]; }

const encName = (n: string) => encodeURIComponent(n).replace(/%20/g, '+');

/** `Roboto:ital,wght@0,400;1,700` style axis string ('' = none). */
export function axisSpec(styles: readonly Style[] | undefined): string {
  if (!styles?.length) return '';
  const uniq = [...new Map(styles.map(s => [`${+s.italic},${s.weight}`, s])).values()]
    .sort((a, b) => +a.italic - +b.italic || a.weight - b.weight);
  // Upright-only requests use the plain `wght@` form: it is valid for every family, `ital,wght@0,…` is not guaranteed to be.
  if (uniq.every(s => !s.italic)) return `:wght@${uniq.map(s => s.weight).join(';')}`;
  return `:ital,wght@${uniq.map(s => `${+s.italic},${s.weight}`).join(';')}`;
}

/** The CSS2 URL for one or more families. `text` limits the font to those characters. */
export function cssUrl(families: readonly FamilySpec[], opts: { text?: string; display?: string } = {}): string {
  const fam = [...families].sort((a, b) => a.family.localeCompare(b.family))
    .map(f => `family=${encName(f.family)}${axisSpec(f.styles)}`);
  const q = [...fam];
  if (opts.text) q.push(`text=${encodeURIComponent(opts.text)}`);
  q.push(`display=${opts.display ?? 'swap'}`);
  return `${CSS2_URL}?${q.join('&')}`;
}

/** Longest URL we are willing to send (servers and proxies start refusing at ~8 KB). */
const MAX_URL = 6500;

/**
 * The `text=` value for a set of characters: unique, sorted, without line breaks. Returns null if the
 * request URL would become too long (large CJK texts) — callers then fall back to whole subsets.
 */
export function textParam(chars: Iterable<number | string>): string | null {
  const cps = new Set<number>();
  for (const c of chars) {
    const cp = typeof c === 'number' ? c : c.codePointAt(0)!;
    if (cp > 0x1f && cp !== 0x7f) cps.add(cp);        // tabs / line breaks have no glyph
  }
  if (!cps.size) return null;
  const text = String.fromCodePoint(...[...cps].sort((a, b) => a - b));
  return encodeURIComponent(text).length + 200 > MAX_URL ? null : text;
}

export const codePointsOf = (text: string): Set<number> => {
  const s = new Set<number>();
  for (const ch of text) s.add(ch.codePointAt(0)!);
  return s;
};

// ── response parser ───────────────────────────────────────────────────────────

export interface FaceRule {
  family: string;
  style: string;                 // normal | italic | oblique …
  weight: string;                // "400" or a variable range "100 900"
  unicodeRange: string | null;
  /** Script subset label from the comment before the block ("latin", "latin-ext" …), if any. */
  subset: string | null;
  url: string;
  format: string | null;         // woff2 | truetype | …
}

const unq = (v: string) => v.trim().replace(/^['"]|['"]$/g, '');

/** @font-face blocks of a CSS2 response. Blocks whose file is not on fonts.gstatic.com over https are ignored. */
export function parseFontFaces(css: string): FaceRule[] {
  const out: FaceRule[] = [];
  const re = /(?:\/\*\s*([\w-]+)\s*\*\/\s*)?@font-face\s*\{([^}]*)\}/g;
  for (let m: RegExpExecArray | null; (m = re.exec(css));) {
    const decl: Record<string, string> = {};
    for (const d of m[2].split(';')) {
      const i = d.indexOf(':');
      if (i > 0) decl[d.slice(0, i).trim().toLowerCase()] = d.slice(i + 1).trim();
    }
    const src = /url\(\s*(['"]?)([^'")\s]+)\1\s*\)(?:\s*format\(\s*['"]?([\w-]+)['"]?\s*\))?/i.exec(decl['src'] ?? '');
    if (!src || !decl['font-family']) continue;
    let host = '';
    try { const u = new URL(src[2]); host = u.protocol === 'https:' ? u.hostname : ''; } catch { /* relative / malformed */ }
    if (host !== FONT_HOST) continue;
    out.push({
      family: unq(decl['font-family']),
      style: decl['font-style'] ?? 'normal',
      weight: decl['font-weight'] ?? '400',
      unicodeRange: decl['unicode-range'] ?? null,
      subset: m[1] ?? null,
      url: src[2],
      format: src[3]?.toLowerCase() ?? null,
    });
  }
  return out;
}

/** Does a CSS `unicode-range` value cover at least one of the given code points? (null = covers everything) */
export function rangeMatches(range: string | null, codepoints: ReadonlySet<number>): boolean {
  if (!range) return true;
  for (const tok of range.split(',')) {
    const t = tok.trim().replace(/^u\+/i, '');
    if (!t) continue;
    let lo: number, hi: number;
    if (t.includes('?')) { lo = parseInt(t.replace(/\?/g, '0'), 16); hi = parseInt(t.replace(/\?/g, 'F'), 16); }
    else if (t.includes('-')) { const [a, b] = t.split('-'); lo = parseInt(a, 16); hi = parseInt(b, 16); }
    else lo = hi = parseInt(t, 16);
    if (Number.isNaN(lo) || Number.isNaN(hi)) continue;
    for (const cp of codepoints) if (cp >= lo && cp <= hi) return true;
  }
  return false;
}
