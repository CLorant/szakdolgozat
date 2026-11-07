/**
 * @file The options of the Export Options dialog, remembered between sessions.
 *
 * File → "Export as SVG / PNG / JPG / WebP" runs at once with these settings; File → "Export options…" changes
 * them. The area and background are shared by every format ("General"); the rest is per format.
 */
import { writable, get } from 'svelte/store';

export type ExportArea = 'canvas' | 'content';

export interface FontSourceSettings<I extends string> {
  /** How the font reaches the viewer of the SVG. */
  include: I;
  /** 'used' = only the characters in the drawing; 'full' = every glyph of the script subsets / the font file. */
  coverage: 'used' | 'full';
}

/** Shared by every export format. */
export interface GeneralSettings {
  /** 'canvas' = the page; 'content' = a box around the visible objects (+ padding). */
  area: ExportArea;
  padding: number;
  /** Include the canvas background (color and image). */
  background: boolean;
}

export interface SvgOptions {
  /** Omit width / height (viewBox only): the SVG scales to the box it is placed in. */
  scalable: boolean;
  /** Convert every text to paths: no fonts are needed anywhere; overrides the font options. */
  textToPaths: boolean;
  google: FontSourceSettings<'embedded' | 'linked'>;
  /** Local fonts: 'embedded' puts the WHOLE font file in the SVG (there is no font subsetter). */
  local: { include: 'reference' | 'embedded' };
}

export type RasterSize = 'auto' | 'scale' | 'width';

export interface RasterOptions {
  /** auto = at least 4000 px wide (see exportSize); scale = factor × the area; width = exact pixels. */
  size: RasterSize;
  scale: number;
  width: number;
  /** JPG / WebP quality, 1–100. */
  quality: number;
}

/** What the SVG export uses: the general settings plus the SVG options. */
export type SvgSettings = GeneralSettings & SvgOptions;
/** What the raster export uses: the general settings plus the raster options. JPG is always filled (white without a background). */
export type RasterSettings = GeneralSettings & RasterOptions;

export interface ExportSettings { general: GeneralSettings; svg: SvgOptions; raster: RasterOptions; }

export const DEFAULT_SETTINGS: ExportSettings = {
  general: { area: 'canvas', padding: 0, background: true },
  svg: { scalable: false, textToPaths: false, google: { include: 'embedded', coverage: 'used' }, local: { include: 'reference' } },
  raster: { size: 'auto', scale: 2, width: 4000, quality: 92 },
};

export const svgSettingsOf = (s: ExportSettings): SvgSettings => ({ ...s.general, ...s.svg });
export const rasterSettingsOf = (s: ExportSettings): RasterSettings => ({ ...s.general, ...s.raster });

const KEY = 'svge.exportSettings.v1';
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d: number, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list as readonly unknown[]).includes(v) ? v as T : d;
const bool = (v: unknown, d: boolean) => typeof v === 'boolean' ? v : d;

/** Any stored, partial or hostile value → complete, valid settings. Reads the older layout (area in `svg`, `system`) too. */
export function sanitizeSettings(raw: unknown): ExportSettings {
  const D = DEFAULT_SETTINGS;
  const r = isObj(raw) ? raw : {};
  const s = isObj(r.svg) ? r.svg : {}, k = isObj(r.raster) ? r.raster : {};
  const gen = isObj(r.general) ? r.general : s;
  const g = isObj(s.google) ? s.google : {};
  const y = isObj(s.local) ? s.local : isObj(s.system) ? s.system : {};
  return {
    general: {
      area: oneOf(gen.area, ['canvas', 'content'], D.general.area),
      padding: Math.round(num(gen.padding, D.general.padding, 0, 1000)),
      background: bool(gen.background, D.general.background),
    },
    svg: {
      scalable: bool(s.scalable, D.svg.scalable),
      textToPaths: bool(s.textToPaths, D.svg.textToPaths),
      google: { include: oneOf(g.include, ['embedded', 'linked'], D.svg.google.include), coverage: oneOf(g.coverage, ['used', 'full'], D.svg.google.coverage) },
      local: { include: oneOf(y.include, ['reference', 'embedded'], D.svg.local.include) },
    },
    raster: {
      size: oneOf(k.size, ['auto', 'scale', 'width'], D.raster.size),
      scale: num(k.scale, D.raster.scale, 0.1, 16),
      width: Math.round(num(k.width, D.raster.width, 1, 16384)),
      quality: Math.round(num(k.quality, D.raster.quality, 1, 100)),
    },
  };
}

function load(): ExportSettings {
  try { return sanitizeSettings(JSON.parse(localStorage.getItem(KEY) ?? 'null')); } catch { return sanitizeSettings(null); }
}

const store = writable<ExportSettings>(load());
store.subscribe(v => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode or quota */ } });

export const exportSettings = {
  subscribe: store.subscribe,
  get: () => get(store),
  /** Replaces the settings (validated). */
  set: (v: ExportSettings) => store.set(sanitizeSettings(v)),
  patchGeneral: (p: Partial<GeneralSettings>) => store.update(s => sanitizeSettings({ ...s, general: { ...s.general, ...p } })),
  patchSvg: (p: Partial<SvgOptions>) => store.update(s => sanitizeSettings({ ...s, svg: { ...s.svg, ...p } })),
  patchRaster: (p: Partial<RasterOptions>) => store.update(s => sanitizeSettings({ ...s, raster: { ...s.raster, ...p } })),
  reset: () => store.set(sanitizeSettings(null)),
};

/** Whether the dialog is open (a store, so the menu can open it and App renders it). */
export const exportDialogOpen = writable(false);
