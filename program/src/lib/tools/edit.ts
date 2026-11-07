/**
 * @file Edit Nodes tool: drag nodes and handles, double-click a path to add a node, double-click a node to switch it
 * between corner and smooth. Several anchors can be picked (Shift-click, or drag a rectangle over them from the
 * shape or the empty canvas); they then move, nudge (arrow keys) and delete (Delete) together.
 */
import type { Point, Shape } from '../utils/types';
import { editor } from '../stores/editor';
import { documentStore } from '../stores/document';
import { findShape } from '../utils/tree';
import { ui } from '../stores/ui';
import { activeNode, pickedNodes, guides } from '../stores/interaction';
import { get } from 'svelte/store';
import {
  moveEditNode, toggleNodeSmooth, insertNodeNear, deleteNodeAt, getRotationOrigin,
  isAnchorId, anchorPositions, moveAnchors, deleteNodesAt,
} from '../utils/shapes';
import { rotatePoint } from '../utils/math';
import type { Tool, ToolContext } from './types';
import { nodeAt, shapeIdAt } from './hit';

export function createEditTool(ctx: ToolContext): Tool {
  let mode: 'node' | 'nodes' | 'band' | null = null;
  let nodeId = '';
  let orig: Shape | null = null;
  let start: Point = { x: 0, y: 0 };
  let band: { onEmpty: boolean; prev: string[]; moved: boolean } | null = null;

  const current = (): Shape | null => {
    const ids = ui.get().selectedIds;
    return ids.length === 1 ? findShape(documentStore.get().shapes, ids[0]) ?? null : null;
  };
  /** The picked anchors of `shape` (none when the pick belongs to another shape). */
  const picked = (shape: Shape | null): string[] => {
    const p = get(pickedNodes);
    return shape && p?.shapeId === shape.id ? p.ids : [];
  };
  const pick = (shape: Shape, ids: string[]) => pickedNodes.set(ids.length ? { shapeId: shape.id, ids } : null);
  const clearPick = () => { pickedNodes.set(null); activeNode.set(null); };
  const reset = () => { mode = null; orig = null; band = null; guides.set([]); };

  return {
    down(i) {
      const node = nodeAt(i.target);
      const shape = current();
      if (node && shape) {
        let ids = picked(shape);
        if (isAnchorId(node)) {
          if (i.shift) {                                           // Shift-click: add / remove, no drag
            ids = ids.includes(node) ? ids.filter(n => n !== node) : [...ids, node];
            pick(shape, ids);
            activeNode.set(ids.includes(node) ? node : null);
            return;
          }
          if (!ids.includes(node)) { ids = [node]; pick(shape, ids); }
        }
        orig = shape; nodeId = node; start = i.p;
        mode = isAnchorId(node) && ids.length > 1 ? 'nodes' : 'node';
        activeNode.set(node);
        editor.beginDrag();
        return;
      }
      const id = shapeIdAt(i.target);
      // A rectangle over the anchors: from the empty canvas, or from the edited shape itself.
      if (shape && (shape.type === 'path' || shape.type === 'line') && (!id || id === shape.id)) {
        band = { onEmpty: !id, prev: i.shift ? picked(shape) : [], moved: false };
        start = i.raw; mode = 'band';
        return;
      }
      clearPick();
      if (id) editor.selectDeep(id); else editor.deselectAll();
    },
    move(i) {
      if (mode === 'node' && orig) editor.previewShapes(new Map([[orig.id, moveEditNode(orig, nodeId, i.p)]]));
      else if (mode === 'nodes' && orig) {
        const d = { x: i.p.x - start.x, y: i.p.y - start.y };
        editor.previewShapes(new Map([[orig.id, moveAnchors(orig, picked(orig), d)]]));
      } else if (mode === 'band' && band) {
        const x = Math.min(start.x, i.raw.x), y = Math.min(start.y, i.raw.y);
        const w = Math.abs(i.raw.x - start.x), h = Math.abs(i.raw.y - start.y);
        if (w + h > 3 / ctx.zoom()) band.moved = true;
        if (band.moved) guides.set([{ kind: 'rect', x, y, width: w, height: h }]);
      }
    },
    up(i) {
      if (mode === 'node' || mode === 'nodes') editor.commitDrag(mode === 'nodes' ? 'Move nodes' : 'Edit node');
      else if (mode === 'band' && band) {
        const shape = current();
        if (!band.moved) {                                         // a plain click
          clearPick();
          if (band.onEmpty) editor.deselectAll();
        } else if (shape) {
          const x0 = Math.min(start.x, i.raw.x), x1 = Math.max(start.x, i.raw.x);
          const y0 = Math.min(start.y, i.raw.y), y1 = Math.max(start.y, i.raw.y);
          const hit = anchorPositions(shape).filter(a => a.p.x >= x0 && a.p.x <= x1 && a.p.y >= y0 && a.p.y <= y1).map(a => a.id);
          const ids = [...new Set([...band.prev, ...hit])];
          pick(shape, ids);
          activeNode.set(ids.length === 1 ? ids[0] : null);       // one node: show its handles
        }
      }
      reset();
    },
    dblclick(i) {
      const shape = current();
      if (!shape || shape.type !== 'path') return;
      const node = nodeAt(i.target);
      if (node && node.startsWith('a')) {
        editor.replaceShape(toggleNodeSmooth(shape, +node.slice(1)), 'Toggle smooth node');
        return;
      }
      if (shapeIdAt(i.target) === shape.id) {
        const local = rotatePoint(i.raw, getRotationOrigin(shape), -shape.rotation);
        const r = insertNodeNear(shape, local, 10 / ctx.zoom());
        if (r) { editor.replaceShape(r.shape, 'Add node'); pickedNodes.set(null); activeNode.set(`a${r.index}`); }
      }
    },
    key(e) {
      const shape = current();
      if (!shape) return false;
      const ids = picked(shape);
      const node = get(activeNode);
      const targets = ids.length ? ids : node && isAnchorId(node) ? [node] : [];
      if (!targets.length) return false;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (shape.type !== 'path') return false;
        const idx = targets.filter(t => t.startsWith('a')).map(t => +t.slice(1));
        const next = idx.length === 1 ? deleteNodeAt(shape, idx[0]) : deleteNodesAt(shape, idx);
        if (next !== shape) editor.replaceShape(next, idx.length > 1 ? 'Delete nodes' : 'Delete node');
        clearPick();
        return true;                                 // consumed: do NOT delete the whole shape
      }
      if (e.key.startsWith('Arrow')) {               // nudge the picked anchors (Shift: 10 px)
        const step = e.shiftKey ? 10 : 1;
        const d = { x: e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, y: e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0 };
        editor.replaceShape(moveAnchors(shape, targets, d), targets.length > 1 ? 'Move nodes' : 'Move node', `nudge-nodes:${shape.id}`);
        return true;
      }
      return false;
    },
    escape() {
      if (mode === 'node' || mode === 'nodes') { editor.cancelDrag(); reset(); return true; }
      if (mode === 'band') { reset(); return true; }
      if (get(activeNode) || get(pickedNodes)) { clearPick(); return true; }
      return false;
    },
    deactivate() { if (mode === 'node' || mode === 'nodes') editor.cancelDrag(); reset(); clearPick(); },
    busy: () => mode !== null,
  };
}
