/**
 * @file Talking to the Google Fonts CSS2 API for ONE family and style.
 *
 * A request for a style the family does not have fails the whole request with HTTP 400, so every
 * request walks a short fallback chain (e.g. bold italic → bold → regular italic → regular → the
 * family's own default) and reports which style it really got (`approximated`).
 */

import { cssUrl, parseFontFaces, type FaceRule, type Style } from './googleCss';
import { fetchBytes, fetchText, HttpError, memoAsync } from './net';
import { googleName } from './registry';
import { fontStyles, nearestWeight } from './styles';

export class FontNotFound extends Error {
  constructor(public family: string) { super(`"${family}" was not found on Google Fonts.`); }
}

export interface StyleCss {
  family: string;
  rules: FaceRule[];
  /** The style the rules really are (can differ from the wanted one). */
  actual: Style;
  approximated: boolean;
}

/** Styles to try, best first; null = the family's default (no axis in the URL). */
export function fallbackChain(want: Style): (Style | null)[] {
  const chain: (Style | null)[] = [want];
  if (want.italic) chain.push({ weight: want.weight, italic: false });
  if (want.weight !== 400) {
    chain.push({ weight: 400, italic: want.italic });
    if (want.italic) chain.push({ weight: 400, italic: false });
  }
  chain.push(null);
  const seen = new Set<string>();
  return chain.filter(s => { const k = s ? `${+s.italic}${s.weight}` : 'default'; return seen.has(k) ? false : (seen.add(k), true); });
}

/** Cached CSS2 response text (also used by the picker's preview batches). */
export const fetchCss = memoAsync((url: string) => url, fetchText, 300);
export const fontFileBytes = memoAsync((url: string) => url, fetchBytes, 80);

/** "700" → 700; a variable range "100 900" → the wanted weight clamped into it. */
function weightOf(descriptor: string, wanted: number): number {
  const nums = descriptor.match(/\d+(\.\d+)?/g)?.map(Number) ?? [];
  if (nums.length >= 2) return Math.min(nums[1], Math.max(nums[0], wanted));
  return nums[0] ?? 400;
}

/**
 * The @font-face rules for one style of a family (optionally cut down to `text`). Throws FontNotFound
 * if Google does not know the family, and the network error if Google cannot be reached.
 */
export const fetchStyle = memoAsync(
  (family: string, want: Style, text?: string) => `${family}|${want.weight}|${+want.italic}|${text ?? ''}`,
  async (family: string, wanted: Style, text?: string): Promise<StyleCss> => {
    const name = googleName(family) ?? family;
    // Ask only for a style the family has (Fontsource metadata), so no request is refused: a refused request is
    // harmless, but the browser reports it in the console as a failed load. Without metadata, walk the chain.
    const st = await fontStyles(name);
    const want: Style = st.known ? { weight: nearestWeight(st, wanted.weight), italic: wanted.italic && st.italic } : wanted;
    const adjusted = want.weight !== wanted.weight || want.italic !== wanted.italic;
    for (const [i, s] of fallbackChain(want).entries()) {
      let css: string;
      try { css = await fetchCss(cssUrl([{ family: name, styles: s ? [s] : undefined }], { text })); }
      catch (e) {
        if (e instanceof HttpError && (e.status === 400 || e.status === 404)) continue;   // no such style → next
        throw e;
      }
      const rules = parseFontFaces(css);
      if (!rules.length) continue;
      const actual: Style = s ?? { weight: weightOf(rules[0].weight, want.weight), italic: rules[0].style === 'italic' };
      return { family: name, rules, actual, approximated: adjusted || i > 0 };
    }
    throw new FontNotFound(family);
  }, 300);
