/**
 * @file The fonts bundled for the CSS generic families (list: assets/fonts/README.md).
 * The editor registers them under an alias family ("SVGE serif") and draws generic text with them; text-to-path
 * reads the same files, so the outline matches the screen. Each file covers one script subset and is fetched only
 * when its characters are needed.
 */
import type { Font } from 'fontkit';
import { BUNDLED_FAMILIES, type BundledFaceData, type BundledFamilyData } from './bundledData';
import { bundledAlias, bundledGeneric } from './generic';
import { rangeMatches, type Style } from './googleCss';
import { parseFont } from './sfnt';
import { weightRank } from './local';
import { memoAsync } from './net';
import type { FontStyles } from './styles';

const urls = import.meta.glob('../../assets/fonts/*/*.woff2', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const urlOf = (file: string) => urls[`../../assets/fonts/${file}`];

export function bundledFamily(name: string): BundledFamilyData | null {
  const g = bundledGeneric(name);
  return g ? BUNDLED_FAMILIES.find(f => f.generic === g) ?? null : null;
}

const range = (w: string) => { const n = w.split(/\s+/).map(Number); return { min: n[0], max: n[n.length - 1] }; };

/** Weights and italics of a bundled family, for the Typography panel. */
export function bundledStyles(f: BundledFamilyData): FontStyles {
  const upright = f.faces.filter(x => !x.italic);
  const variable = upright.find(x => x.weight.includes(' '));
  const weights = [...new Set(upright.map(x => range(x.weight).min))].sort((a, b) => a - b);
  return {
    weights: variable ? [range(variable.weight).min, range(variable.weight).max] : weights,
    variable: variable ? range(variable.weight) : null,
    italic: f.faces.some(x => x.italic),
    known: true,
  };
}

// ── editor registration ───────────────────────────────────────────────────────

let registered = false;
/** Registers every bundled face with the browser (nothing is downloaded until a character needs it). */
export function registerBundledFonts() {
  if (registered || typeof document === 'undefined' || !document.fonts || typeof FontFace === 'undefined') return;
  registered = true;
  for (const f of BUNDLED_FAMILIES) {
    for (const face of f.faces) {
      const url = urlOf(face.file);
      if (!url) continue;
      document.fonts.add(new FontFace(bundledAlias(f.generic), `url("${url}") format("woff2")`, {
        weight: face.weight, style: face.italic ? 'italic' : 'normal', display: 'swap',
        ...(face.unicodeRange ? { unicodeRange: face.unicodeRange } : {}),
      }));
    }
  }
}

// ── outlines ──────────────────────────────────────────────────────────────────

let loader = async (file: string): Promise<ArrayBuffer> => {
  const url = urlOf(file);
  if (!url) throw new Error(`The bundled font file ${file} is missing.`);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`The bundled font file ${file} could not be loaded (HTTP ${r.status}).`);
  return r.arrayBuffer();
};
/** Tests read the files from disk instead of fetching them. */
export const setBundledFontLoader = (fn: (file: string) => Promise<ArrayBuffer>) => { loader = fn; };
const bytesOf = memoAsync((file: string) => file, (file: string) => loader(file), 40);

export interface BundledOutline {
  /** Fonts covering the wanted characters: the Latin one first, then the other subsets. */
  fonts: Font[];
  family: string;
  weight: number;
  italic: boolean;
}

/** The faces of `f` closest to the wanted style: real italics if any (otherwise upright), the nearest weight. */
function facesFor(f: BundledFamilyData, want: Style): { faces: BundledFaceData[]; weight: number; italic: boolean } {
  const italic = want.italic && f.faces.some(x => x.italic);
  const pool = f.faces.filter(x => x.italic === italic);
  const weights = [...new Set(pool.map(x => x.weight))];
  const best = weights.map(w => ({ w, r: range(w) }))
    .map(o => ({ ...o, rank: want.weight >= o.r.min && want.weight <= o.r.max ? -1 : weightRank(o.r.min, want.weight) }))
    .sort((a, b) => a.rank - b.rank)[0];
  const weight = Math.min(best.r.max, Math.max(best.r.min, want.weight));
  return { faces: pool.filter(x => x.weight === best.w), weight, italic };
}

const SUBSET_ORDER = ['latin', 'latin-ext', 'vietnamese', 'cyrillic', 'cyrillic-ext', 'greek', 'greek-ext'];

/**
 * Fonts for outlining text in a bundled generic family. Only the subsets the characters need are read
 * (always the Latin one, which carries spaces and digits).
 */
export async function bundledOutlineFonts(name: string, want: Style, size: number, chars: ReadonlySet<number>): Promise<BundledOutline> {
  const f = bundledFamily(name);
  if (!f) throw new Error(`"${name}" has no bundled font.`);
  const pick = facesFor(f, want);
  const needed = pick.faces
    .filter(x => x.subset === 'latin' || rangeMatches(x.unicodeRange, chars as Set<number>))
    .sort((a, b) => SUBSET_ORDER.indexOf(a.subset) - SUBSET_ORDER.indexOf(b.subset));
  const fonts = await Promise.all(needed.map(async x => (await parseFont(await bytesOf(x.file), { wght: pick.weight, opsz: size })).font));
  return { fonts, family: f.name, weight: pick.weight, italic: pick.italic };
}
