/**
 * @file Circular arcs for the Arc tool: the circle through three points (the two ends and one point on the arc)
 * and its Bézier approximation. SVG paths here are cubic only, so an arc becomes up to four cubic segments of at
 * most 90° each (the error is below 0.03 % of the radius).
 */
import type { Point, PathNode } from './types';

export interface Arc {
  /** Centre and radius of the circle. */
  c: Point;
  r: number;
  /** Angle of the start point (radians) and the signed sweep from it to the end point. */
  start: number;
  sweep: number;
}

/** Degrees → the arc between a and b that bulges towards `towards` (the side `towards` is on) with this sweep. */
function arcWithSweep(a: Point, b: Point, sweepDeg: number, towards: Point): Arc | null {
  const dx = b.x - a.x, dy = b.y - a.y, chord = Math.hypot(dx, dy);
  if (chord < 1e-9) return null;
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  let n = { x: -dy / chord, y: dx / chord };                       // unit normal of the chord …
  if ((towards.x - m.x) * n.x + (towards.y - m.y) * n.y < 0) n = { x: -n.x, y: -n.y };   // … on the bulge side
  const th = (sweepDeg * Math.PI) / 180;
  const r = chord / (2 * Math.sin(th / 2));
  const c = { x: m.x - n.x * r * Math.cos(th / 2), y: m.y - n.y * r * Math.cos(th / 2) };
  return orient(a, b, c, r, th, { x: c.x + n.x * r, y: c.y + n.y * r });
}

/** Signed sweep from a to b around c that passes the apex point `q`. */
function orient(a: Point, b: Point, c: Point, r: number, th: number, q: Point): Arc {
  const start = Math.atan2(a.y - c.y, a.x - c.x);
  const mid = Math.atan2(q.y - c.y, q.x - c.x);
  const diff = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));      // → (−π, π]
  const sweep = Math.abs(diff(start + th / 2 - mid)) < Math.abs(diff(start - th / 2 - mid)) ? th : -th;
  return { c, r, start, sweep };
}

/**
 * The arc from a to b through p. `stepDeg` rounds the sweep to multiples of that angle (Shift: 15°, so 90° and
 * 180° are easy to hit). Returns null when the three points are (nearly) on one line: that is a straight line.
 */
export function arcThrough(a: Point, b: Point, p: Point, stepDeg = 0): Arc | null {
  const ax = a.x - p.x, ay = a.y - p.y, bx = b.x - p.x, by = b.y - p.y;
  const d = 2 * (ax * by - ay * bx);
  const chord = Math.hypot(b.x - a.x, b.y - a.y);
  if (chord < 1e-9 || Math.abs(d) < 1e-9 * Math.max(1, chord * chord)) return null;
  // circumcentre (relative to p)
  const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by;
  const c = { x: p.x + (by * a2 - ay * b2) / d, y: p.y + (ax * b2 - bx * a2) / d };
  const r = Math.hypot(a.x - c.x, a.y - c.y);
  if (!Number.isFinite(r) || r > chord * 1e4) return null;        // practically straight
  // sweep: cos(θ/2) = −t / r, t = signed distance of the centre from the chord, positive towards p
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  let n = { x: -(b.y - a.y) / chord, y: (b.x - a.x) / chord };
  if ((p.x - m.x) * n.x + (p.y - m.y) * n.y < 0) n = { x: -n.x, y: -n.y };
  const t = (c.x - m.x) * n.x + (c.y - m.y) * n.y;
  const th = 2 * Math.acos(Math.max(-1, Math.min(1, -t / r)));
  if (stepDeg > 0) {
    const deg = Math.min(360 - stepDeg, Math.max(stepDeg, Math.round((th * 180 / Math.PI) / stepDeg) * stepDeg));
    return arcWithSweep(a, b, deg, p);
  }
  return orient(a, b, c, r, th, { x: c.x + n.x * r, y: c.y + n.y * r });
}

/** The arc as path nodes: cubic segments of at most 90°, smooth in between, corners at both ends. */
export function arcNodes(arc: Arc): PathNode[] {
  const k = Math.max(1, Math.ceil(Math.abs(arc.sweep) / (Math.PI / 2) - 1e-9));
  const phi = arc.sweep / k;
  const h = (4 / 3) * Math.tan(phi / 4) * arc.r;                   // handle length (signed with the sweep)
  const at = (ang: number) => ({ x: arc.c.x + arc.r * Math.cos(ang), y: arc.c.y + arc.r * Math.sin(ang) });
  const tangent = (ang: number) => ({ x: -Math.sin(ang), y: Math.cos(ang) });
  const nodes: PathNode[] = [];
  for (let i = 0; i <= k; i++) {
    const ang = arc.start + phi * i, p = at(ang), tg = tangent(ang);
    nodes.push({
      x: p.x, y: p.y,
      hin: i > 0 ? { x: p.x - tg.x * h, y: p.y - tg.y * h } : null,
      hout: i < k ? { x: p.x + tg.x * h, y: p.y + tg.y * h } : null,
      smooth: i > 0 && i < k,
    });
  }
  return nodes;
}
