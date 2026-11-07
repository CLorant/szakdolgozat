/**
 * @file Which weights and slants a font family really has, for the Typography panel's weight and italic controls.
 *
 *   Google   → the Fontsource API (one small JSON per family: weights, styles, variable).
 *   Local    → the installed faces (weights from their style names); a variable font's range from its file.
 *   Generic  → the bundled font (fonts/bundled.ts).
 *   Unknown, or the lookup failed → regular and bold, both assumed to exist (the browser decides).
 */
import { writable, get } from 'svelte/store';
import { fetchJson } from './net';
import { localFacesOf, localHasFiles } from './registry';
import { localFontBytes } from './local';
import { parseFont } from './sfnt';
import { resolveSource } from './sources';
import { bundledFamily, bundledStyles } from './bundled';
import { googleName } from './registry';

export interface FontStyles {
  /** Upright weights the family has, ascending. For a variable family: the two ends of its range. */
  weights: number[];
  /** The continuous weight range of a variable family, or null. */
  variable: { min: number; max: number } | null;
  /** The family has real italic faces (otherwise italic is synthesized by slanting). */
  italic: boolean;
  /** false = nothing is known about the family; the values are a guess. */
  known: boolean;
}

export const UNKNOWN_STYLES: FontStyles = { weights: [400, 700], variable: null, italic: true, known: false };

export const FONTSOURCE_URL = 'https://api.fontsource.org/v1/fonts/';
/** Fontsource's id of a family: lower case, words joined by hyphens ("Open Sans" → "open-sans"). */
export const fontsourceId = (family: string) => family.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const sortedUnique = (list: number[]) => [...new Set(list)].sort((a, b) => a - b);

async function googleStyles(family: string): Promise<FontStyles> {
  const json = await fetchJson(FONTSOURCE_URL + fontsourceId(googleName(family) ?? family)) as { weights?: unknown; styles?: unknown; variable?: unknown };
  const weights = sortedUnique((Array.isArray(json.weights) ? json.weights : []).filter((w): w is number => typeof w === 'number' && w > 0 && w <= 1000));
  if (!weights.length) return UNKNOWN_STYLES;
  const variable = json.variable === true && weights.length > 1 ? { min: weights[0], max: weights[weights.length - 1] } : null;
  return {
    weights: variable ? [variable.min, variable.max] : weights,
    variable,
    italic: Array.isArray(json.styles) && json.styles.includes('italic'),
    known: true,
  };
}

async function localStyles(family: string): Promise<FontStyles> {
  const faces = localFacesOf(family);
  if (!faces.length) return UNKNOWN_STYLES;
  const upright = faces.filter(f => !f.italic);
  let variable: FontStyles['variable'] = null;
  if (localHasFiles() && upright.length) {
    try {
      const p = await parseFont(await localFontBytes(upright[0]), {}, upright[0].postscriptName);
      if (p.wghtRange && p.wghtRange.max > p.wghtRange.min) variable = p.wghtRange;
    } catch { /* unreadable: the style names are all we have */ }
  }
  const weights = sortedUnique((upright.length ? upright : faces).map(f => f.weight));
  return {
    weights: variable ? [variable.min, variable.max] : weights,
    variable, italic: faces.some(f => f.italic), known: true,
  };
}

const cache = new Map<string, Promise<FontStyles>>();

/** The styles of a family (cached; never rejects). */
export function fontStyles(family: string): Promise<FontStyles> {
  const key = family.trim().toLowerCase();
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      try {
        const bundled = bundledFamily(family);
        if (bundled) return bundledStyles(bundled);
        const source = await resolveSource(family);
        if (source === 'google') return await googleStyles(family);
        if (source === 'local') return await localStyles(family);
      } catch { cache.delete(key); }            // offline: ask again next time
      return UNKNOWN_STYLES;
    })();
    cache.set(key, p);
  }
  return p;
}
export const clearFontStyles = () => cache.clear();

/** Known styles by lower-case family name, for the UI. */
export const fontStylesMap = writable<Record<string, FontStyles>>({});

/** The styles of `family` as far as known now; starts a lookup that updates fontStylesMap. */
export function stylesNow(family: string): FontStyles {
  const key = family.trim().toLowerCase();
  const known = get(fontStylesMap)[key];
  if (!known) void fontStyles(family).then(s => fontStylesMap.update(m => ({ ...m, [key]: s })));
  return known ?? (bundledFamily(family) ? bundledStyles(bundledFamily(family)!) : UNKNOWN_STYLES);
}

// ── helpers for the controls and the outline ─────────────────────────────────

/** The available weight closest to `w` (inside the range of a variable family). */
export function nearestWeight(s: FontStyles, w: number): number {
  if (s.variable) return Math.min(s.variable.max, Math.max(s.variable.min, w));
  return s.weights.reduce((best, x) => Math.abs(x - w) < Math.abs(best - w) ? x : best, s.weights[0] ?? 400);
}

/** Does the family have a real face that is bold enough for `w` (browsers synthesize bold from 600 when it does not)? */
export const hasRealBold = (s: FontStyles) => (s.variable ? s.variable.max : Math.max(...s.weights)) >= 600;

const NAMES: Record<number, string> = { 100: 'Thin', 200: 'Extra Light', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semi Bold', 700: 'Bold', 800: 'Extra Bold', 900: 'Black' };
/** "700 Bold", "450". */
export const weightLabel = (w: number) => NAMES[w] ? `${w} ${NAMES[w]}` : String(w);
