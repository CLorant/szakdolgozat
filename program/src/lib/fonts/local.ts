/**
 * @file The fonts installed on this computer, through the Local Font Access API (window.queryLocalFonts; Chromium
 * browsers, with the user's permission). FontData.blob() gives the font file, so local fonts can be outlined like
 * Google ones. Other browsers can only detect a short list of common fonts (canvas width test); those display fine
 * but cannot be outlined or embedded.
 */

import { memoAsync } from './net';

export type LocalStatus = 'unsupported' | 'idle' | 'loading' | 'ready' | 'denied' | 'error';

/** The part of the browser's FontData object we use (lets tests pass a fake). */
export interface FontDataLike {
  family: string; fullName: string; postscriptName: string; style: string;
  blob(): Promise<Blob>;
}

export interface LocalFace {
  family: string; style: string; fullName: string; postscriptName: string;
  /** Inferred from the style name (the API exposes no numeric weight). */
  weight: number; italic: boolean;
  data?: FontDataLike;
}

export const supportsLocalFonts = () =>
  typeof window !== 'undefined' && typeof (window as any).queryLocalFonts === 'function';

export async function localFontsPermission(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
  try { return (await navigator.permissions.query({ name: 'local-fonts' as PermissionName })).state; }
  catch { return 'unknown'; }
}

// ── style name → weight / italic ──────────────────────────────────────────────

const WEIGHT_WORDS: [RegExp, number][] = [
  [/thin|hairline/i, 100], [/extra[\s-]?light|ultra[\s-]?light/i, 200], [/light/i, 300],
  [/semi[\s-]?bold|demi[\s-]?bold|demi/i, 600], [/extra[\s-]?bold|ultra[\s-]?bold/i, 800],
  [/bold/i, 700], [/black|heavy/i, 900], [/medium/i, 500], [/regular|normal|roman|book/i, 400],
];
export function styleTraits(style: string): { weight: number; italic: boolean } {
  const hit = WEIGHT_WORDS.find(([re]) => re.test(style));
  return { weight: hit ? hit[1] : 400, italic: /italic|oblique/i.test(style) };
}

export async function queryFaces(): Promise<LocalFace[]> {
  const list: FontDataLike[] = await (window as any).queryLocalFonts();
  return list.map(d => ({
    family: d.family, style: d.style, fullName: d.fullName, postscriptName: d.postscriptName,
    ...styleTraits(d.style), data: d,
  }));
}

const NARROW_OR_WIDE = /condensed|narrow|compressed|expanded|extended|wide/i;

/** CSS font-matching order (css-fonts-4): which weights are tried first for a wanted weight. Lower = better. */
export function weightRank(have: number, want: number): number {
  if (have === want) return 0;
  if (want <= 500) return have > want && have <= 500 ? (have - want) / 1000 : have < want ? 1 + (want - have) / 1000 : 2 + (have - 500) / 1000;
  return have > want ? (have - want) / 1000 : 1 + (want - have) / 1000;
}

/** The face of a family that best matches the wanted weight (400 / 700) and slant. */
export function pickFace(faces: readonly LocalFace[], weight: number, italic: boolean): { face: LocalFace; exact: boolean } | null {
  let best: LocalFace | null = null, bestScore = Infinity;
  for (const f of faces) {
    const score = (f.italic === italic ? 0 : 10000) + weightRank(f.weight, weight) * 1000 + (NARROW_OR_WIDE.test(f.style) ? 5000 : 0);
    if (score < bestScore) { best = f; bestScore = score; }
  }
  return best ? { face: best, exact: best.italic === italic && best.weight === weight && !NARROW_OR_WIDE.test(best.style) } : null;
}

// ── font file bytes ───────────────────────────────────────────────────────────

export const localFontBytes = memoAsync(
  (f: LocalFace) => `${f.postscriptName}|${f.style}`,
  async (f: LocalFace): Promise<ArrayBuffer> => {
    if (!f.data) throw new Error('This browser does not give access to the font file.');
    return (await f.data.blob()).arrayBuffer();
  }, 40);

// ── fallback for browsers without the API ─────────────────────────────────────

export const COMMON_FONTS = [
  'Arial', 'Arial Black', 'Calibri', 'Cambria', 'Candara', 'Consolas', 'Courier New', 'Georgia', 'Helvetica',
  'Helvetica Neue', 'Impact', 'Lucida Console', 'Lucida Sans Unicode', 'Menlo', 'Monaco', 'Palatino',
  'Palatino Linotype', 'Segoe UI', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'Comic Sans MS',
  'Garamond', 'Gill Sans', 'Optima', 'Futura', 'Baskerville', 'Didot', 'Avenir', 'DejaVu Sans', 'DejaVu Serif',
  'Liberation Sans', 'Liberation Serif', 'Ubuntu',
];

/** Which of the candidate families are installed? Compares text width against three generic baselines. */
export function detectInstalled(candidates: readonly string[]): string[] {
  if (typeof document === 'undefined') return [];
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return [];
  const sample = 'mmmmmmmmmmlli1WwQq@#';
  const bases = ['monospace', 'serif', 'sans-serif'];
  const width = (font: string) => { ctx.font = `72px ${font}`; return ctx.measureText(sample).width; };
  const baseWidths = bases.map(b => width(b));
  return candidates.filter(name => bases.some((b, i) => width(`'${name}', ${b}`) !== baseWidths[i]));
}
