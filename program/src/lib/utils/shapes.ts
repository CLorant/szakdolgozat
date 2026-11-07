/**
 * @file Shape geometry: creation, bounds, moving, scaling, rotating, mirroring, edit nodes and conversion to paths.
 *
 * Every per-type geometry rule lives here (exhaustive switches), so adding a shape
 * type means editing this file + the serializer + the renderer — nothing else.
 * All functions are pure: they return NEW shapes and never mutate their input.
 */

import type {
  Shape, GroupShape, LineShape, RectShape, EllipseShape, PathShape, TextShape, ImageShape, TextProps,
  BoundingBox, Point, EditNode, PathNode, Style, BaseProps,
} from './types';
import { EPS, rotatePoint, normDeg, dist, clamp } from './math';
import { pathBounds, mapNodes, corner, KAPPA, autoHandles, nearestOnPath, splitSegment, removeNode } from './path';
import { textBounds, MAX_FONT_SIZE } from './text';

// ── Factories ─────────────────────────────────────────────────────────────────

let counter = 0;
export function uid(): string {
  return `s${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

export function newBase(style: Style): BaseProps {
  return {
    id: uid(), name: '', visible: true,
    fill: style.fill, stroke: style.stroke, strokeWidth: style.strokeWidth,
    opacity: 1, rotation: 0,
    strokeLinecap: style.strokeLinecap ?? 'round', strokeLinejoin: style.strokeLinejoin ?? 'round',
    strokeDasharray: style.strokeDasharray ?? '',
  };
}

/** A new group around `children` (kept in the given order). It has no look of its own. */
export const makeGroup = (children: Shape[], name = ''): GroupShape => ({
  id: uid(), name, visible: true, fill: 'none', stroke: 'none', strokeWidth: 0, opacity: 1, rotation: 0,
  strokeLinecap: 'round', strokeLinejoin: 'round', strokeDasharray: '',
  type: 'group', children,
});

/**
 * Dissolves a group: its rotation, opacity and visibility are baked into the children, so the
 * picture stays exactly the same.
 */
export function ungroupShape(g: GroupShape): Shape[] {
  const o = getRotationOrigin(g);
  return g.children.map(c => {
    let n = g.rotation ? rotateShapeAbout(c, o, g.rotation) : c;
    if (g.opacity !== 1) n = { ...n, opacity: Math.round(n.opacity * g.opacity * 1000) / 1000 };
    if (!g.visible && n.visible) n = { ...n, visible: false };
    return n;
  });
}

export const makeLine = (a: Point, b: Point, st: Style): LineShape =>
  ({ ...newBase(st), type: 'line', fill: 'none', x1: a.x, y1: a.y, x2: b.x, y2: b.y });

export const makeRect = (x: number, y: number, width: number, height: number, st: Style): RectShape =>
  ({ ...newBase(st), type: 'rectangle', x, y, width, height, rx: 0, ry: 0 });

export const makeEllipse = (cx: number, cy: number, rx: number, ry: number, st: Style): EllipseShape =>
  ({ ...newBase(st), type: 'ellipse', cx, cy, rx, ry });

export const makePath = (nodes: PathNode[], closed: boolean, st: Style, fillOpen = false): PathShape =>
  ({ ...newBase(st), type: 'path', nodes, closed, fill: closed || fillOpen ? st.fill : 'none' });

/** An image shape (no fill, no stroke) showing `href` in the given box. */
export const makeImage = (x: number, y: number, width: number, height: number, href: string, name = ''): ImageShape =>
  ({ ...newBase({ fill: 'none', stroke: 'none', strokeWidth: 0 }), name, type: 'image', x, y, width, height, href });

export const makeText = (x: number, y: number, content: string, tp: TextProps, st: Style): TextShape =>
  ({ ...newBase(st), ...tp, type: 'text', x, y, content, stroke: 'none', strokeWidth: 0 });

// ── Bounds / rotation ─────────────────────────────────────────────────────────

/** Bounds of the geometry in the shape's own (unrotated) frame. May have zero width/height. */
export function getLocalBounds(s: Shape): BoundingBox {
  switch (s.type) {
    case 'line': {
      const x = Math.min(s.x1, s.x2), y = Math.min(s.y1, s.y2);
      return { x, y, width: Math.abs(s.x2 - s.x1), height: Math.abs(s.y2 - s.y1) };
    }
    case 'rectangle': return { x: s.x, y: s.y, width: s.width, height: s.height };
    case 'ellipse':   return { x: s.cx - s.rx, y: s.cy - s.ry, width: s.rx * 2, height: s.ry * 2 };
    case 'path':      return pathBounds(s.nodes, s.closed);
    case 'text':      return textBounds(s);
    case 'image':     return { x: s.x, y: s.y, width: s.width, height: s.height };
    case 'group': {
      const u = unionBounds(s.children.filter(c => c.visible).map(getWorldBounds));
      return u ?? { x: 0, y: 0, width: 0, height: 0 };
    }
  }
}

/**
 * How far the painted stroke reaches beyond the geometry on each side (local frame). Groups: 0 (their children's own
 * boxes are inside the union). Straight lines depend on the cap: a butt cap only widens the box across the line.
 */
export function strokePad(s: Shape): { x: number; y: number } {
  if (s.type === 'group' || s.stroke === 'none' || !(s.strokeWidth > 0)) return { x: 0, y: 0 };
  const h = s.strokeWidth / 2;
  if (s.type !== 'line') return { x: h, y: h };
  const dx = Math.abs(s.x2 - s.x1), dy = Math.abs(s.y2 - s.y1), len = Math.hypot(dx, dy);
  if (!len || s.strokeLinecap === 'round') return { x: h, y: h };
  const ux = dx / len, uy = dy / len, along = s.strokeLinecap === 'square' ? h : 0;
  return { x: h * uy + along * ux, y: h * ux + along * uy };
}

/** Local bounds grown by the stroke: what the user SEES of the shape (the geometry box stays the pivot and the numbers). */
export function getVisualBounds(s: Shape): BoundingBox {
  const b = getLocalBounds(s), p = strokePad(s);
  return { x: b.x - p.x, y: b.y - p.y, width: b.width + 2 * p.x, height: b.height + 2 * p.y };
}

export const centerOf = (b: BoundingBox): Point => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

/** THE rotation pivot — ShapeRenderer, serializer, handles and hit-areas all use this. */
export function getRotationOrigin(s: Shape): Point {
  return centerOf(getLocalBounds(s));
}

/**
 * The SVG `transform` of a shape: its rotation and, for text, its mirroring (both about the centre of its local
 * bounds). Undefined when there is neither. `fmt` formats the numbers (the serializer rounds them).
 */
export function shapeTransform(s: Shape, fmt: (n: number) => number | string = n => n): string | undefined {
  const flip = (s.type === 'text' || s.type === 'image') && (s.flipX || s.flipY);
  if (!s.rotation && !flip) return undefined;
  const c = getRotationOrigin(s);
  const parts: string[] = [];
  if (s.rotation) parts.push(`rotate(${fmt(s.rotation)} ${fmt(c.x)} ${fmt(c.y)})`);
  if (flip) {
    const f = s as TextShape | ImageShape;
    parts.push(`translate(${fmt(c.x)} ${fmt(c.y)}) scale(${f.flipX ? -1 : 1} ${f.flipY ? -1 : 1}) translate(${fmt(-c.x)} ${fmt(-c.y)})`);
  }
  return parts.join(' ');
}

/** Axis-aligned bounds of the shape as it appears on the canvas (rotation applied). */
export function getWorldBounds(s: Shape): BoundingBox {
  const b = getLocalBounds(s);
  if (!s.rotation) return b;
  const c = centerOf(b);
  const pts = [
    { x: b.x, y: b.y }, { x: b.x + b.width, y: b.y },
    { x: b.x + b.width, y: b.y + b.height }, { x: b.x, y: b.y + b.height },
  ].map(p => rotatePoint(p, c, s.rotation));
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export function unionBounds(list: BoundingBox[]): BoundingBox | null {
  if (!list.length) return null;
  const x  = Math.min(...list.map(b => b.x));
  const y  = Math.min(...list.map(b => b.y));
  const x2 = Math.max(...list.map(b => b.x + b.width));
  const y2 = Math.max(...list.map(b => b.y + b.height));
  return { x, y, width: x2 - x, height: y2 - y };
}

export function rectsIntersect(a: BoundingBox, b: BoundingBox): boolean {
  return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
}

// ── Translate ─────────────────────────────────────────────────────────────────

export function translateShape<S extends Shape>(s: S, dx: number, dy: number): S;
export function translateShape(s: Shape, dx: number, dy: number): Shape {
  switch (s.type) {
    case 'line':      return { ...s, x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy };
    case 'rectangle': return { ...s, x: s.x + dx, y: s.y + dy };
    case 'ellipse':   return { ...s, cx: s.cx + dx, cy: s.cy + dy };
    case 'text':      return { ...s, x: s.x + dx, y: s.y + dy };
    case 'image':     return { ...s, x: s.x + dx, y: s.y + dy };
    case 'path':      return { ...s, nodes: mapNodes(s.nodes, p => ({ x: p.x + dx, y: p.y + dy })) };
    case 'group':     return { ...s, children: s.children.map(c => translateShape(c, dx, dy)) };
  }
}

// ── Rotate about a point (used for groups) ────────────────────────────────────

/**
 * Rotates `s` by `theta` degrees about the point `p`: the shape's own rotation grows by theta and
 * its centre moves around `p`. Works for groups too (a group rotates as one piece).
 */
export function rotateShapeAbout(s: Shape, p: Point, theta: number): Shape {
  if (!theta) return s;
  const c = centerOf(getLocalBounds(s));
  const q = rotatePoint(c, p, theta);
  return translateShape({ ...s, rotation: normDeg(s.rotation + theta) }, q.x - c.x, q.y - c.y);
}

// ── Rotation origin (pivot) ───────────────────────────────────────────────────

/** The rotation origin in the frame the shape is drawn in (its rotation applied). See BaseShape.origin. */
export function getPivot(s: Shape): Point {
  const b = getLocalBounds(s), o = s.origin ?? { x: 0.5, y: 0.5 };
  return rotatePoint({ x: b.x + o.x * b.width, y: b.y + o.y * b.height }, centerOf(b), s.rotation);
}

/** A point on the canvas → the origin fractions that put the pivot there (a flat axis keeps its centre). */
export function originAt(s: Shape, p: Point): { x: number; y: number } {
  const b = getLocalBounds(s);
  const l = rotatePoint(p, centerOf(b), -s.rotation);
  return { x: b.width > EPS ? (l.x - b.x) / b.width : 0.5, y: b.height > EPS ? (l.y - b.y) / b.height : 0.5 };
}

/** Sets the origin (fractions); the centre is stored as "no origin". Nothing moves on the canvas. */
export function withOrigin(s: Shape, o: { x: number; y: number }): Shape {
  const next = { ...s } as Shape;
  if (Math.abs(o.x - 0.5) < 1e-6 && Math.abs(o.y - 0.5) < 1e-6) delete next.origin;
  else next.origin = { x: o.x, y: o.y };
  return next;
}

/** Turns the shape to an absolute angle about its rotation origin (the origin stays where it is on the canvas). */
export function rotateToAbout(s: Shape, deg: number, pivot: Point = getPivot(s)): Shape {
  return rotateShapeAbout(s, pivot, normDeg(deg) - s.rotation);
}

// ── Scale into a new bounding box ─────────────────────────────────────────────

export function scaleShape(s: Shape, ob: BoundingBox, nb: BoundingBox): Shape {
  // Degenerate (zero-size) axes are translated instead of scaled.
  const mx = (x: number) => ob.width  > EPS ? nb.x + (x - ob.x) * nb.width  / ob.width  : x - ob.x + nb.x;
  const my = (y: number) => ob.height > EPS ? nb.y + (y - ob.y) * nb.height / ob.height : y - ob.y + nb.y;
  switch (s.type) {
    case 'line':
      return { ...s, x1: mx(s.x1), y1: my(s.y1), x2: mx(s.x2), y2: my(s.y2) };
    case 'rectangle':
    case 'image':
      return { ...s, x: nb.x, y: nb.y, width: nb.width, height: nb.height };
    case 'ellipse':
      return { ...s, cx: nb.x + nb.width / 2, cy: nb.y + nb.height / 2, rx: nb.width / 2, ry: nb.height / 2 };
    case 'path':
      return { ...s, nodes: mapNodes(s.nodes, p => ({ x: mx(p.x), y: my(p.y) })) };
    case 'text': {
      const k = ob.height > EPS ? nb.height / ob.height : 1;
      const scaled: TextShape = { ...s, fontSize: Math.min(MAX_FONT_SIZE, Math.max(4, Math.round(s.fontSize * k * 10) / 10)) };
      const b2 = textBounds(scaled);
      return translateShape(scaled, nb.x - b2.x, nb.y - b2.y);
    }
    case 'group': {
      // Every child keeps its own rotation: its centre is mapped and its local box scaled by the
      // same factors. Exact for translation / uniform scale; approximate for non-uniform scaling
      // of rotated children (there is no skew in this model).
      const sx = ob.width  > EPS ? nb.width  / ob.width  : 1;
      const sy = ob.height > EPS ? nb.height / ob.height : 1;
      return {
        ...s,
        children: s.children.map(c => {
          const lb = getLocalBounds(c), cc = centerOf(lb);
          const w = lb.width * sx, h = lb.height * sy;
          const cx = mx(cc.x), cy = my(cc.y);
          return scaleShape(c, lb, { x: cx - w / 2, y: cy - h / 2, width: w, height: h });
        }),
      };
    }
  }
}

/** Shift `s` so that local point `a` (old frame, centre c) and `a2` (new frame, centre c2) coincide on screen. */
function compensate(s: Shape, c: Point, a: Point, c2: Point, a2: Point): Shape {
  if (!s.rotation && Math.abs(a.x - a2.x) < EPS && Math.abs(a.y - a2.y) < EPS) return s;
  const w1 = rotatePoint(a, c, s.rotation), w2 = rotatePoint(a2, c2, s.rotation);
  const dx = w1.x - w2.x, dy = w1.y - w2.y;
  return Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9 ? s : translateShape(s, dx, dy);
}

// ── Resize by handle (rotation-aware) ─────────────────────────────────────────

const MIN_SIZE = 2;

/** The point that stays fixed while dragging `handle`. */
function anchorOf(b: BoundingBox, handle: string): Point {
  return {
    x: handle.includes('w') ? b.x + b.width  : handle.includes('e') ? b.x : b.x + b.width / 2,
    y: handle.includes('n') ? b.y + b.height : handle.includes('s') ? b.y : b.y + b.height / 2,
  };
}

/**
 * Resize `orig` by dragging `handle` (nw n ne e se s sw w) to `ptWorld`. The opposite
 * edge/corner stays put on screen even for rotated shapes. Shift ⇒ keepAspect (corners).
 */
export function resizeShape(orig: Shape, handle: string, ptWorld: Point, keepAspect = false): Shape {
  const ob = getLocalBounds(orig), c = centerOf(ob);
  const p = rotatePoint(ptWorld, c, -orig.rotation);

  let left = ob.x, right = ob.x + ob.width, top = ob.y, bottom = ob.y + ob.height;
  if (handle.includes('w')) left   = Math.min(p.x, right - MIN_SIZE);
  if (handle.includes('e')) right  = Math.max(p.x, left + MIN_SIZE);
  if (handle.includes('n')) top    = Math.min(p.y, bottom - MIN_SIZE);
  if (handle.includes('s')) bottom = Math.max(p.y, top + MIN_SIZE);

  if (keepAspect && handle.length === 2 && ob.width > EPS && ob.height > EPS) {
    const k = Math.max((right - left) / ob.width, (bottom - top) / ob.height);
    const w = ob.width * k, h = ob.height * k;
    if (handle.includes('w')) left = right - w; else right = left + w;
    if (handle.includes('n')) top = bottom - h; else bottom = top + h;
  }

  const nb: BoundingBox = { x: left, y: top, width: right - left, height: bottom - top };
  const scaled = scaleShape(orig, ob, nb);
  const nb2 = getLocalBounds(scaled);
  return compensate(scaled, c, anchorOf(ob, handle), centerOf(nb2), anchorOf(nb2, handle));
}

/**
 * Resize a whole selection by dragging a handle of its (axis-aligned) bounding box to `ptWorld`.
 * Every shape is mapped like the children of a group are (see scaleShape): exact for translation and
 * uniform scaling, approximate for non-uniform scaling of rotated shapes (the model has no skew).
 */
export function resizeMany(orig: readonly Shape[], handle: string, ptWorld: Point, keepAspect = false): Shape[] {
  const ob = unionBounds(orig.map(getWorldBounds));
  if (!ob) return [...orig];
  let left = ob.x, right = ob.x + ob.width, top = ob.y, bottom = ob.y + ob.height;
  if (handle.includes('w')) left   = Math.min(ptWorld.x, right - MIN_SIZE);
  if (handle.includes('e')) right  = Math.max(ptWorld.x, left + MIN_SIZE);
  if (handle.includes('n')) top    = Math.min(ptWorld.y, bottom - MIN_SIZE);
  if (handle.includes('s')) bottom = Math.max(ptWorld.y, top + MIN_SIZE);
  if (keepAspect && handle.length === 2 && ob.width > EPS && ob.height > EPS) {
    const k = Math.max((right - left) / ob.width, (bottom - top) / ob.height);
    const w = ob.width * k, h = ob.height * k;
    if (handle.includes('w')) left = right - w; else right = left + w;
    if (handle.includes('n')) top = bottom - h; else bottom = top + h;
  }
  const nb: BoundingBox = { x: left, y: top, width: right - left, height: bottom - top };
  const scaled = scaleShape(makeGroup([...orig]), ob, nb);
  return scaled.type === 'group' ? scaled.children : [...orig];
}

/** Rotates every shape by `theta` degrees about the common pivot `p` (each keeps its own rotation + gets theta). */
export const rotateMany = (orig: readonly Shape[], p: Point, theta: number): Shape[] =>
  orig.map(s => rotateShapeAbout(s, p, theta));

/** Sets width and/or height of the shape's own box (null = keep); the top-left stays put, rotation-aware. */
export function setShapeSize(s: Shape, width: number | null, height: number | null): Shape {
  const b = getLocalBounds(s), c = centerOf(b);
  const local = { x: b.x + (width ?? b.width), y: b.y + (height ?? b.height) };
  return resizeShape(s, 'se', rotatePoint(local, c, s.rotation));
}

// ── Mirror ────────────────────────────────────────────────────────────────────

/** Mirror about the shape's own centre. Text keeps its letters and gets a mirroring transform (flipX / flipY). */
export function mirrorShape(s: Shape, axis: 'h' | 'v'): Shape {
  if (s.type === 'text' || s.type === 'image') {
    // M·R(θ) = R(−θ)·M: the rotation changes sign, the mirror is combined with the existing one.
    const flipped: TextShape | ImageShape = axis === 'h' ? { ...s, flipX: !s.flipX } : { ...s, flipY: !s.flipY };
    if (!flipped.flipX) delete flipped.flipX;
    if (!flipped.flipY) delete flipped.flipY;
    return { ...flipped, rotation: s.rotation ? normDeg(-s.rotation) : 0 };
  }
  const c = getRotationOrigin(s);
  if (s.type === 'group') {
    // Mirror every child about the group's centre (children are in the group's own frame),
    // and negate the group's rotation (M·R(θ) = R(−θ)·M).
    const children = s.children.map(ch => {
      const m = mirrorShape(ch, axis), cc = centerOf(getLocalBounds(ch));
      return axis === 'h' ? translateShape(m, 2 * (c.x - cc.x), 0) : translateShape(m, 0, 2 * (c.y - cc.y));
    });
    return { ...s, children, rotation: s.rotation ? normDeg(-s.rotation) : 0 };
  }
  const f = (p: Point): Point => axis === 'h' ? { x: 2 * c.x - p.x, y: p.y } : { x: p.x, y: 2 * c.y - p.y };
  // M·R(θ) = R(−θ)·M, so a mirrored rotated shape needs the opposite angle.
  const rotation = s.rotation ? normDeg(-s.rotation) : 0;
  switch (s.type) {
    case 'line': {
      const a = f({ x: s.x1, y: s.y1 }), b = f({ x: s.x2, y: s.y2 });
      return { ...s, x1: a.x, y1: a.y, x2: b.x, y2: b.y, rotation };
    }
    case 'path':      return { ...s, nodes: mapNodes(s.nodes, f), rotation };
    case 'rectangle':
    case 'ellipse':   return { ...s, rotation };
  }
}

// ── Edit nodes ────────────────────────────────────────────────────────────────

const rectCorners = (s: RectShape): Point[] => [
  { x: s.x, y: s.y }, { x: s.x + s.width, y: s.y },
  { x: s.x + s.width, y: s.y + s.height }, { x: s.x, y: s.y + s.height },
];

/**
 * New corner radii for a rectangle. Each is limited to half the side. A rectangle is either sharp (both 0) or
 * rounded (both > 0): SVG draws square corners as soon as one radius is 0, so a 0 on one axis zeroes the other,
 * and rounding a sharp rectangle on one axis starts the other at the same value.
 */
export function setRectRadii(s: RectShape, patch: { rx?: number; ry?: number }): RectShape {
  const capX = s.width / 2, capY = s.height / 2;
  let rx = clamp(patch.rx ?? s.rx, 0, capX), ry = clamp(patch.ry ?? s.ry, 0, capY);
  if (patch.rx !== undefined && patch.ry === undefined && s.ry === 0) ry = clamp(rx, 0, capY);
  if (patch.ry !== undefined && patch.rx === undefined && s.rx === 0) rx = clamp(ry, 0, capX);
  if (rx === 0 || ry === 0) rx = ry = 0;
  return { ...s, rx, ry };
}

/** Overlay nodes in the LOCAL frame (draw them inside the shape's rotation group). */
export function getEditNodes(s: Shape): EditNode[] {
  switch (s.type) {
    case 'line':
      return [
        { id: 'p1', kind: 'anchor', x: s.x1, y: s.y1 },
        { id: 'p2', kind: 'anchor', x: s.x2, y: s.y2 },
      ];
    case 'rectangle': {
      // Two radius handles, one per axis: rx slides along the top edge, ry down the left edge.
      // (Resizing is the Select tool's job, so there are no corner nodes here.)
      const rx = Math.min(s.rx, s.width / 2), ry = Math.min(s.ry, s.height / 2);
      return [
        { id: 'rx', kind: 'radius', x: s.x + rx, y: s.y },
        { id: 'ry', kind: 'radius', x: s.x, y: s.y + ry },
      ];
    }
    case 'ellipse':
      return [
        { id: 'rx+', kind: 'radius', x: s.cx + s.rx, y: s.cy },
        { id: 'ry+', kind: 'radius', x: s.cx, y: s.cy + s.ry },
        { id: 'rx-', kind: 'radius', x: s.cx - s.rx, y: s.cy },
        { id: 'ry-', kind: 'radius', x: s.cx, y: s.cy - s.ry },
      ];
    case 'path': {
      const out: EditNode[] = [];
      s.nodes.forEach((n, i) => {
        out.push({ id: `a${i}`, kind: 'anchor', x: n.x, y: n.y, node: i });
        if (n.hin)  out.push({ id: `i${i}`, kind: 'hin',  x: n.hin.x,  y: n.hin.y,  node: i });
        if (n.hout) out.push({ id: `o${i}`, kind: 'hout', x: n.hout.x, y: n.hout.y, node: i });
      });
      return out;
    }
    case 'text': case 'image': case 'group': return [];
  }
}

function moveLocal(s: Shape, id: string, p: Point): Shape {
  switch (s.type) {
    case 'line': return id === 'p1' ? { ...s, x1: p.x, y1: p.y } : id === 'p2' ? { ...s, x2: p.x, y2: p.y } : s;
    case 'rectangle': {
      if (id !== 'rx' && id !== 'ry') return s;
      // Both handles start on the same corner of a sharp rectangle, so there the grabbed one rounds it uniformly
      // (whichever way you pull it); after that each handle moves its own radius.
      if (s.rx === 0 && s.ry === 0) { const r = Math.max(p.x - s.x, p.y - s.y); return setRectRadii(s, { rx: r, ry: r }); }
      return id === 'rx' ? setRectRadii(s, { rx: p.x - s.x }) : setRectRadii(s, { ry: p.y - s.y });
    }
    case 'ellipse':
      if (id.startsWith('rx')) return { ...s, rx: Math.max(1, Math.abs(p.x - s.cx)) };
      if (id.startsWith('ry')) return { ...s, ry: Math.max(1, Math.abs(p.y - s.cy)) };
      return s;
    case 'path': {
      const m = /^([aio])(\d+)$/.exec(id);
      if (!m) return s;
      const i = +m[2], n = s.nodes[i];
      if (!n) return s;
      const nodes = s.nodes.slice();
      if (m[1] === 'a') {
        const dx = p.x - n.x, dy = p.y - n.y;
        nodes[i] = {
          ...n, x: p.x, y: p.y,
          hin:  n.hin  && { x: n.hin.x + dx,  y: n.hin.y + dy },
          hout: n.hout && { x: n.hout.x + dx, y: n.hout.y + dy },
        };
      } else {
        const isIn = m[1] === 'i';
        let other = isIn ? n.hout : n.hin;
        if (n.smooth && other) {                         // keep the opposite handle collinear, same length
          const vx = p.x - n.x, vy = p.y - n.y, vl = Math.hypot(vx, vy), ol = dist(other, n);
          if (vl > EPS) other = { x: n.x - vx / vl * ol, y: n.y - vy / vl * ol };
        }
        nodes[i] = isIn ? { ...n, hin: { ...p }, hout: other } : { ...n, hout: { ...p }, hin: other };
      }
      return { ...s, nodes };
    }
    case 'text': case 'image': case 'group': return s;
  }
}

/**
 * Drag edit node `id` of `orig` to `ptWorld`. The node follows the cursor exactly,
 * even on rotated shapes (the pivot shift caused by changed bounds is compensated).
 */
export function moveEditNode(orig: Shape, id: string, ptWorld: Point): Shape {
  const c = getRotationOrigin(orig);
  const p = rotatePoint(ptWorld, c, -orig.rotation);
  const moved = moveLocal(orig, id, p);
  if (moved === orig) return orig;
  return compensate(moved, c, p, getRotationOrigin(moved), p);
}

/** Ids of the nodes that can be picked together in the Edit tool: path anchors ('a3') and line ends ('p1', 'p2'). */
export const isAnchorId = (id: string) => /^(a\d+|p[12])$/.test(id);

/** The anchors of a shape, in the frame it is drawn in (inside its rotation). Edit tool: rectangle selection. */
export function anchorPositions(s: Shape): Array<{ id: string; p: Point }> {
  const c = getRotationOrigin(s);
  return getEditNodes(s).filter(n => n.kind === 'anchor').map(n => ({ id: n.id, p: rotatePoint(n, c, s.rotation) }));
}

/**
 * Moves several anchors (with their handles) by `dWorld`, a distance on screen. Like moveEditNode, the moved
 * anchors land exactly where they were dragged even when the shape is rotated.
 */
export function moveAnchors(orig: Shape, ids: readonly string[], dWorld: Point): Shape {
  const d = rotatePoint(dWorld, { x: 0, y: 0 }, -orig.rotation);           // into the shape's own frame
  const sh = (p: Point) => ({ x: p.x + d.x, y: p.y + d.y });
  const set = new Set(ids);
  let moved: Shape = orig, ref: Point | null = null;
  if (orig.type === 'path') {
    const nodes = orig.nodes.map((n, i) => set.has(`a${i}`)
      ? { ...n, ...sh(n), hin: n.hin && sh(n.hin), hout: n.hout && sh(n.hout) } : n);
    const k = orig.nodes.findIndex((_, i) => set.has(`a${i}`));
    if (k < 0) return orig;
    moved = { ...orig, nodes }; ref = nodes[k];
  } else if (orig.type === 'line') {
    const a = set.has('p1') ? sh({ x: orig.x1, y: orig.y1 }) : { x: orig.x1, y: orig.y1 };
    const b = set.has('p2') ? sh({ x: orig.x2, y: orig.y2 }) : { x: orig.x2, y: orig.y2 };
    if (!set.has('p1') && !set.has('p2')) return orig;
    moved = { ...orig, x1: a.x, y1: a.y, x2: b.x, y2: b.y }; ref = set.has('p1') ? a : b;
  } else return orig;
  return compensate(moved, getRotationOrigin(orig), ref, getRotationOrigin(moved), ref);
}

/** Deletes several path anchors; a contour never drops below its minimum (2 nodes open, 3 closed). */
export function deleteNodesAt(s: PathShape, indices: readonly number[]): PathShape {
  let nodes = s.nodes;
  for (const i of [...new Set(indices)].sort((a, b) => b - a)) nodes = removeNode(nodes, s.closed, i);
  return nodes === s.nodes ? s : { ...s, nodes };
}

// ── Text ──────────────────────────────────────────────────────────────────────

/** Changes the text; the anchor point stays where it is on screen even when rotated. */
export function setTextContent(s: TextShape, content: string): TextShape {
  const next: TextShape = { ...s, content };
  if (!s.rotation) return next;
  const a = { x: s.x, y: s.y };
  return compensate(next, getRotationOrigin(s), a, getRotationOrigin(next), a) as TextShape;
}

// ── Path-specific edits ───────────────────────────────────────────────────────

/** Corner ⇄ smooth. Corner → smooth creates Catmull-Rom handles; smooth → corner removes them. */
export function toggleNodeSmooth(s: PathShape, idx: number): PathShape {
  const n = s.nodes[idx];
  if (!n) return s;
  const nodes = s.nodes.slice();
  if (n.smooth) {
    nodes[idx] = { ...n, smooth: false, hin: null, hout: null };
  } else {
    const len = s.nodes.length;
    const prev = idx > 0 ? s.nodes[idx - 1] : s.closed ? s.nodes[len - 1] : null;
    const next = idx < len - 1 ? s.nodes[idx + 1] : s.closed ? s.nodes[0] : null;
    const h = autoHandles(prev, n, next);
    nodes[idx] = { ...n, smooth: true, hin: h.hin, hout: h.hout };
  }
  return { ...s, nodes };
}

/** Insert a node on the path at the point nearest `local` (local frame). Returns null if too far. */
export function insertNodeNear(s: PathShape, local: Point, maxDist: number): { shape: PathShape; index: number } | null {
  const hit = nearestOnPath(s.nodes, s.closed, local);
  if (!hit || hit.dist > maxDist) return null;
  const r = splitSegment(s.nodes, s.closed, hit.seg, hit.t);
  return { shape: { ...s, nodes: r.nodes }, index: r.index };
}

export function deleteNodeAt(s: PathShape, idx: number): PathShape {
  const nodes = removeNode(s.nodes, s.closed, idx);
  return nodes === s.nodes ? s : { ...s, nodes };
}

// ── Convert to path ("Object to path") ────────────────────────────────────────

/** Rect / ellipse / line → PathShape (same id, style and rotation). Text and groups → null (see textOutline.ts / editor.convertToPath). */
export function toPathShape(s: Shape): PathShape | null {
  const k = KAPPA;
  const base = {
    id: s.id, type: 'path' as const, name: s.name, visible: s.visible, fill: s.fill, stroke: s.stroke,
    strokeWidth: s.strokeWidth, opacity: s.opacity, rotation: s.rotation,
    strokeLinecap: s.strokeLinecap, strokeLinejoin: s.strokeLinejoin, strokeDasharray: s.strokeDasharray,
  };
  switch (s.type) {
    case 'path': return s;
    case 'text': case 'image': case 'group': return null;
    case 'line': return { ...base, nodes: [corner(s.x1, s.y1), corner(s.x2, s.y2)], closed: false };
    case 'rectangle': {
      const rx = Math.min(s.rx, s.width / 2), ry = Math.min(s.ry || s.rx, s.height / 2);
      const { x, y, width: w, height: h } = s;
      if (rx <= 0 || ry <= 0) {
        return { ...base, nodes: rectCorners(s).map(p => corner(p.x, p.y)), closed: true };
      }
      const N = (ax: number, ay: number, hin: Point | null, hout: Point | null): PathNode =>
        ({ x: ax, y: ay, hin, hout, smooth: false });
      const nodes = [
        N(x + rx,     y,          { x: x + rx - k * rx,     y },                     null),
        N(x + w - rx, y,          null,                                             { x: x + w - rx + k * rx, y }),
        N(x + w,      y + ry,     { x: x + w, y: y + ry - k * ry },                  null),
        N(x + w,      y + h - ry, null,                                             { x: x + w, y: y + h - ry + k * ry }),
        N(x + w - rx, y + h,      { x: x + w - rx + k * rx, y: y + h },              null),
        N(x + rx,     y + h,      null,                                             { x: x + rx - k * rx, y: y + h }),
        N(x,          y + h - ry, { x, y: y + h - ry + k * ry },                     null),
        N(x,          y + ry,     null,                                             { x, y: y + ry - k * ry }),
      ];
      return { ...base, nodes, closed: true };
    }
    case 'ellipse': {
      const { cx, cy, rx, ry } = s;
      const N = (ax: number, ay: number, hin: Point, hout: Point): PathNode => ({ x: ax, y: ay, hin, hout, smooth: true });
      const nodes = [
        N(cx + rx, cy, { x: cx + rx, y: cy - k * ry }, { x: cx + rx, y: cy + k * ry }),
        N(cx, cy + ry, { x: cx + k * rx, y: cy + ry }, { x: cx - k * rx, y: cy + ry }),
        N(cx - rx, cy, { x: cx - rx, y: cy + k * ry }, { x: cx - rx, y: cy - k * ry }),
        N(cx, cy - ry, { x: cx - k * rx, y: cy - ry }, { x: cx + k * rx, y: cy - ry }),
      ];
      return { ...base, nodes, closed: true };
    }
  }
}
