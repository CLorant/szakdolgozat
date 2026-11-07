/**
 * @file Everything that turns the document into a FILE (SVG / PNG / JPG).
 *
 * Text can leave the editor in three ways:
 *   'embed'   <text> + the used Google font files inlined as data: URIs (text stays text, self-contained;
 *             see fonts/embed.ts for the 'text' / 'subset' strategies; local fonts cannot be embedded)
 *   'outline' text converted to paths (no fonts needed at all, identical everywhere)
 *   'live'    plain <text> (relies on the viewer having the fonts)
 */
import type { DocumentState, Shape, TextShape } from './types';
import { buildSvgDocument } from './serializer';
import { embedFontCss, type EmbedStrategy } from '../fonts/embed';
import { prefetchOutlineFonts } from '../fonts/outlineFont';
import { convertToPaths } from './convert';
import { exportArea } from './exportArea';
import type { RasterSettings, SvgSettings } from './exportSettings';
import { DEFAULT_SETTINGS, svgSettingsOf, rasterSettingsOf } from './exportSettings';

export type TextMode = 'embed' | 'outline' | 'live';

/** Raster exports are at least this wide (the supervisor's requirement); wider documents stay 1:1. */
export const MIN_EXPORT_WIDTH = 4000;
/** Hard limits of browser canvases (Chrome: 16384 per side, 268 M pixels). */
export const MAX_RASTER_SIDE = 16384;
export const MAX_RASTER_PIXELS = 268_000_000;

export interface ExportSize { width: number; height: number; scale: number; limited: boolean; }

/** What the pixel size is derived from. Default: the "at least 4000 px wide" rule. */
export type SizeWish = { minWidth: number } | { scale: number } | { width: number };

/**
 * Pixel size of a raster export of a `docWidth` × `docHeight` area.
 *  { minWidth } width < minWidth → scaled up to minWidth wide, otherwise 1:1 (the default: 4000)
 *  { scale }    that factor
 *  { width }    exactly that many pixels wide (aspect ratio kept, height rounded)
 * `limited` = the canvas limits forced a smaller scale than wanted. Throws if even 1:1 is impossible.
 */
export function exportSize(docWidth: number, docHeight: number, wish: SizeWish = { minWidth: MIN_EXPORT_WIDTH }): ExportSize {
  if (!(docWidth > 0 && docHeight > 0)) throw new Error('Invalid export size.');
  let scale = 'minWidth' in wish ? (docWidth < wish.minWidth ? wish.minWidth / docWidth : 1)
            : 'scale' in wish ? wish.scale : wish.width / docWidth;
  let limited = false;
  const maxScale = Math.min(MAX_RASTER_SIDE / docWidth, MAX_RASTER_SIDE / docHeight,
    Math.sqrt(MAX_RASTER_PIXELS / (docWidth * docHeight)));
  if (scale > maxScale) { scale = maxScale; limited = true; }
  // when the canvas limits cut the scale, round DOWN: rounding up could push the area over the limit again
  const rnd = limited ? Math.floor : Math.round;
  const width = Math.max(1, rnd(docWidth * scale)), height = Math.max(1, rnd(docHeight * scale));
  if (width > MAX_RASTER_SIDE || height > MAX_RASTER_SIDE || width * height > MAX_RASTER_PIXELS) {
    throw new Error(`The image would be too large for the browser (limit ${MAX_RASTER_SIDE}px per side).`);
  }
  return { width, height, scale: width / docWidth, limited };
}

/** Converts the text shapes accepted by `only` (any depth) to paths. */
export async function outlineTexts(
  shapes: readonly Shape[], only: (t: Shape) => boolean = () => true,
): Promise<{ shapes: Shape[]; warnings: string[] }> {
  const warnings = new Set<string>();
  const wanted: TextShape[] = [];
  const collect = (list: readonly Shape[]) => list.forEach(s => {
    if (!s.visible) return;
    if (s.type === 'group') collect(s.children); else if (s.type === 'text' && only(s)) wanted.push(s);
  });
  collect(shapes);
  await prefetchOutlineFonts(wanted);             // one download per font style, not per text
  const go = async (list: readonly Shape[]): Promise<Shape[]> => {
    const out: Shape[] = [];
    for (const s of list) {
      if (!s.visible) { out.push(s); continue; }
      if (s.type === 'group') out.push({ ...s, children: await go(s.children) });
      else if (s.type === 'text' && only(s)) {
        const r = await convertToPaths(s);
        r.warnings.forEach(w => warnings.add(w));
        out.push(r.shape);
      } else out.push(s);
    }
    return out;
  };
  return { shapes: await go(shapes), warnings: [...warnings] };
}

export interface BuiltSvg { svg: string; warnings: string[]; }

export async function buildSvgFile(
  doc: DocumentState,
  opts: { text: TextMode; embed?: EmbedStrategy; opaque?: boolean; size?: { width: number; height: number } },
): Promise<BuiltSvg> {
  let work = doc, warnings: string[] = [], fontCss = '';
  if (opts.text === 'outline') {
    const r = await outlineTexts(doc.shapes);
    work = { ...doc, shapes: r.shapes }; warnings = r.warnings;
  } else if (opts.text === 'embed') {
    try { const e = await embedFontCss(doc.shapes, opts.embed ?? 'text'); fontCss = e.css; warnings = e.warnings; }
    catch { warnings.push('Fonts could not be embedded; text will use the viewer’s fonts.'); }
  }
  return { svg: buildSvgDocument(work, { opaque: opts.opaque, fontCss, size: opts.size }), warnings };
}

/** SVG for the Export Options dialog settings (area, background, fonts, text to paths …). */
export async function buildSvgFromSettings(doc: DocumentState, st: SvgSettings = svgSettingsOf(DEFAULT_SETTINGS)): Promise<BuiltSvg> {
  let work = doc, warnings: string[] = [], fontCss = '';
  if (st.textToPaths) {
    const r = await outlineTexts(doc.shapes);
    work = { ...doc, shapes: r.shapes }; warnings = r.warnings;
  } else {
    try { const e = await embedFontCss(doc.shapes, { google: st.google, local: st.local }); fontCss = e.css; warnings = e.warnings; }
    catch { warnings.push('Fonts could not be prepared; text will use the viewer’s fonts.'); }
  }
  const area = exportArea(doc, st.area, st.padding);
  const svg = buildSvgDocument(work, {
    background: st.background, fontCss, scalable: st.scalable,
    viewBox: st.area === 'content' ? area : undefined,
  });
  return { svg, warnings };
}

export type RasterFormat = 'png' | 'jpeg' | 'webp';
const MIME: Record<RasterFormat, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };

/**
 * Raster image at the size given by the settings (see exportSize). Text is outlined first, so nothing depends on font
 * loading inside the <img>; text whose font cannot be outlined (generic family, unreadable local
 * font, offline) stays live text — with a warning. The SVG is written with the TARGET pixel size,
 * so the browser rasterises the vectors at full resolution instead of enlarging a small bitmap.
 */
export async function renderRaster(
  doc: DocumentState, fmt: RasterFormat, st: RasterSettings = rasterSettingsOf(DEFAULT_SETTINGS),
): Promise<{ blob: Blob; size: ExportSize; warnings: string[] }> {
  const area = exportArea(doc, st.area, st.padding);
  const size = exportSize(area.width, area.height,
    st.size === 'auto' ? { minWidth: MIN_EXPORT_WIDTH } : st.size === 'scale' ? { scale: st.scale } : { width: st.width });
  const warnings: string[] = [];
  let work = doc;
  try {
    const r = await outlineTexts(doc.shapes);
    work = { ...doc, shapes: r.shapes }; warnings.push(...r.warnings);
  } catch { warnings.push('Some text could not be outlined and was drawn with the browser’s fonts.'); }
  if (size.limited) warnings.push(`Limited to ${size.width}×${size.height}px by the browser’s canvas size.`);

  const svg = buildSvgDocument(work, {
    background: st.background, opaque: fmt === 'jpeg', size,
    viewBox: st.area === 'content' ? area : undefined,
  });
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    await new Promise<void>((ok, fail) => {
      img.onload = () => ok();
      img.onerror = () => fail(new Error('The browser could not render the drawing.'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = size.width; canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available.');
    if (fmt === 'jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, size.width, size.height); }
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, size.width, size.height);
    const lossy = fmt !== 'png';
    const blob = await new Promise<Blob>((ok, fail) =>
      canvas.toBlob(b => b ? ok(b) : fail(new Error('Export failed.')), MIME[fmt], lossy ? st.quality / 100 : undefined));
    // Browsers silently answer with a PNG when they cannot encode the requested type.
    if (blob.type !== MIME[fmt]) throw new Error(`This browser cannot save ${fmt.toUpperCase()} images. Try PNG or JPG.`);
    return { blob, size, warnings };
  } finally {
    URL.revokeObjectURL(url);
  }
}
