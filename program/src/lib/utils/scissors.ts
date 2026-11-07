/**
 * @file Cutting a path at a point (the Scissors tool).
 *
 *   Open path    → two paths, both ending at the cut.
 *   Closed path  → one open path that starts and ends at the cut.
 *   Compound     → the contour that was cut becomes an open path of its own; the other contours stay together.
 *
 * A node is inserted at the cut (de Casteljau, so the shape does not change), unless the cut is on an existing node.
 */
import type { PathNode, PathShape, Point } from './types';
import { contours, joinContours, mapNodes, nearestOnPath, splitSegment } from './path';
import { getRotationOrigin, uid } from './shapes';
import { dist, rotatePoint } from './math';

/** The same path with its rotation written into the node coordinates (rotation 0). */
export function bakeRotation(s: PathShape): PathShape {
  if (!s.rotation) return s;
  const o = getRotationOrigin(s);
  return { ...s, rotation: 0, nodes: mapNodes(s.nodes, p => rotatePoint(p, o, s.rotation)) };
}

const plain = (n: PathNode): PathNode => { const { sub: _drop, ...rest } = n; return { ...rest }; };

/**
 * Cuts `s` at the point of its outline nearest to `p` (document coordinates), if that is within `maxDist`.
 * Returns the pieces (the first keeps the id) or null when there is nothing to cut (too far, or an open path's end).
 */
export function cutPathAt(shape: PathShape, p: Point, maxDist: number): PathShape[] | null {
  const s = bakeRotation(shape);
  const hit = nearestOnPath(s.nodes, s.closed, p);
  if (!hit || hit.dist > maxDist) return null;

  // On an existing node: cut there. Otherwise insert a node at the hit.
  let nodes = s.nodes;
  let index = nodes.findIndex(n => dist(n, hit.point) < Math.max(0.5, maxDist / 4));
  if (index < 0) ({ nodes, index } = splitSegment(s.nodes, s.closed, hit.seg, hit.t));

  const parts = contours(nodes);
  let k = 0, j = index;
  while (k < parts.length && j >= parts[k].length) { j -= parts[k].length; k++; }
  const c = parts[k].map(plain);

  if (s.closed) {
    const opened = [...c.slice(j), ...c.slice(0, j), { ...c[j] }];
    opened[0] = { ...opened[0], hin: null, smooth: false };
    opened[opened.length - 1] = { ...opened[opened.length - 1], hout: null, smooth: false };
    const open: PathShape = { ...s, nodes: opened, closed: false };
    delete open.fillRule;
    if (parts.length === 1) return [open];
    const rest = parts.filter((_, i) => i !== k);
    return [{ ...s, nodes: joinContours(rest) }, { ...open, id: uid() }];
  }

  if (j === 0 || j === c.length - 1) return null;                 // the end of an open path: nothing to cut
  const a = c.slice(0, j + 1), b = c.slice(j);
  a[a.length - 1] = { ...a[a.length - 1], hout: null, smooth: false };
  b[0] = { ...b[0], hin: null, smooth: false };
  return [{ ...s, nodes: a }, { ...s, id: uid(), nodes: b }];
}
