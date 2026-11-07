/**
 * @file Text properties and measurement: defaults, font-family values, decoration lines, line advance and bounds.
 */

import { writable } from 'svelte/store';
import type { BoundingBox, TextShape, TextProps } from './types';
import { isGeneric, editorGenericCss } from '../fonts/generic';

/** Largest / smallest font size anywhere (project files are clamped to the same range, so resizing can never create a size that a reload would change). */
export const MAX_FONT_SIZE = 2000;
export const MIN_FONT_SIZE = 1;

/** Default distance between baselines, as a multiple of the font size. */
export const LINE_HEIGHT = 1.25;

export const DEFAULT_TEXT_PROPS: TextProps = {
  fontFamily: 'sans-serif', fontSize: 16, fontWeight: 400, fontStyle: 'normal',
  textDecoration: '', textAnchor: 'start', letterSpacing: 0, wordSpacing: 0, lineHeight: LINE_HEIGHT,
};

/** Any CSS font-weight value ('bold', 'normal', '600', 350) → a number in 1–1000. */
export function normWeight(v: unknown, fallback = 400): number {
  if (v === 'bold' || v === 'bolder') return 700;
  if (v === 'normal' || v === 'lighter') return 400;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? Math.min(1000, Math.max(1, Math.round(n))) : fallback;
}

export type DecorationLine = 'underline' | 'overline' | 'line-through';
export const DECORATION_LINES: readonly DecorationLine[] = ['underline', 'overline', 'line-through'];

/** The decoration lines in a text-decoration value (styles, colors and 'none' are ignored). */
export function decorationLines(v: string | undefined): DecorationLine[] {
  const words = new Set((v ?? '').toLowerCase().split(/\s+/));
  return DECORATION_LINES.filter(l => words.has(l));
}
/** Adds or removes one decoration line; the result is a normalised value ('' = none). */
export function toggleDecoration(v: string, line: DecorationLine): string {
  const set = new Set(decorationLines(v));
  if (set.has(line)) set.delete(line); else set.add(line);
  return DECORATION_LINES.filter(l => set.has(l)).join(' ');
}

/** Distance between two baselines in px. */
export const lineAdvance = (s: Pick<TextProps, 'fontSize' | 'lineHeight'>) => s.fontSize * (s.lineHeight || LINE_HEIGHT);
const ASCENT  = 0.85;
const DESCENT = 0.25;


/**
 * The font-family value the EDITOR draws with: quoted, with a fallback ('Open Sans' → "'Open Sans', sans-serif").
 * Generic families use their bundled font, so on-screen text and its path outline match.
 */
export function cssFontFamily(name: string): string {
  if (!name) return editorGenericCss('sans-serif');
  if (isGeneric(name)) return editorGenericCss(name);
  return `'${name.replace(/'/g, '')}', sans-serif`;
}

/** The font-family value written to an exported SVG: generic families stay generic (the viewer picks the font). */
export function svgFontFamily(name: string): string {
  if (!name || isGeneric(name)) return name || 'sans-serif';
  return `'${name.replace(/'/g, '')}', sans-serif`;
}

/** Bumped whenever a web font finishes loading, so callers can re-measure. */
export const fontEpoch = writable(0);

/** Makes a reactive `$:` statement depend on `fontEpoch`:  $: b = afterFonts($fontEpoch, measure(shape)). */
export const afterFonts = <T>(_epoch: number, value: T): T => value;

const cache = new Map<string, number>();
let ctx: CanvasRenderingContext2D | null | undefined;

function getCtx(): CanvasRenderingContext2D | null {
  if (ctx !== undefined) return ctx;
  if (typeof document === 'undefined') return (ctx = null);
  ctx = document.createElement('canvas').getContext('2d');
  document.fonts?.addEventListener?.('loadingdone', () => {
    cache.clear();
    fontEpoch.update(n => n + 1);
  });
  return ctx;
}

function lineWidth(text: string, s: TextShape): number {
  const font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize}px ${cssFontFamily(s.fontFamily)}`;
  const key = font + '|' + text;
  let w = cache.get(key);
  if (w === undefined) {
    const c = getCtx();
    if (c) { c.font = font; w = c.measureText(text).width; }
    else   { w = text.length * s.fontSize * 0.55; }       // node / tests
    if (cache.size > 5000) cache.clear();
    cache.set(key, w);
  }
  const spaces = s.wordSpacing ? text.split(' ').length - 1 : 0;
  return w + (s.letterSpacing || 0) * [...text].length + (s.wordSpacing || 0) * spaces;
}

/** Local (unrotated) bounds of the rendered text, honouring text-anchor and multiple lines. */
export function textBounds(s: TextShape): BoundingBox {
  const lines = (s.content ?? '').split('\n');
  const w = Math.max(s.fontSize * 0.5, ...lines.map(l => lineWidth(l, s)));
  const h = s.fontSize * (ASCENT + DESCENT) + (lines.length - 1) * lineAdvance(s);
  const x = s.textAnchor === 'middle' ? s.x - w / 2 : s.textAnchor === 'end' ? s.x - w : s.x;
  return { x, y: s.y - s.fontSize * ASCENT, width: w, height: h };
}
