/**
 * @file Dash patterns that scale with the stroke.
 *
 * A shape stores the plain SVG value (`stroke-dasharray`, absolute user units), so exported files
 * are standard and any viewer renders them identically. The EDITOR, however, thinks in presets
 * defined relative to the stroke width and corrects for the line cap:
 *
 *   • lengths are multiples of the stroke width (a dash of 3·w and a gap of 2·w look the same at
 *     any thickness — a fixed "6,4" becomes a solid line at width 12);
 *   • round and square caps stick out by w/2 at both ends of every dash, which eats w from each
 *     gap and adds w to each dash. The presets compensate so the VISIBLE dash / gap are the
 *     same for every cap. Dots (visible length w) are zero-length dashes + caps.
 *
 * Changing the width (or cap) of a shape re-generates its preset. Any other pattern (typed in the
 * panel, imported) is absolute, as in SVG, and does not follow the width.
 */
import type { LineCap } from './types';

export type DashKind = 'solid' | 'dashed' | 'dotted' | 'dash-dot';
export const DASH_KINDS: readonly DashKind[] = ['solid', 'dashed', 'dotted', 'dash-dot'];
export const DASH_LABEL: Record<DashKind, string> = {
  'solid': 'Solid', 'dashed': 'Dashed', 'dotted': 'Dotted', 'dash-dot': 'Dash-dot',
};

/** VISIBLE lengths in units of the stroke width: dash, gap, dash, gap, … (a dot is w × w). */
const SPEC: Record<Exclude<DashKind, 'solid'>, readonly number[]> = {
  'dashed':   [3, 2],
  'dotted':   [1, 1.5],
  'dash-dot': [3, 1.5, 1, 1.5],
};
/** With round / square caps a dot is a dash of (almost) zero length; some renderers ignore exact 0. */
const DOT = 0.01;
/** Strokes thinner than this are treated as this thick for pattern purposes (hairlines stay readable). */
export const MIN_DASH_WIDTH = 0.5;

const r2 = (n: number) => Math.round(n * 100) / 100;
const capSticks = (cap: LineCap) => cap !== 'butt';

function lengths(kind: Exclude<DashKind, 'solid'>, width: number, cap: LineCap): number[] {
  const w = Math.max(width, MIN_DASH_WIDTH);
  const sticks = capSticks(cap);
  return SPEC[kind].map((v, i) => {
    const visible = v * w;
    const isDash = i % 2 === 0;
    if (isDash) return sticks ? Math.max(visible - w, DOT) : Math.max(visible, DOT);      // caps add w
    return sticks ? visible + w : visible;                                                   // caps eat w
  }).map(r2);
}

/** The stroke-dasharray for a preset at the given stroke width and cap ('' = solid). */
export function dashFor(kind: DashKind, width: number, cap: LineCap): string {
  if (kind === 'solid') return '';
  return lengths(kind, width, cap).join(' ');
}

const parse = (d: string) => d.split(/[\s,]+/).filter(Boolean).map(Number);
const close = (a: number[], b: number[]) =>
  a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= 0.02 + 0.01 * Math.abs(b[i]));

/** Which preset does this value correspond to at this width and cap? 'custom' if none. */
export function inferDash(dash: string, width: number, cap: LineCap): DashKind | 'custom' {
  if (!dash || !dash.trim()) return 'solid';
  const v = parse(dash);
  if (!v.length || v.some(n => !Number.isFinite(n))) return 'custom';
  for (const k of DASH_KINDS) if (k !== 'solid' && close(v, parse(dashFor(k, width, cap)))) return k;
  return 'custom';
}

/**
 * The dash value after the stroke changed from `from` to `to`: a preset is regenerated for the new
 * width and cap. Any other pattern (typed by the user, imported) is in absolute units, exactly as in
 * SVG, and stays as it is.
 */
export function reflowDash(
  dash: string, from: { width: number; cap: LineCap }, to: { width: number; cap: LineCap },
): string {
  if (!dash) return dash;
  const kind = inferDash(dash, from.width, from.cap);
  return kind !== 'custom' ? dashFor(kind, to.width, to.cap) : dash;
}

/** Text typed by the user → dash lengths ('' = solid). null = not a valid pattern. */
export function parseDashInput(text: string): number[] | null {
  const t = text.trim();
  if (!t) return [];
  const v = t.split(/[\s,]+/).map(Number);
  if (v.length > 8 || v.some(n => !Number.isFinite(n) || n < 0) || !v.some(n => n > 0)) return null;
  return v;
}
export const formatDash = (v: number[]) => v.map(r2).join(' ');
