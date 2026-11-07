/**
 * @file "Stroke to path": the painted stroke of a shape becomes a filled path.
 *
 * The outline of the stroke (width, caps, joins, dashes) is computed with Clipper's polygon offsetting on a finely
 * flattened copy of the path, so the result is a POLYGON approximation (point spacing ≈ 1.5 px, round joins/caps within
 * 0.02 px) with the right holes and overlaps resolved. Miter joins use SVG's default limit of 4, beyond which Clipper
 * squares the corner off (SVG bevels it): a tiny difference at very sharp corners.
 * Text has no stroke in this editor, so there is nothing to convert; groups convert their children.
 */

import ClipperLib from 'clipper-lib';
import type { Shape, PathShape, PathNode, Point, LineCap, LineJoin } from './types';
import { contours, sampleSegment, joinContours, corner } from './path';
import { toPathShape, makeGroup, uid, getRotationOrigin } from './shapes';
import { rotatePoint } from './math';

const SCALE = 100;            // clipper works on integers: 0.01 px
const MIN_WIDTH = 0.01;

/** Does stroking this shape produce anything? */
export function hasStroke(s: Shape): boolean {
  if (s.type === 'group') return s.children.some(hasStroke);
  return s.type !== 'text' && s.stroke !== 'none' && s.strokeWidth > MIN_WIDTH;
}

// ── flattening ────────────────────────────────────────────────────────────────

function flatten(nodes: PathNode[], closed: boolean, step = 1.5): Point[] {
  const pts: Point[] = [];
  const n = nodes.length;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = nodes[i], b = nodes[(i + 1) % n];
    const curved = !!(a.hout || b.hin);
    const len = Math.hypot(b.x - a.x, b.y - a.y)
      + (curved ? Math.hypot((a.hout ?? a).x - a.x, (a.hout ?? a).y - a.y) + Math.hypot(b.x - (b.hin ?? b).x, b.y - (b.hin ?? b).y) : 0);
    const steps = curved ? Math.min(200, Math.max(6, Math.ceil(len / step))) : 1;
    for (let k = 0; k < steps; k++) pts.push(curved ? sampleSegment(a, b, k / steps) : { x: a.x, y: a.y });
  }
  if (!closed && n) pts.push({ x: nodes[n - 1].x, y: nodes[n - 1].y });
  // drop repeated points (zero-length segments confuse the offsetter)
  return pts.filter((p, i) => !i || Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) > 1e-6);
}

/** Splits a polyline into the "on" pieces of a dash pattern (SVG semantics: the pattern repeats; odd lists are doubled). */
function dashPolyline(pts: Point[], closed: boolean, pattern: number[], offset = 0): Point[][] {
  const pat = pattern.length % 2 ? [...pattern, ...pattern] : pattern;
  const line = closed ? [...pts, pts[0]] : pts;
  const out: Point[][] = [];
  // start inside the pattern at `offset` (SVG stroke-dashoffset; negative values start before it)
  const period = pat.reduce((a, b) => a + b, 0);
  let idx = 0, on = true, o = period > 0 ? ((offset % period) + period) % period : 0;
  while (o > pat[idx]) { o -= pat[idx]; idx = (idx + 1) % pat.length; on = !on; }
  let left = pat[idx] - o;
  let cur: Point[] = [line[0]];
  for (let i = 1; i < line.length; i++) {
    let a = line[i - 1];
    const b = line[i];
    let seg = Math.hypot(b.x - a.x, b.y - a.y);
    while (seg > left && left >= 0) {
      const t = left / seg;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      if (on) { cur.push(p); out.push(cur); cur = []; } else cur = [p];
      on = !on; idx = (idx + 1) % pat.length; seg -= left; a = p; left = pat[idx];
      if (left === 0 && pat.every(v => v === 0)) return out;
    }
    left -= seg;
    if (on) cur.push(b);
  }
  if (on && cur.length > 1) out.push(cur);
  return out.filter(p => p.length > 1);
}

const parseDash = (d: string): number[] => {
  const v = d.split(/[\s,]+/).map(Number).filter(Number.isFinite);
  return v.length && v.every(x => x >= 0) && v.some(x => x > 0) ? v : [];
};

// ── emboldening ───────────────────────────────────────────────────────────────

/**
 * Grows closed contours (glyph outlines, filled nonzero) outwards by `delta` px: a synthesized bold, the way
 * browsers draw one. The result is polygons (contours are flattened finely first), holes included.
 */
export function emboldenContours(list: readonly PathNode[][], delta: number): Point[][] {
  const CL = ClipperLib as any;
  const toClip = (pts: Point[]) => pts.map(p => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) }));
  const c = new CL.Clipper();
  for (const nodes of list) {
    const pts = flatten(nodes, true, 0.4);
    if (pts.length >= 3) c.AddPath(toClip(pts), CL.PolyType.ptSubject, true);
  }
  const union: { X: number; Y: number }[][] = [];
  c.Execute(CL.ClipType.ctUnion, union, CL.PolyFillType.pftNonZero, CL.PolyFillType.pftNonZero);
  const co = new CL.ClipperOffset(4, 0.01 * SCALE);
  co.AddPaths(union, CL.JoinType.jtMiter, CL.EndType.etClosedPolygon);
  const out: { X: number; Y: number }[][] = [];
  co.Execute(out, delta * SCALE);
  return out.map(poly => poly.map(p => ({ x: p.X / SCALE, y: p.Y / SCALE })));
}

// ── outline ───────────────────────────────────────────────────────────────────

/** Outline polygons (closed point lists, holes included) of a stroke along `nodes`. */
export function strokeOutline(nodes: PathNode[], closed: boolean, width: number, cap: LineCap, join: LineJoin, dash = '', dashOffset = 0): Point[][] {
  const CL = ClipperLib as any;
  const co = new CL.ClipperOffset(4, 0.02 * SCALE);                                // miter limit 4 (SVG default), arc tolerance
  const jt = join === 'round' ? CL.JoinType.jtRound : join === 'bevel' ? CL.JoinType.jtSquare : CL.JoinType.jtMiter;
  const pattern = parseDash(dash);
  const toClip = (pts: Point[]) => pts.map(p => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) }));

  for (const c of contours(nodes)) {
    const pts = flatten(c, closed);
    if (pts.length < 2) {
      if (pts.length === 1 && cap !== 'butt') co.AddPath(toClip([pts[0], { x: pts[0].x + 0.001, y: pts[0].y }]), jt, cap === 'round' ? CL.EndType.etOpenRound : CL.EndType.etOpenSquare);
      continue;
    }
    if (pattern.length) {
      const end = cap === 'round' ? CL.EndType.etOpenRound : cap === 'square' ? CL.EndType.etOpenSquare : CL.EndType.etOpenButt;
      for (const piece of dashPolyline(pts, closed, pattern, dashOffset)) co.AddPath(toClip(piece), jt, end);
    } else if (closed && pts.length >= 3) {
      co.AddPath(toClip(pts), jt, CL.EndType.etClosedLine);
    } else {
      co.AddPath(toClip(pts), jt, cap === 'round' ? CL.EndType.etOpenRound : cap === 'square' ? CL.EndType.etOpenSquare : CL.EndType.etOpenButt);
    }
  }
  const solution: { X: number; Y: number }[][] = [];
  co.Execute(solution, (Math.max(width, MIN_WIDTH) / 2) * SCALE);
  return solution.map(poly => poly.map(p => ({ x: p.X / SCALE, y: p.Y / SCALE })));
}

// ── shapes ────────────────────────────────────────────────────────────────────

/**
 * The replacement for a shape: its stroke as a filled path (the stroke paint becomes the fill). A shape that also has a
 * fill becomes a group of [the fill without stroke, the stroke path]. Returns null when there is nothing to convert.
 * The picture does not change (except for the polygon approximation described above).
 */
export function strokeToPath(s: Shape): Shape | null {
  if (s.type === 'group') {
    let changed = false;
    const children = s.children.map(c => { const r = strokeToPath(c); if (r) changed = true; return r ?? c; });
    return changed ? { ...s, children } : null;
  }
  if (!hasStroke(s)) return null;
  const p = toPathShape(s);
  if (!p) return null;

  const polys = strokeOutline(p.nodes, p.closed, s.strokeWidth, s.strokeLinecap, s.strokeLinejoin, s.strokeDasharray, s.strokeDashoffset ?? 0);
  if (!polys.length) return null;
  // into document space (the shape turns about the centre of ITS box; the new path will turn about its own)
  const o = getRotationOrigin(s);
  const rot = (pt: Point) => (s.rotation ? rotatePoint(pt, o, s.rotation) : pt);
  const nodes: PathNode[] = joinContours(polys.map(poly => poly.map(pt => { const q = rot(pt); return corner(q.x, q.y); })));

  const paint = s.stroke;                                  // a color or a gradient: either is a valid fill
  const strokePath: PathShape = {
    id: uid(), type: 'path', name: s.name ? `${s.name} stroke` : '', visible: s.visible,
    fill: paint, stroke: 'none', strokeWidth: 0, opacity: 1, rotation: 0,
    strokeLinecap: 'round', strokeLinejoin: 'round', strokeDasharray: '', nodes, closed: true,
  };
  const hasFill = s.fill !== 'none' && s.type !== 'line';
  if (!hasFill) return { ...strokePath, id: s.id, name: s.name, opacity: s.opacity };

  const fillShape: Shape = { ...s, id: uid(), stroke: 'none', strokeWidth: 0, strokeDasharray: '', opacity: 1, name: s.name ? `${s.name} fill` : '' };
  return { ...makeGroup([fillShape, strokePath], s.name), id: s.id, opacity: s.opacity };
}
