/**
 * @file The Blob tool: a painted stroke becomes a filled shape with the current style, merged with the shapes it
 * touches that look the same (same fill and stroke; Clipper union). The merged outline is smoothed into a few
 * curved nodes.
 */
import ClipperLib from 'clipper-lib';
import type { PathNode, PathShape, Point, Shape } from './types';
import { contours, joinContours, sampleSegment, simplifyRDP, corner } from './path';
import { strokeOutline } from './strokeToPath';
import { getWorldBounds, rectsIntersect, toPathShape } from './shapes';
import { bakeRotation } from './scissors';

const SCALE = 100;

type BlobStyle = Pick<Shape, 'fill' | 'stroke' | 'strokeWidth' | 'strokeDasharray'>;
const noStroke = (s: BlobStyle) => s.stroke === 'none' || !s.strokeWidth;

/** Can a shape be merged into a blob of this style? A closed shape with the same fill and the same stroke. */
export function mergeable(s: Shape, style: BlobStyle): boolean {
  if (!s.visible || s.locked || s.fill !== style.fill) return false;
  if (s.type !== 'path' && s.type !== 'rectangle' && s.type !== 'ellipse') return false;
  if (s.type === 'path' && !s.closed) return false;
  if (noStroke(s) || noStroke(style)) return noStroke(s) && noStroke(style);
  return s.stroke === style.stroke && s.strokeWidth === style.strokeWidth && (s.strokeDasharray || '') === (style.strokeDasharray || '');
}

function flattenClosed(nodes: PathNode[]): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i], b = nodes[(i + 1) % nodes.length];
    const steps = a.hout || b.hin ? 16 : 1;
    for (let k = 0; k < steps; k++) out.push(sampleSegment(a, b, k / steps));
  }
  return out;
}

/** Polygon → smooth closed contour (few nodes, Catmull-Rom handles). Sharp corners stay corners. */
function smoothContour(pts: Point[], tol: number): PathNode[] {
  const closedPts = simplifyRDP([...pts, pts[0]], tol).slice(0, -1);
  if (closedPts.length < 3) return closedPts.map(p => corner(p.x, p.y));
  const n = closedPts.length;
  return closedPts.map((p, i) => {
    const prev = closedPts[(i - 1 + n) % n], next = closedPts[(i + 1) % n];
    const v1 = { x: p.x - prev.x, y: p.y - prev.y }, v2 = { x: next.x - p.x, y: next.y - p.y };
    const cos = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) || 1);
    if (cos < 0.2) return corner(p.x, p.y);                       // a turn sharper than ~78° stays a corner
    // Tangent along prev → next; each handle a third of ITS OWN segment, so a short segment next to a long one
    // does not overshoot (plain Catmull-Rom would draw spikes at the round ends of a stroke).
    const tx = next.x - prev.x, ty = next.y - prev.y, tl = Math.hypot(tx, ty) || 1;
    const lin = Math.hypot(v1.x, v1.y) / 3, lout = Math.hypot(v2.x, v2.y) / 3;
    return { x: p.x, y: p.y, hin: { x: p.x - tx / tl * lin, y: p.y - ty / tl * lin }, hout: { x: p.x + tx / tl * lout, y: p.y + ty / tl * lout }, smooth: true };
  });
}

export interface BlobResult {
  /** The new filled path. */
  shape: PathShape;
  /** Ids of the existing shapes it absorbed (to be removed). */
  merged: string[];
}

/**
 * The shape painted by a brush of diameter `size` along `points`, merged with the `candidates` it overlaps that
 * look the same. `base` supplies the style of the result (fill, stroke, opacity).
 */
export function paintBlob(points: Point[], size: number, base: PathShape, candidates: readonly Shape[], zoom = 1): BlobResult | null {
  if (!points.length) return null;
  const pts = points.length === 1 ? [points[0], { x: points[0].x + 0.01, y: points[0].y }] : points;
  const stroke = strokeOutline(pts.map(p => corner(p.x, p.y)), false, size, 'round', 'round');
  if (!stroke.length) return null;

  const CL = ClipperLib as any;
  const toClip = (poly: Point[]) => poly.map(p => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) }));
  const c = new CL.Clipper();
  for (const poly of stroke) c.AddPath(toClip(poly), CL.PolyType.ptSubject, true);

  const sb = stroke.flat().reduce((b, p) => ({ x0: Math.min(b.x0, p.x), y0: Math.min(b.y0, p.y), x1: Math.max(b.x1, p.x), y1: Math.max(b.y1, p.y) }),
    { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
  const box = { x: sb.x0, y: sb.y0, width: sb.x1 - sb.x0, height: sb.y1 - sb.y0 };
  const merged: string[] = [];
  for (const s of candidates) {
    if (!mergeable(s, base) || !rectsIntersect(getWorldBounds(s), box)) continue;
    const p = toPathShape(s);
    if (!p) continue;
    const polys = contours(bakeRotation(p).nodes).map(cont => toClip(flattenClosed(cont)));
    // Only shapes the stroke really overlaps (bounding boxes can meet without the shapes touching).
    const test = new CL.Clipper();
    for (const poly of stroke) test.AddPath(toClip(poly), CL.PolyType.ptSubject, true);
    test.AddPaths(polys, CL.PolyType.ptClip, true);
    const common: unknown[] = [];
    test.Execute(CL.ClipType.ctIntersection, common, CL.PolyFillType.pftNonZero, CL.PolyFillType.pftNonZero);
    if (!common.length) continue;
    for (const poly of polys) c.AddPath(poly, CL.PolyType.ptSubject, true);
    merged.push(s.id);
  }

  const out: { X: number; Y: number }[][] = [];
  c.Execute(CL.ClipType.ctUnion, out, CL.PolyFillType.pftNonZero, CL.PolyFillType.pftNonZero);
  const polys = out.map(poly => poly.map(q => ({ x: q.X / SCALE, y: q.Y / SCALE }))).filter(poly => poly.length >= 3);
  if (!polys.length) return null;
  const tol = Math.max(0.3, 0.6 / zoom);
  const nodes = joinContours(polys.map(poly => smoothContour(poly, tol)));
  return { shape: { ...base, nodes, closed: true }, merged };
}
