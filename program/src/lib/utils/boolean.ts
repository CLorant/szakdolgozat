/**
 * @file Boolean operations on shapes (Unite, Subtract, Intersect, Exclude, Divide) and area cutting, with paper.js.
 *
 * paper.js works on Bézier curves directly, so a union of two circles is still two arcs with a handful of nodes,
 * not a polygon of hundreds of points (as polygon libraries such as Clipper or polygon-clipping would produce),
 * and the result stays editable with the Edit tool. The library (~200 KB) is loaded on first use only.
 */
import type { PathNode, PathShape, Point, Shape } from './types';
import { contours, joinContours, corner } from './path';
import { toPathShape, uid } from './shapes';
import { leaves } from './tree';
import { bakeRotation } from './scissors';
import { round } from './math';

/* eslint-disable @typescript-eslint/no-explicit-any -- paper.js objects are handled through a thin untyped layer */
type Paper = any;
type Item = any;

let lib: Promise<Paper> | null = null;
/** paper.js, set up once with a project that is never drawn. */
export function paperLib(): Promise<Paper> {
  lib ??= import('paper/dist/paper-core').then((m: any) => {
    const paper = m.default ?? m;
    paper.setup(new paper.Size(1, 1));
    return paper;
  });
  return lib;
}

// ── conversion ────────────────────────────────────────────────────────────────

/** One contour → a paper Path (handles are relative in paper, absolute here). */
function contourToPath(paper: Paper, nodes: PathNode[], closed: boolean): Item {
  const rel = (h: Point | null, n: Point) => (h ? new paper.Point(h.x - n.x, h.y - n.y) : null);
  return new paper.Path({
    segments: nodes.map(n => new paper.Segment(new paper.Point(n.x, n.y), rel(n.hin, n), rel(n.hout, n))),
    closed, insert: false,
  });
}

/** Nodes (one or more contours) → a paper Path or CompoundPath. */
export function nodesToItem(paper: Paper, nodes: PathNode[], closed: boolean, fillRule: 'nonzero' | 'evenodd' = 'nonzero'): Item {
  const parts = contours(nodes).map(c => contourToPath(paper, c, closed));
  const item = parts.length === 1 ? parts[0] : new paper.CompoundPath({ children: parts, insert: false });
  item.fillRule = fillRule;
  return item;
}

const r3 = (v: number) => round(v, 3);

/** A paper Path → one contour of nodes. */
function pathToContour(path: Item): PathNode[] {
  const out: PathNode[] = [];
  for (const seg of path.segments) {
    const p = seg.point;
    const hin = seg.handleIn.isZero() ? null : { x: r3(p.x + seg.handleIn.x), y: r3(p.y + seg.handleIn.y) };
    const hout = seg.handleOut.isZero() ? null : { x: r3(p.x + seg.handleOut.x), y: r3(p.y + seg.handleOut.y) };
    const node: PathNode = { x: r3(p.x), y: r3(p.y), hin, hout, smooth: !!(hin && hout && seg.isSmooth()) };
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - node.x) < 1e-3 && Math.abs(last.y - node.y) < 1e-3 && !last.hout && !node.hin) continue;
    out.push(node);
  }
  return out;
}

/** The contours of a paper item (Path or CompoundPath), empty ones dropped. */
function itemPaths(item: Item): Item[] {
  if (!item) return [];
  const list = item.className === 'CompoundPath' ? item.children : [item];
  return list.filter((p: Item) => p.segments.length >= 2 && Math.abs(p.area ?? 0) > 1e-4 || (p.segments.length >= 2 && !p.closed));
}

export function itemToNodes(item: Item): { nodes: PathNode[]; closed: boolean } {
  const paths = itemPaths(item);
  return { nodes: joinContours(paths.map(pathToContour)), closed: paths.every((p: Item) => p.closed) };
}

/**
 * Splits an area result into its separate pieces: every outer contour with the holes directly inside it.
 * (A cut through a ring gives two C shapes; each becomes a shape of its own.)
 */
export function splitPieces(paper: Paper, item: Item): Item[] {
  const paths = itemPaths(item).filter((p: Item) => p.closed);
  if (paths.length <= 1) return paths;
  const area = (p: Item) => Math.abs(p.area);
  const containers = paths.map((p: Item) => paths.filter((q: Item) => q !== p && area(q) > area(p) && q.contains(p.interiorPoint)));
  const depth = containers.map((c: Item[]) => c.length);
  const pieces: Item[] = [];
  paths.forEach((p: Item, i: number) => {
    if (depth[i] % 2) return;                                     // a hole: added to its outer contour below
    const holes = paths.filter((q: Item, j: number) => depth[j] === depth[i] + 1 && containers[j].includes(p));
    pieces.push(holes.length ? new paper.CompoundPath({ children: [p.clone({ insert: false }), ...holes.map((h: Item) => h.clone({ insert: false }))], insert: false }) : p);
  });
  return pieces;
}

/** A shape as a paper item in document coordinates (rotation written into the nodes). Null for text and images. */
export function shapeToItem(paper: Paper, s: Shape): Item | null {
  if (s.type === 'group') {
    const items = leaves([s]).map(l => shapeToItem(paper, l)).filter(Boolean);
    if (!items.length) return null;
    return items.reduce((a: Item, b: Item) => a.unite(b, { insert: false }));
  }
  const p = toPathShape(s);
  if (!p || !p.nodes.length) return null;
  const b = bakeRotation(p);
  return nodesToItem(paper, b.nodes, b.closed, b.fillRule ?? 'nonzero');
}

// ── boolean operations ────────────────────────────────────────────────────────

export type BooleanOp = 'unite' | 'subtract' | 'intersect' | 'exclude' | 'divide';
export const BOOLEAN_LABEL: Record<BooleanOp, string> = {
  unite: 'Unite', subtract: 'Subtract', intersect: 'Intersect', exclude: 'Exclude', divide: 'Divide',
};

/** A path shape with the style (and name) of `style`, the geometry of `item`. */
function styledPath(style: Shape, item: Item, keepId: boolean): PathShape | null {
  const { nodes } = itemToNodes(item);
  if (nodes.length < 2) return null;
  const base = toPathShape(style.type === 'group' ? leaves([style])[0] ?? style : style)
    ?? { ...style, type: 'path', nodes: [], closed: true } as unknown as PathShape;
  const shape: PathShape = {
    ...base, id: keepId ? style.id : uid(), name: style.name, rotation: 0, nodes, closed: true,
    opacity: style.opacity, visible: true,
  };
  if (item.fillRule === 'evenodd') shape.fillRule = 'evenodd'; else delete shape.fillRule;
  return shape;
}

/**
 * Combines `shapes` (in stacking order, bottom first). Unite, Intersect and Exclude take the style of the top
 * shape; Subtract cuts every other shape out of the bottom one and keeps its style; Divide cuts all of them into
 * the pieces their outlines make, each piece styled like the top shape covering it. Text must be converted to
 * paths first; images are not accepted. Returns the new shapes (empty when nothing is left).
 */
export async function booleanShapes(op: BooleanOp, shapes: readonly Shape[]): Promise<PathShape[]> {
  const paper = await paperLib();
  const ops = shapes.map(s => ({ shape: s, item: shapeToItem(paper, s) })).filter(o => o.item);
  if (ops.length < 2) return [];
  const top = ops[ops.length - 1], bottom = ops[0];
  const opt = { insert: false };
  const unite = (list: Item[]) => list.reduce((a, b) => a.unite(b, opt));

  if (op === 'divide') {
    let faces: { item: Item; style: Shape }[] = [{ item: ops[0].item, style: ops[0].shape }];
    let covered = ops[0].item;
    for (const o of ops.slice(1)) {
      const next: typeof faces = [];
      for (const f of faces) {
        next.push({ item: f.item.subtract(o.item, opt), style: f.style });
        next.push({ item: f.item.intersect(o.item, opt), style: o.shape });
      }
      next.push({ item: o.item.subtract(covered, opt), style: o.shape });
      covered = covered.unite(o.item, opt);
      faces = next;
    }
    const out: PathShape[] = [];
    for (const f of faces) for (const piece of splitPieces(paper, f.item)) {
      const s = styledPath(f.style, piece, false);
      if (s) out.push(s);
    }
    return out;
  }

  let result: Item;
  if (op === 'unite') result = unite(ops.map(o => o.item));
  else if (op === 'intersect') result = ops.slice(1).reduce((a, o) => a.intersect(o.item, opt), bottom.item);
  else if (op === 'exclude') result = ops.slice(1).reduce((a, o) => a.exclude(o.item, opt), bottom.item);
  else result = bottom.item.subtract(unite(ops.slice(1).map(o => o.item)), opt);

  const style = op === 'subtract' ? bottom.shape : top.shape;
  const s = styledPath(style, result, true);
  return s ? [s] : [];
}

// ── cutting areas (Scissors) ──────────────────────────────────────────────────

/** Is a drawn knife a closed loop (a lasso)? Its ends meet within `reach` and it encloses some area. */
export function isLasso(points: readonly Point[], reach: number): boolean {
  if (points.length < 4) return false;
  const a = points[0], b = points[points.length - 1];
  if (Math.hypot(a.x - b.x, a.y - b.y) > reach) return false;
  let area = 0;
  for (let i = 0; i < points.length; i++) { const p = points[i], q = points[(i + 1) % points.length]; area += p.x * q.y - q.x * p.y; }
  return Math.abs(area / 2) > reach * reach;
}

/**
 * The region on one side of an open knife: the knife, both ends extended far along their direction, closed around
 * one side. Cutting a shape with it (intersect + subtract) gives the pieces on either side of the line.
 */
export function knifeRegion(paper: Paper, knife: Item, far: number): Item {
  const first = knife.firstSegment.point, last = knife.lastSegment.point;
  const t0 = knife.getTangentAt(0).normalize(), t1 = knife.getTangentAt(knife.length).normalize();
  const start = first.subtract(t0.multiply(far)), end = last.add(t1.multiply(far));
  const dir = end.subtract(start).normalize();
  const side = new paper.Point(-dir.y, dir.x).multiply(far * 2);
  const region = knife.clone({ insert: false });
  region.insert(0, start);
  region.add(end, end.add(side), start.add(side));
  region.closed = true;
  return region;
}

export interface CutPiece { shape: Shape; pieces: PathShape[] }

/**
 * Cuts one shape with a knife (document coordinates). Closed shapes are divided into areas: each piece is a closed
 * path, so its stroke runs along the cut too. Open paths are split where the knife crosses them. A lasso (closed
 * knife) cuts out the area inside it. Returns null when the knife misses the shape.
 * An open knife is extended along its ends; with `mustTouch` the shape is only cut when the drawn knife itself
 * crosses its outline or lies inside it (so a short stroke next to a shape does not slice it).
 */
export async function cutShape(shape: Shape, knifeNodes: PathNode[], lasso: boolean, mustTouch = false): Promise<PathShape[] | null> {
  const paper = await paperLib();
  const target = shapeToItem(paper, shape);
  if (!target) return null;
  const knife = nodesToItem(paper, knifeNodes, lasso);
  const p = toPathShape(shape.type === 'group' ? leaves([shape])[0] ?? shape : shape);
  if (!p) return null;
  const opt = { insert: false };
  if (mustTouch && !lasso && !target.getIntersections(knife).length && !(p.closed && target.contains(knife.firstSegment.point))) return null;

  if (!p.closed) {                                                   // an open path: split at the crossings
    const hits = target.getIntersections(knife);
    if (!hits.length) return null;
    const pieces: Item[] = [];
    let rest = target;
    const offsets = hits.map((h: Item) => h.offset).sort((a: number, b: number) => b - a);
    for (const off of offsets) {
      if (off < 1e-6 || off > rest.length - 1e-6) continue;
      const tail = rest.splitAt(off);
      if (tail) pieces.unshift(tail);
    }
    pieces.unshift(rest);
    if (pieces.length < 2) return null;
    return pieces.map((it, i) => ({ ...bakeRotation(p), id: i === 0 ? p.id : uid(), nodes: pathToContour(it), closed: false }))
      .filter(s => s.nodes.length >= 2);
  }

  const b = target.bounds, kb = knife.bounds;
  const far = 4 * (Math.hypot(b.width, b.height) + Math.hypot(kb.width, kb.height) + Math.abs(b.x - kb.x) + Math.abs(b.y - kb.y) + 1);
  const region = lasso ? knife : knifeRegion(paper, knife, far);
  const inside = splitPieces(paper, target.intersect(region, opt));
  const outside = splitPieces(paper, target.subtract(region, opt));
  if (!inside.length || !outside.length) return null;              // the knife does not cross the shape
  const style = p.type === 'path' ? p : p;
  return [...outside, ...inside].map((it, i) => styledPath({ ...style, id: i === 0 ? shape.id : uid(), opacity: shape.opacity }, it, true))
    .filter((s): s is PathShape => !!s);
}

/** A straight knife between two points. */
export const straightKnife = (a: Point, b: Point): PathNode[] => [corner(a.x, a.y), corner(b.x, b.y)];
