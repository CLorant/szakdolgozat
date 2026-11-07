/**
 * @file The path being drawn, shared by the Pen and the Arc tool, and continuing an existing open path.
 *
 * One draft for both tools: switching between Pen (B) and Arc (A) in the middle of a path keeps drawing the same
 * path, so straight lines, curves and arcs can follow each other. A draft can also start from a selected open path
 * (or line) whose end was clicked (the Freehand tool uses the same lookup): the new segments are added to it and it keeps its id, name and style; clicking its
 * other end closes it.
 */
import type { PathNode, Point, Shape } from '../utils/types';
import { get } from 'svelte/store';
import { editor, currentLevel } from '../stores/editor';
import { ui } from '../stores/ui';
import { makePath, getRotationOrigin, toPathShape } from '../utils/shapes';
import { mapNodes } from '../utils/path';
import { rotatePoint, dist } from '../utils/math';
import { currentStyle } from './common';

interface Draft {
  nodes: PathNode[];
  /** The open path being continued (rotation baked into its nodes), or null for a new path. */
  source: Shape | null;
}

let draft: Draft | null = null;

/** Tools that draw into the shared draft: switching between them keeps the path going. */
export const DRAFT_TOOLS = new Set(['pen', 'arc']);

export const pathDraft = {
  get nodes(): PathNode[] { return draft?.nodes ?? []; },
  get active(): boolean { return !!draft && draft.nodes.length > 0; },
  get continuing(): boolean { return !!draft?.source; },

  start(first: PathNode) { draft = { nodes: [first], source: null }; },
  /** Starts from an existing open path; `nodes` are oriented so that the clicked end is the last node. */
  continueFrom(source: Shape, nodes: PathNode[]) { draft = { nodes, source }; },
  push(...n: PathNode[]) { draft?.nodes.push(...n); },
  pop() { draft?.nodes.pop(); if (draft && !draft.nodes.length) draft = null; },
  setLast(n: PathNode) { if (draft?.nodes.length) draft.nodes[draft.nodes.length - 1] = n; },

  /** Can the draft be closed? Three nodes, or two with a curved segment (a lens). */
  canClose(): boolean {
    const n = this.nodes;
    return n.length >= 3 || (n.length === 2 && n.some(x => x.hin || x.hout));
  },

  /** The shape the draft would become, with `extra` nodes after it (previews use it too). */
  shape(closed: boolean, extra: PathNode[] = []): Shape | null {
    return draft ? this.shapeOf([...draft.nodes, ...extra], closed) : null;
  },
  /** A shape from any node list, with the draft's style (a new path's, or the continued path's own). */
  shapeOf(nodes: PathNode[], closed: boolean): Shape | null {
    if (!draft || nodes.length < 2) return null;
    if (draft.source) {
      const fill = closed ? (draft.source.fill !== 'none' ? draft.source.fill : currentStyle().fill) : draft.source.fill;
      return { ...draft.source, type: 'path', nodes, closed, fill } as Shape;
    }
    return makePath(nodes, closed, currentStyle());
  },
  /** Replaces all nodes (the continued path, if any, stays the target). */
  setNodes(nodes: PathNode[]) { if (draft) draft.nodes = nodes; },
  /** Back to the first `n` nodes (the Arc tool's Backspace removes a whole arc). */
  truncate(n: number) { if (draft) { draft.nodes.length = Math.max(0, n); if (!n) draft = null; } },

  /** Ends the draft: a new path is added, a continued one replaced (one undo step either way). */
  finish(closed: boolean) {
    if (!draft) return;
    const ok = closed ? this.canClose() : draft.nodes.length >= 2;
    const shape = ok ? this.shape(closed) : null;
    const continued = !!draft.source;
    draft = null;
    if (!shape) return;
    if (continued) editor.replaceShape(shape, closed ? 'Close path' : 'Continue path');
    else editor.addShape(shape, closed ? 'Add closed path' : 'Add path');
  },
  cancel() { draft = null; },
};

// ── continuing an open path ──────────────────────────────────────────────────

/**
 * An end of a SELECTED open path (or line) near `p`: the shape, and which end. Only selected ones, as in Inkscape:
 * a new path started on the end of some other path stays a separate path (drawing from a snapped endpoint is common).
 */
export function openEndAt(p: Point, reach: number): { shape: Shape; atStart: boolean; point: Point } | null {
  const sel = new Set(ui.get().selectedIds);
  for (const s of [...get(currentLevel)].reverse()) {              // topmost first
    if (!sel.has(s.id) || !s.visible || s.locked) continue;
    const path = s.type === 'line' ? toPathShape(s) : s.type === 'path' && !s.closed && !s.nodes.some(n => n.sub) ? s : null;
    if (!path || path.type !== 'path' || path.nodes.length < 2) continue;
    const o = getRotationOrigin(path);
    const first = rotatePoint(path.nodes[0], o, path.rotation);
    const last = rotatePoint(path.nodes[path.nodes.length - 1], o, path.rotation);
    if (dist(p, last) < reach) return { shape: s, atStart: false, point: last };
    if (dist(p, first) < reach) return { shape: s, atStart: true, point: first };
  }
  return null;
}

/** The path's nodes in the drawing frame (rotation baked in), the given end last. */
export function nodesForContinuing(s: Shape, atStart: boolean): { source: Shape; nodes: PathNode[] } | null {
  const path = s.type === 'line' ? toPathShape(s) : s;
  if (!path || path.type !== 'path') return null;
  const o = getRotationOrigin(path);
  let nodes = path.rotation ? mapNodes(path.nodes, q => rotatePoint(q, o, path.rotation)) : path.nodes.map(n => ({ ...n }));
  if (atStart) nodes = nodes.reverse().map(n => ({ ...n, hin: n.hout, hout: n.hin }));
  const source = { ...path, rotation: 0 } as Shape;
  delete (source as { origin?: unknown }).origin;
  return { source, nodes };
}

/** Starts the shared draft from the open end under `p`; true when there was one. */
export function continueAt(p: Point, reach: number): boolean {
  const hit = openEndAt(p, reach);
  if (!hit) return false;
  const c = nodesForContinuing(hit.shape, hit.atStart);
  if (!c) return false;
  editor.selectOnly(hit.shape.id);
  pathDraft.continueFrom(c.source, c.nodes);
  return true;
}
