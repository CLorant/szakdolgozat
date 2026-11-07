/**
 * @file Path nodes: building, measuring, splitting, flattening, smoothing, and SVG path data parsing.
 *
 * Polygon, polyline, freehand, Bézier curves and imported SVG paths are all `PathNode[]` + `closed`.
 */

import type { Point, PathNode, BoundingBox } from './types';
import { EPS, round, lerpPt, dist, toRad, applyMatrix, type Matrix } from './math';

/** Cubic-Bézier circle approximation constant. */
export const KAPPA = 0.5522847498;

// ── Constructors / mapping ────────────────────────────────────────────────────

export function corner(x: number, y: number): PathNode {
  return { x, y, hin: null, hout: null, smooth: false };
}

/** A smooth node whose out-handle is `out` and in-handle is its mirror image. */
export function smoothNode(anchor: Point, out: Point): PathNode {
  return {
    x: anchor.x, y: anchor.y,
    hout: { x: out.x, y: out.y },
    hin:  { x: 2 * anchor.x - out.x, y: 2 * anchor.y - out.y },
    smooth: true,
  };
}

/** Applies `f` to anchors and handles. */
export function mapNodes(nodes: PathNode[], f: (p: Point) => Point): PathNode[] {
  return nodes.map(n => {
    const a = f(n);
    const m: PathNode = { x: a.x, y: a.y, hin: n.hin ? f(n.hin) : null, hout: n.hout ? f(n.hout) : null, smooth: n.smooth };
    if (n.sub) m.sub = true;
    return m;
  });
}

// ── Compound paths ────────────────────────────────────────────────────────────

/** Splits a node list into contours (a node flagged `sub` starts a new one). */
export function contours(nodes: PathNode[]): PathNode[][] {
  const out: PathNode[][] = [];
  for (const n of nodes) {
    if (!out.length || n.sub) out.push([]);
    out[out.length - 1].push(n);
  }
  return out;
}

/** Inverse of contours(): flags the first node of every contour after the first. */
export function joinContours(list: PathNode[][]): PathNode[] {
  const out: PathNode[] = [];
  list.filter(c => c.length).forEach((c, k) => c.forEach((n, i) => {
    const { sub: _drop, ...rest } = n;
    out.push(i === 0 && k > 0 ? { ...rest, sub: true } : rest);
  }));
  return out;
}

/** Number of segments over ALL contours (what `seg` indices of nearestOnPath / splitSegment count). */
export function totalSegments(nodes: PathNode[], closed: boolean): number {
  return contours(nodes).reduce((n, c) => n + segmentCount(c.length, closed), 0);
}

export const transformNodes = (nodes: PathNode[], m: Matrix) => mapNodes(nodes, p => applyMatrix(m, p));

/** Catmull-Rom style handles for a node given its neighbours (null = none on that side). */
export function autoHandles(prev: Point | null, cur: Point, next: Point | null) {
  const p = prev ?? cur, n = next ?? cur;
  const tx = (n.x - p.x) / 6, ty = (n.y - p.y) / 6;
  return {
    hin:  prev ? { x: cur.x - tx, y: cur.y - ty } : null,
    hout: next ? { x: cur.x + tx, y: cur.y + ty } : null,
  };
}

// ── Segments ──────────────────────────────────────────────────────────────────

export function segmentCount(n: number, closed: boolean): number {
  return n < 2 ? 0 : closed ? n : n - 1;
}
const isStraight = (a: PathNode, b: PathNode) => !a.hout && !b.hin;

function cubicPoint(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

/** Point on segment i → i+1 at parameter t (0..1). */
export function sampleSegment(a: PathNode, b: PathNode, t: number): Point {
  return isStraight(a, b) ? lerpPt(a, b, t) : cubicPoint(a, a.hout ?? a, b.hin ?? b, b, t);
}

// ── SVG path data ─────────────────────────────────────────────────────────────

export function pathToD(nodes: PathNode[], closed: boolean): string {
  return contours(nodes).map(c => contourToD(c, closed)).join(' ');
}

function contourToD(nodes: PathNode[], closed: boolean): string {
  if (!nodes.length) return '';
  const f = (p: Point) => `${round(p.x)},${round(p.y)}`;
  let d = `M ${f(nodes[0])}`;
  const sc = segmentCount(nodes.length, closed);
  for (let i = 0; i < sc; i++) {
    const a = nodes[i], b = nodes[(i + 1) % nodes.length];
    const closing = i === nodes.length - 1;
    if (closing && isStraight(a, b)) continue;           // 'Z' draws the straight closing side
    d += isStraight(a, b)
      ? ` L ${f(b)}`
      : ` C ${f(a.hout ?? a)} ${f(b.hin ?? b)} ${f(b)}`;
  }
  if (closed && nodes.length > 1) d += ' Z';
  return d;
}

// ── Bounds ────────────────────────────────────────────────────────────────────

/** t ∈ (0,1) where the 1-D cubic Bézier has a local extremum. */
function cubicExtrema(a0: number, a1: number, a2: number, a3: number): number[] {
  const A = -a0 + 3 * a1 - 3 * a2 + a3;
  const B = 2 * (a0 - 2 * a1 + a2);
  const C = a1 - a0;
  const roots: number[] = [];
  if (Math.abs(A) < EPS) {
    if (Math.abs(B) > EPS) roots.push(-C / B);
  } else {
    const disc = B * B - 4 * A * C;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      roots.push((-B + s) / (2 * A), (-B - s) / (2 * A));
    }
  }
  return roots.filter(t => t > 0 && t < 1);
}

/** Tight bounds of the actual curve (not the control polygon), over all contours. */
export function pathBounds(nodes: PathNode[], closed: boolean): BoundingBox {
  const parts = contours(nodes);
  if (parts.length <= 1) return contourBounds(nodes, closed);
  const bs = parts.map(c => contourBounds(c, closed));
  const x0 = Math.min(...bs.map(b => b.x)), y0 = Math.min(...bs.map(b => b.y));
  const x1 = Math.max(...bs.map(b => b.x + b.width)), y1 = Math.max(...bs.map(b => b.y + b.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function contourBounds(nodes: PathNode[], closed: boolean): BoundingBox {
  if (!nodes.length) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (p: Point) => {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  };
  nodes.forEach(add);
  const sc = segmentCount(nodes.length, closed);
  for (let i = 0; i < sc; i++) {
    const a = nodes[i], b = nodes[(i + 1) % nodes.length];
    if (isStraight(a, b)) continue;
    const p1 = a.hout ?? a, p2 = b.hin ?? b;
    const ts = [...cubicExtrema(a.x, p1.x, p2.x, b.x), ...cubicExtrema(a.y, p1.y, p2.y, b.y)];
    for (const t of ts) add(cubicPoint(a, p1, p2, b, t));
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// ── Editing helpers ───────────────────────────────────────────────────────────

export interface NearestResult { seg: number; t: number; point: Point; dist: number; }

/** Closest point on the path to `p` (polyline approximation, 24 steps / segment). */
export function nearestOnPath(nodes: PathNode[], closed: boolean, p: Point, steps = 24): NearestResult | null {
  let best: NearestResult | null = null;
  let offset = 0;
  for (const c of contours(nodes)) {
    const sc = segmentCount(c.length, closed);
    for (let i = 0; i < sc; i++) {
      const a = c[i], b = c[(i + 1) % c.length];
      let prev = sampleSegment(a, b, 0);
      for (let k = 1; k <= steps; k++) {
        const cur = sampleSegment(a, b, k / steps);
        const dx = cur.x - prev.x, dy = cur.y - prev.y, l2 = dx * dx + dy * dy;
        const u = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - prev.x) * dx + (p.y - prev.y) * dy) / l2)) : 0;
        const q = { x: prev.x + u * dx, y: prev.y + u * dy };
        const d = dist(p, q);
        if (!best || d < best.dist) best = { seg: offset + i, t: (k - 1 + u) / steps, point: q, dist: d };
        prev = cur;
      }
    }
    offset += sc;
  }
  return best;
}

/** Inserts a node into segment `seg` at parameter `t` (de Casteljau — shape is unchanged). */
export function splitSegment(nodes: PathNode[], closed: boolean, seg: number, t: number): { nodes: PathNode[]; index: number } {
  const parts = contours(nodes);
  if (parts.length > 1) {                                   // compound: split inside the contour that owns `seg`
    let offset = 0, start = 0;
    for (let k = 0; k < parts.length; k++) {
      const sc = segmentCount(parts[k].length, closed);
      if (seg < offset + sc) {
        const r = splitContour(parts[k], closed, seg - offset, t);
        const next = parts.slice();
        next[k] = r.nodes;
        return { nodes: joinContours(next), index: start + r.index };
      }
      offset += sc; start += parts[k].length;
    }
    return { nodes, index: 0 };
  }
  return splitContour(nodes, closed, seg, t);
}

function splitContour(nodes: PathNode[], closed: boolean, seg: number, t: number): { nodes: PathNode[]; index: number } {
  const n = nodes.length;
  const ia = seg, ib = (seg + 1) % n;
  const a = nodes[ia], b = nodes[ib];
  const out = nodes.map(x => ({ ...x }));
  let mid: PathNode;
  if (isStraight(a, b)) {
    const m = lerpPt(a, b, t);
    mid = corner(m.x, m.y);
  } else {
    const p1 = a.hout ?? a, p2 = b.hin ?? b;
    const q0 = lerpPt(a, p1, t), q1 = lerpPt(p1, p2, t), q2 = lerpPt(p2, b, t);
    const r0 = lerpPt(q0, q1, t), r1 = lerpPt(q1, q2, t);
    const s = lerpPt(r0, r1, t);
    mid = { x: s.x, y: s.y, hin: r0, hout: r1, smooth: true };
    out[ia].hout = dist(q0, a) < EPS ? null : q0;
    out[ib].hin  = dist(q2, b) < EPS ? null : q2;
  }
  const index = ib === 0 ? n : ib;     // wrapping closing segment → append at the end
  out.splice(index, 0, mid);
  return { nodes: out, index };
}

/** Removes node `idx` (refuses to go below 2 nodes open / 3 nodes closed). */
export function removeNode(nodes: PathNode[], closed: boolean, idx: number): PathNode[] {
  const parts = contours(nodes);
  let start = 0;
  for (let k = 0; k < parts.length; k++) {
    const end = start + parts[k].length;
    if (idx < end) {
      if (parts[k].length <= (closed ? 3 : 2)) return nodes;     // each contour keeps its minimum
      const next = parts.slice();
      next[k] = parts[k].filter((_, i) => start + i !== idx);
      return joinContours(next);
    }
    start = end;
  }
  return nodes;
}

// ── Freehand ──────────────────────────────────────────────────────────────────

function segDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  if (l2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/** Ramer–Douglas–Peucker (iterative, so long strokes cannot overflow the stack). */
export function simplifyRDP(pts: Point[], tol: number): Point[] {
  const n = pts.length;
  if (n < 3) return pts.slice();
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = segDist(pts[i], pts[s], pts[e]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (idx >= 0 && maxD > tol) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Raw mouse samples → simplified, smoothed Bézier nodes. */
export function freehandToNodes(points: Point[], tolerance = 1.5): PathNode[] {
  const pts = points.filter((p, i) => i === 0 || dist(p, points[i - 1]) > 0.01);
  if (pts.length < 2) return pts.map(p => corner(p.x, p.y));
  const s = simplifyRDP(pts, tolerance);
  if (s.length === 2) return s.map(p => corner(p.x, p.y));
  return s.map((p, i) => {
    const h = autoHandles(i > 0 ? s[i - 1] : null, p, i < s.length - 1 ? s[i + 1] : null);
    return { x: p.x, y: p.y, hin: h.hin, hout: h.hout, smooth: true };
  });
}

// ── SVG arc → cubic segments (SVG spec, appendix F.6.5) ───────────────────────

/** Returns cubic segments `[c1x, c1y, c2x, c2y, x, y]`. */
export function arcToCubics(
  x1: number, y1: number, rx: number, ry: number, phiDeg: number,
  fa: boolean, fs: boolean, x2: number, y2: number,
): number[][] {
  if (x1 === x2 && y1 === y2) return [];
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (rx < EPS || ry < EPS) return [[x1, y1, x2, y2, x2, y2]];

  const phi = toRad(phiDeg), cosP = Math.cos(phi), sinP = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p =  cosP * dx + sinP * dy;
  const y1p = -sinP * dx + cosP * dy;

  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; }

  const rx2 = rx * rx, ry2 = ry * ry;
  const num = Math.max(0, rx2 * ry2 - rx2 * y1p * y1p - ry2 * x1p * x1p);
  const den = rx2 * y1p * y1p + ry2 * x1p * x1p;
  let co = den === 0 ? 0 : Math.sqrt(num / den);
  if (fa === fs) co = -co;
  const cxp =  co * rx * y1p / ry;
  const cyp = -co * ry * x1p / rx;
  const cx = cosP * cxp - sinP * cyp + (x1 + x2) / 2;
  const cy = sinP * cxp + cosP * cyp + (y1 + y2) / 2;

  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const ux = (x1p - cxp) / rx, uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx, vy = (-y1p - cyp) / ry;
  const th1 = ang(1, 0, ux, uy);
  let dth = ang(ux, uy, vx, vy);
  if (!fs && dth > 0) dth -= 2 * Math.PI;
  if (fs && dth < 0)  dth += 2 * Math.PI;

  const n = Math.max(1, Math.ceil(Math.abs(dth) / (Math.PI / 2) - 1e-9));
  const d = dth / n, k = (4 / 3) * Math.tan(d / 4);
  const map = (px: number, py: number): [number, number] => [
    cx + rx * cosP * px - ry * sinP * py,
    cy + rx * sinP * px + ry * cosP * py,
  ];

  const out: number[][] = [];
  for (let i = 0; i < n; i++) {
    const a1 = th1 + i * d, a2 = a1 + d;
    const c1 = map(Math.cos(a1) - k * Math.sin(a1), Math.sin(a1) + k * Math.cos(a1));
    const c2 = map(Math.cos(a2) + k * Math.sin(a2), Math.sin(a2) - k * Math.cos(a2));
    const e  = i === n - 1 ? [x2, y2] : map(Math.cos(a2), Math.sin(a2));
    out.push([c1[0], c1[1], c2[0], c2[1], e[0], e[1]]);
  }
  return out;
}

// ── SVG path-data parser ──────────────────────────────────────────────────────

export interface Subpath { nodes: PathNode[]; closed: boolean; }

const NUM = /[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/y;

class Reader {
  i = 0;
  constructor(public s: string) {}
  private ws() { while (this.i < this.s.length && /[\s,]/.test(this.s[this.i])) this.i++; }
  isCmd()  { this.ws(); return this.i < this.s.length && /[a-zA-Z]/.test(this.s[this.i]); }
  hasNum() { this.ws(); return this.i < this.s.length && /[-+.\d]/.test(this.s[this.i]); }
  cmd()    { return this.s[this.i++]; }
  num(): number {
    this.ws();
    NUM.lastIndex = this.i;
    const m = NUM.exec(this.s);
    if (!m) throw new Error('number expected');
    this.i = NUM.lastIndex;
    return parseFloat(m[0]);
  }
  flag(): boolean {
    this.ws();
    const c = this.s[this.i];
    if (c !== '0' && c !== '1') throw new Error('flag expected');
    this.i++;
    return c === '1';
  }
}

function detectSmooth(nodes: PathNode[]) {
  for (const n of nodes) {
    if (!n.hin || !n.hout) continue;
    const v1x = n.x - n.hin.x, v1y = n.y - n.hin.y, v2x = n.hout.x - n.x, v2y = n.hout.y - n.y;
    const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
    if (l1 < EPS || l2 < EPS) continue;
    const cross = Math.abs(v1x * v2y - v1y * v2x) / (l1 * l2);
    const dot = v1x * v2x + v1y * v2y;
    if (cross < 0.01 && dot > 0) n.smooth = true;
  }
}

/**
 * Parses SVG path data (M L H V C S Q T A Z, absolute and relative) into one
 * subpath per `M`. Quadratics and arcs become cubics. Malformed tails are ignored.
 */
export function parsePathData(d: string): Subpath[] {
  const out: Subpath[] = [];
  const rd = new Reader(d);
  let nodes: PathNode[] = [];
  let cx = 0, cy = 0, sx = 0, sy = 0;
  let lastC = null as Point | null, lastQ = null as Point | null;
  let cmd = '';

  const flush = (closed: boolean) => {
    if (closed && nodes.length > 1 && dist(nodes[0], nodes[nodes.length - 1]) < EPS) {
      const last = nodes.pop()!;
      if (last.hin) nodes[0] = { ...nodes[0], hin: last.hin };
    }
    if (nodes.length >= 2) { detectSmooth(nodes); out.push({ nodes, closed }); }
    nodes = [];
  };
  const ensure = () => { if (!nodes.length) nodes.push(corner(cx, cy)); };
  const lineTo = (x: number, y: number) => { ensure(); nodes.push(corner(x, y)); cx = x; cy = y; };
  const cubicTo = (x1: number, y1: number, x2: number, y2: number, x: number, y: number) => {
    ensure();
    nodes[nodes.length - 1].hout = { x: x1, y: y1 };
    nodes.push({ x, y, hin: { x: x2, y: y2 }, hout: null, smooth: false });
    lastC = { x: x2, y: y2 }; cx = x; cy = y;
  };
  const quadTo = (qx: number, qy: number, x: number, y: number) => {
    const x0 = cx, y0 = cy;
    cubicTo(x0 + 2 / 3 * (qx - x0), y0 + 2 / 3 * (qy - y0), x + 2 / 3 * (qx - x), y + 2 / 3 * (qy - y), x, y);
    lastC = null; lastQ = { x: qx, y: qy };
  };

  try {
    for (;;) {
      if (rd.isCmd()) cmd = rd.cmd();
      else if (rd.hasNum()) {
        if (!cmd || cmd === 'Z' || cmd === 'z') break;
        if (cmd === 'M') cmd = 'L'; else if (cmd === 'm') cmd = 'l';
      } else break;

      const rel = cmd >= 'a';
      const C = cmd.toUpperCase();
      const ox = rel ? cx : 0, oy = rel ? cy : 0;
      const prevC = lastC, prevQ = lastQ;
      lastC = null; lastQ = null;

      switch (C) {
        case 'M': {
          flush(false);
          const x = rd.num() + ox, y = rd.num() + oy;
          cx = sx = x; cy = sy = y;
          nodes = [corner(x, y)];
          break;
        }
        case 'L': lineTo(rd.num() + ox, rd.num() + oy); break;
        case 'H': lineTo(rd.num() + ox, cy); break;
        case 'V': lineTo(cx, rd.num() + oy); break;
        case 'C': {
          const x1 = rd.num() + ox, y1 = rd.num() + oy, x2 = rd.num() + ox, y2 = rd.num() + oy;
          cubicTo(x1, y1, x2, y2, rd.num() + ox, rd.num() + oy);
          break;
        }
        case 'S': {
          const x2 = rd.num() + ox, y2 = rd.num() + oy;
          const x = rd.num() + ox, y = rd.num() + oy;
          cubicTo(prevC ? 2 * cx - prevC.x : cx, prevC ? 2 * cy - prevC.y : cy, x2, y2, x, y);
          break;
        }
        case 'Q': { const qx = rd.num() + ox, qy = rd.num() + oy; quadTo(qx, qy, rd.num() + ox, rd.num() + oy); break; }
        case 'T': {
          const qx = prevQ ? 2 * cx - prevQ.x : cx, qy = prevQ ? 2 * cy - prevQ.y : cy;
          quadTo(qx, qy, rd.num() + ox, rd.num() + oy);
          break;
        }
        case 'A': {
          const rx = rd.num(), ry = rd.num(), rot = rd.num();
          const fa = rd.flag(), fs = rd.flag();
          const x = rd.num() + ox, y = rd.num() + oy;
          if (rx === 0 || ry === 0) { lineTo(x, y); break; }
          ensure();
          for (const s of arcToCubics(cx, cy, rx, ry, rot, fa, fs, x, y)) cubicTo(s[0], s[1], s[2], s[3], s[4], s[5]);
          lastC = null;
          break;
        }
        case 'Z': flush(true); cx = sx; cy = sy; break;
        default: throw new Error('unknown command');
      }
    }
  } catch { /* keep what was parsed so far */ }
  flush(false);
  return out;
}
