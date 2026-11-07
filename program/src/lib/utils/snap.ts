/**
 * @file Snapping to other objects, the canvas and ruler guides. Pure functions.
 *
 * A TARGET is a coordinate on one axis (the x of a vertical edge / center line, or the y of a horizontal one) together with
 * how far that object extends along the other axis, so the visible guide line can span both objects.
 * Sources (what is being moved or drawn) are compared with targets in document units; the pointer's reach is given in
 * screen pixels by the callers (threshold = px / zoom).
 */

import type { BoundingBox, Shape, Point, RulerGuide } from './types';
import { getWorldBounds } from './shapes';
import type { Guide } from '../stores/interaction';

export interface Target { v: number; lo: number; hi: number; line: boolean; }
export interface Targets { x: Target[]; y: Target[]; }

export const SNAP_COLOR = '#ff2d95';
/** How near (screen px) a coordinate must be to snap. */
export const SNAP_PX = 6;

/** Left / center / right and top / middle / bottom of a box. */
export function boxTargets(b: BoundingBox, out: Targets = { x: [], y: [] }): Targets {
  const x1 = b.x, x2 = b.x + b.width, y1 = b.y, y2 = b.y + b.height;
  for (const v of [x1, (x1 + x2) / 2, x2]) out.x.push({ v, lo: y1, hi: y2, line: true });
  for (const v of [y1, (y1 + y2) / 2, y2]) out.y.push({ v, lo: x1, hi: x2, line: true });
  return out;
}

/**
 * Targets of the visible shapes (except `exclude`), optionally the canvas (edges and center) and the ruler guides.
 * Shapes are expected in the frame the user works in (the entered group's), where the canvas is only meaningful if that
 * frame is the page itself.
 */
export function collectTargets(
  shapes: readonly Shape[], exclude: ReadonlySet<string>,
  opts: { canvas?: { width: number; height: number } | null; guides?: readonly RulerGuide[] } = {},
): Targets {
  const t: Targets = { x: [], y: [] };
  for (const s of shapes) {
    if (!s.visible || exclude.has(s.id)) continue;
    const b = getWorldBounds(s);
    if (b.width || b.height) boxTargets(b, t);
  }
  if (opts.canvas) {
    const { width: w, height: h } = opts.canvas;
    for (const v of [0, w / 2, w]) t.x.push({ v, lo: 0, hi: h, line: true });
    for (const v of [0, h / 2, h]) t.y.push({ v, lo: 0, hi: w, line: true });
  }
  for (const g of opts.guides ?? []) (g.axis === 'x' ? t.x : t.y).push({ v: g.pos, lo: 0, hi: 0, line: false });   // the guide is drawn by itself
  return t;
}

export interface AxisSnap { delta: number; v: number; hits: Target[]; }

/** The smallest correction that puts one of `sources` on a target, if any is within `threshold`. */
export function snapAxis(sources: readonly number[], targets: readonly Target[], threshold: number): AxisSnap | null {
  let best: { d: number; t: Target } | null = null;
  for (const s of sources) for (const t of targets) {
    const d = t.v - s;
    if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.d) - 1e-9)) best = { d, t };
  }
  if (!best) return null;
  const v = best.t.v;
  return { delta: best.d, v, hits: targets.filter(t => Math.abs(t.v - v) < 1e-6) };
}

/** Magenta lines for snapped axes: they span the snapped box and every object that lines up with it. */
export function snapLines(x: AxisSnap | null, y: AxisSnap | null, box: BoundingBox): Guide[] {
  const out: Guide[] = [];
  if (x) {
    const hits = x.hits.filter(h => h.line);
    if (hits.length) out.push({ kind: 'line', x1: x.v, x2: x.v, y1: Math.min(box.y, ...hits.map(h => h.lo)), y2: Math.max(box.y + box.height, ...hits.map(h => h.hi)), color: SNAP_COLOR });
  }
  if (y) {
    const hits = y.hits.filter(h => h.line);
    if (hits.length) out.push({ kind: 'line', y1: y.v, y2: y.v, x1: Math.min(box.x, ...hits.map(h => h.lo)), x2: Math.max(box.x + box.width, ...hits.map(h => h.hi)), color: SNAP_COLOR });
  }
  return out;
}

/** Snap a point (drawing tools): each axis independently. */
export function snapPointTo(p: Point, targets: Targets, threshold: number): { p: Point; guides: Guide[] } {
  const sx = snapAxis([p.x], targets.x, threshold), sy = snapAxis([p.y], targets.y, threshold);
  const q = { x: p.x + (sx?.delta ?? 0), y: p.y + (sy?.delta ?? 0) };
  return { p: q, guides: snapLines(sx, sy, { x: q.x, y: q.y, width: 0, height: 0 }) };
}

/** Snap a box that is being moved: its edges and center on both axes. Returns the correction to add to the move. */
export function snapBox(box: BoundingBox, targets: Targets, threshold: number, axes: { x?: boolean; y?: boolean } = { x: true, y: true }) {
  const sx = axes.x === false ? null : snapAxis([box.x, box.x + box.width / 2, box.x + box.width], targets.x, threshold);
  const sy = axes.y === false ? null : snapAxis([box.y, box.y + box.height / 2, box.y + box.height], targets.y, threshold);
  const dx = sx?.delta ?? 0, dy = sy?.delta ?? 0;
  const moved = { ...box, x: box.x + dx, y: box.y + dy };
  return { dx, dy, snappedX: !!sx, snappedY: !!sy, guides: snapLines(sx, sy, moved) };
}
