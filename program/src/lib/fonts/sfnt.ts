/**
 * @file Font file bytes → a fontkit Font (the library is loaded lazily, on first outline).
 *
 * fontkit reads woff2 / woff / ttf / otf / collections itself, applies variable-font axes (including the
 * HVAR / GPOS deltas that make kerning right at bold weights) and shapes text (ligatures, contextual
 * alternates, mark positioning, Arabic / Indic shaping).
 */
import type { Font, FontCollection } from 'fontkit';

async function fontkit(): Promise<{ create(b: Uint8Array): Font | FontCollection | null }> {
  const mod: any = await import('fontkit');
  return typeof mod.create === 'function' ? mod : mod.default;       // interop: namespace in Vite, default in Node
}

export interface VariationWish { wght?: number; opsz?: number; }
export interface ParsedFont {
  font: Font; variable: boolean;
  /** The wanted weight was outside the font's range. */
  clamped: boolean;
  /** The weight axis value used, when the font has one. */
  wght?: number;
  /** The font's weight axis, when it has one. */
  wghtRange?: { min: number; max: number };
}

/**
 * Parses font bytes. `postscriptName` picks the face inside a collection (.ttc). For variable fonts the
 * weight / optical-size axes are set (opsz = font size, like browsers do); other axes keep their defaults.
 */
export async function parseFont(bytes: ArrayBuffer, wish: VariationWish = {}, postscriptName?: string): Promise<ParsedFont> {
  const { create } = await fontkit();
  const pick = (f: Font | FontCollection | null): Font | null => {
    if (f && 'fonts' in f) return (postscriptName && f.fonts.find(x => x.postscriptName === postscriptName)) || f.fonts[0] || null;
    return f;
  };
  let bytes8 = new Uint8Array(bytes);
  let font = pick(create(bytes8));
  if (!font) throw new Error('The font file contains no usable font.');

  const axes = font.variationAxes;
  const tags = Object.keys(axes);
  if (!tags.length) return { font, variable: false, clamped: false };
  const wghtRange = axes.wght ? { min: axes.wght.min, max: axes.wght.max } : undefined;

  const coords: Record<string, number> = {};
  let clamped = false;
  for (const tag of tags) {
    const a = axes[tag]!;
    const want = (wish as Record<string, number | undefined>)[tag];
    if (want === undefined) continue;
    coords[tag] = Math.min(a.max, Math.max(a.min, want));
    if (coords[tag] !== want && tag === 'wght') clamped = true;
  }
  if (!Object.keys(coords).length) return { font, variable: true, clamped, wghtRange };

  // fontkit instances a variable font by re-reading the file as a plain sfnt, which fails for woff2 (its
  // tables are compressed and the glyf table is transformed). So variable woff2 is unpacked to sfnt first.
  if (bytes8[0] === 0x77 && bytes8[1] === 0x4f && bytes8[2] === 0x46 && bytes8[3] === 0x32) {   // 'wOF2'
    const { default: decompress } = await import('woff2-encoder/decompress');
    bytes8 = new Uint8Array(await decompress(bytes8));
    font = pick(create(bytes8));
    if (!font) throw new Error('The font file contains no usable font.');
  }
  return { font: font.getVariation(coords), variable: true, clamped, wght: coords.wght, wghtRange };
}
