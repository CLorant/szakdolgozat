/**
 * @file The shape tree: finding, replacing and moving shapes inside groups.
 *
 * All functions are pure and keep object identity
 * for everything that did not change, so Svelte's `{#each (shape.id)}` and the `===` based stores
 * only update what really changed.
 */

import type { Shape, GroupShape, Point } from './types';
import { uid, getRotationOrigin } from './shapes';
import { rotatePoint } from './math';

export const isGroup = (s: Shape): s is GroupShape => s.type === 'group';

/** Hard limit when loading untrusted files (deeply nested <g> must not blow the stack). */
export const MAX_GROUP_DEPTH = 32;

/** The shape with this id at any depth. */
export function findShape(list: readonly Shape[], id: string): Shape | undefined {
  for (const s of list) {
    if (s.id === id) return s;
    if (s.type === 'group') { const r = findShape(s.children, id); if (r) return r; }
  }
  return undefined;
}

/** Ids from the top level down to `id` (inclusive), or null if it does not exist. */
export function pathTo(list: readonly Shape[], id: string): string[] | null {
  for (const s of list) {
    if (s.id === id) return [s.id];
    if (s.type === 'group') { const r = pathTo(s.children, id); if (r) return [s.id, ...r]; }
  }
  return null;
}

/** Groups containing `id`, outermost first (empty for a top-level shape or unknown id). */
export function ancestorsOf(list: readonly Shape[], id: string): GroupShape[] {
  const p = pathTo(list, id);
  if (!p) return [];
  const out: GroupShape[] = [];
  let level = list;
  for (const gid of p.slice(0, -1)) {
    const g = level.find(s => s.id === gid) as GroupShape;
    out.push(g); level = g.children;
  }
  return out;
}

/**
 * The shapes at the level reached by entering `groupPath` (ids, outermost first).
 * Returns null if the path no longer exists (e.g. after undo).
 */
export function containerAt(list: readonly Shape[], groupPath: readonly string[]): readonly Shape[] | null {
  let level = list;
  for (const id of groupPath) {
    const g = level.find(s => s.id === id);
    if (!g || g.type !== 'group') return null;
    level = g.children;
  }
  return level;
}

/** The longest prefix of `groupPath` that still exists. */
export function validGroupPath(list: readonly Shape[], groupPath: readonly string[]): string[] {
  const out: string[] = [];
  let level = list;
  for (const id of groupPath) {
    const g = level.find(s => s.id === id);
    if (!g || g.type !== 'group') break;
    out.push(id); level = g.children;
  }
  return out;
}

/**
 * Applies `fn` to every shape, children before their group. Returns the SAME array/objects when
 * nothing changed.
 */
export function mapTree(list: readonly Shape[], fn: (s: Shape) => Shape): Shape[] {
  let changed = false;
  const out = list.map(s => {
    let cur = s;
    if (s.type === 'group') {
      const kids = mapTree(s.children, fn);
      if (kids !== s.children) cur = { ...s, children: kids };
    }
    const n = fn(cur);
    if (n !== s) changed = true;
    return n;
  });
  return changed ? out : (list as Shape[]);
}

/** Removes the shapes with the given ids from any depth. Same array if nothing matched. */
export function removeFromTree(list: readonly Shape[], ids: ReadonlySet<string>): Shape[] {
  let changed = false;
  const out: Shape[] = [];
  for (const s of list) {
    if (ids.has(s.id)) { changed = true; continue; }
    if (s.type === 'group') {
      const kids = removeFromTree(s.children, ids);
      if (kids !== s.children) { changed = true; out.push({ ...s, children: kids }); continue; }
    }
    out.push(s);
  }
  return changed ? out : (list as Shape[]);
}

/** `next`, or `orig` itself when both hold the same shapes in the same order. */
const sameList = (next: Shape[], orig: readonly Shape[]): Shape[] =>
  next.length === orig.length && next.every((s, i) => s === orig[i]) ? (orig as Shape[]) : next;

/** Replaces the SIBLING LIST that contains `id`: fn gets that list and returns the new one. */
export function updateSiblings(
  list: readonly Shape[], id: string, fn: (siblings: Shape[]) => Shape[],
): Shape[] {
  if (list.some(s => s.id === id)) return sameList(fn(list.slice()), list);
  let changed = false;
  const out = list.map(s => {
    if (s.type !== 'group') return s;
    const kids = updateSiblings(s.children, id, fn);
    if (kids === s.children) return s;
    changed = true;
    return { ...s, children: kids };
  });
  return changed ? out : (list as Shape[]);
}

/** Every non-group shape, in z-order (back to front). */
export function leaves(list: readonly Shape[], out: Shape[] = []): Shape[] {
  for (const s of list) { if (s.type === 'group') leaves(s.children, out); else out.push(s); }
  return out;
}

/** All shapes including groups, depth first (a group before its children). */
export function walk(list: readonly Shape[], visit: (s: Shape, depth: number) => void, depth = 0) {
  for (const s of list) { visit(s, depth); if (s.type === 'group') walk(s.children, visit, depth + 1); }
}

export function countShapes(list: readonly Shape[]): number {
  let n = 0;
  walk(list, () => { n++; });
  return n;
}

export function maxDepth(list: readonly Shape[], depth = 1): number {
  let d = list.length ? depth : depth - 1;
  for (const s of list) if (s.type === 'group') d = Math.max(d, maxDepth(s.children, depth + 1));
  return d;
}

/** Deep copy with fresh ids for the shape and every descendant. */
export function cloneWithNewIds(s: Shape): Shape {
  return s.type === 'group'
    ? { ...s, id: uid(), children: s.children.map(cloneWithNewIds) }
    : { ...s, id: uid() };
}

/** Applies `fn` to the sibling list reached by entering `groupPath` (ids, outermost first). */
export function withContainer(
  list: readonly Shape[], groupPath: readonly string[], fn: (siblings: Shape[]) => Shape[],
): Shape[] {
  if (!groupPath.length) return sameList(fn(list.slice()), list);
  const [head, ...rest] = groupPath;
  let changed = false;
  const out = list.map(s => {
    if (s.id !== head || s.type !== 'group') return s;
    const kids = withContainer(s.children, rest, fn);
    if (kids === s.children) return s;
    changed = true;
    return { ...s, children: kids };
  });
  return changed ? out : (list as Shape[]);
}

/** Drops groups that have no children left (an empty <g> has no bounds and cannot be selected). */
export function pruneEmpty(list: readonly Shape[]): Shape[] {
  let changed = false;
  const out: Shape[] = [];
  for (const s of list) {
    if (s.type === 'group') {
      const kids = pruneEmpty(s.children);
      if (!kids.length) { changed = true; continue; }
      if (kids !== s.children) { changed = true; out.push({ ...s, children: kids }); continue; }
    }
    out.push(s);
  }
  return changed ? out : (list as Shape[]);
}

// ── coordinate frames ─────────────────────────────────────────────────────────
// Children of a rotated group live in the group's UNROTATED frame. A tool that works inside an
// entered group therefore converts pointer positions into that frame (and overlays are drawn
// inside the same nested rotate() transforms).

/** Document point → the frame of the innermost group in `groups` (outermost first). */
export function toFrame(p: Point, groups: readonly GroupShape[]): Point {
  for (const g of groups) if (g.rotation) p = rotatePoint(p, getRotationOrigin(g), -g.rotation);
  return p;
}

/** Inverse of toFrame. */
export function fromFrame(p: Point, groups: readonly GroupShape[]): Point {
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (g.rotation) p = rotatePoint(p, getRotationOrigin(g), g.rotation);
  }
  return p;
}

/** The groups for an entered path of ids (stops at the first id that no longer exists). */
export function groupsOf(list: readonly Shape[], groupPath: readonly string[]): GroupShape[] {
  const out: GroupShape[] = [];
  let level = list;
  for (const id of groupPath) {
    const g = level.find(s => s.id === id);
    if (!g || g.type !== 'group') break;
    out.push(g); level = g.children;
  }
  return out;
}

/** SVG `transform` values for the nested rotations of `groups`, outermost first. */
export function frameTransforms(groups: readonly GroupShape[]): (string | undefined)[] {
  return groups.map(g => {
    if (!g.rotation) return undefined;
    const o = getRotationOrigin(g);
    return `rotate(${g.rotation} ${o.x} ${o.y})`;
  });
}

/**
 * What a click on shape `hitId` selects when the user is inside `groupPath`: the child of the
 * deepest group shared with the hit shape's ancestry. Clicking outside the entered group leaves it.
 */
export function resolveHit(
  list: readonly Shape[], groupPath: readonly string[], hitId: string,
): { id: string; groupPath: string[] } | null {
  const path = pathTo(list, hitId);
  if (!path) return null;
  let k = 0;
  while (k < groupPath.length && k < path.length - 1 && path[k] === groupPath[k]) k++;
  return { id: path[k], groupPath: groupPath.slice(0, k) };
}

/** Applies `fn` to a shape and, for groups, to every descendant leaf. Identity-preserving. */
export function mapLeaves(s: Shape, fn: (leaf: Shape) => Shape): Shape {
  if (s.type !== 'group') return fn(s);
  let changed = false;
  const kids = s.children.map(c => { const n = mapLeaves(c, fn); if (n !== c) changed = true; return n; });
  return changed ? { ...s, children: kids } : s;
}

// ── drag & drop in the Layers panel ───────────────────────────────────────────

export type DropWhere = 'above' | 'below' | 'inside';

/** Why a drop is refused: null = allowed. */
export function dropProblem(list: readonly Shape[], id: string, targetId: string, where: DropWhere): string | null {
  if (id === targetId) return 'same layer';
  const moved = findShape(list, id), target = findShape(list, targetId);
  if (!moved || !target) return 'unknown layer';
  if (moved.type === 'group' && findShape(moved.children, targetId)) return 'a group cannot go into itself';
  if (where === 'inside' && target.type !== 'group') return 'not a group';
  const from = ancestorsOf(list, id);
  const to = where === 'inside' ? [...ancestorsOf(list, targetId), target as GroupShape] : ancestorsOf(list, targetId);
  const sameParent = from.length === to.length && from.every((g, i) => g === to[i]);
  // Children live in their group's rotated frame: moving between frames would move the picture, so only unrotated groups take part.
  if (!sameParent && (from.some(g => g.rotation) || to.some(g => g.rotation))) return 'a rotated group is involved';
  return null;
}

/**
 * Moves shape `id` next to `targetId` (above / below it in the panel = later / earlier in z-order) or into the group `targetId`
 * (on top of its children). Returns the new tree, or null when the drop is not allowed or changes nothing.
 */
export function moveInTree(list: readonly Shape[], id: string, targetId: string, where: DropWhere): Shape[] | null {
  if (dropProblem(list, id, targetId, where)) return null;
  const moved = findShape(list, id)!;
  const rest = removeFromTree(list, new Set([id]));
  const put = (siblings: Shape[]): Shape[] => {
    if (where === 'inside') return siblings.map(s => s.id === targetId && s.type === 'group' ? { ...s, children: [...s.children, moved] } : s);
    const i = siblings.findIndex(s => s.id === targetId);
    if (i < 0) return siblings;
    const out = siblings.slice();
    out.splice(where === 'above' ? i + 1 : i, 0, moved);
    return out;
  };
  const next = where === 'inside'
    ? mapTree(rest, s => s.id === targetId && s.type === 'group' ? { ...s, children: [...s.children, moved] } : s)
    : updateSiblings(rest, targetId, put);
  // an unchanged order (dropped where it already was) is not a move
  return JSON.stringify(next.map(brief)) === JSON.stringify(list.map(brief)) ? null : next;
}
const brief = (s: Shape): unknown => s.type === 'group' ? [s.id, s.children.map(brief)] : s.id;
