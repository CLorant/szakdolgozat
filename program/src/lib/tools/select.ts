/**
 * @file Select / Transform tool: select, move, resize, rotate and rubber-band selection. One selected shape also
 * shows its rotation origin (a crosshair): drag it to turn the shape about another point, double-click it to put it
 * back in the centre.
 */
import type { Point, Shape } from '../utils/types';
import { editor, selectedShapes, currentLevel } from '../stores/editor';
import { get } from 'svelte/store';
import { documentStore } from '../stores/document';
import { ui } from '../stores/ui';
import { guides, snapGuides } from '../stores/interaction';
import { currentTargets, snapThreshold, objectSnapOn } from './snapContext';
import { snapBox, snapAxis, snapLines } from '../utils/snap';
import type { Targets } from '../utils/snap';
import { resolveHit, pathTo } from '../utils/tree';
import {
  translateShape, strokePad, resizeShape, resizeMany, rotateMany, centerOf, getWorldBounds, rectsIntersect, unionBounds,
  getPivot, originAt, withOrigin, rotateToAbout, getLocalBounds,
} from '../utils/shapes';
import { rotatePoint } from '../utils/math';
import { normDeg } from '../utils/math';
import type { Tool, ToolContext } from './types';
import { handleAt, rotateAt, pivotAt, shapeIdAt } from './hit';
import { ACCENT } from './common';

/** Offset (document px) between a handle drawn on the stroke's outer edge and the geometry edge it resizes. */
function handleGap(s: Shape, h: string): Point {
  const pad = strokePad(s);
  const sx = h.includes('e') ? 1 : h.includes('w') ? -1 : 0, sy = h.includes('s') ? 1 : h.includes('n') ? -1 : 0;
  const a = (s.rotation * Math.PI) / 180, c = Math.cos(a), si = Math.sin(a);
  const vx = sx * pad.x, vy = sy * pad.y;
  return { x: vx * c - vy * si, y: vx * si + vy * c };
}

export function createSelectTool(ctx: ToolContext): Tool {
  type Mode = 'idle' | 'move' | 'resize' | 'rotate' | 'band' | 'pivot';
  let mode: Mode = 'idle';
  let start: Point = { x: 0, y: 0 };
  let orig: Shape[] = [];
  let handle = '';
  let grab = { x: 0, y: 0 };      // handle sits on the stroke's outer edge; the geometry edge is this far inside (document px)
  let origin: Point = start;
  let startAngle = 0;
  let prevSel: string[] = [];
  let changed = false;

  const selected = () => get(selectedShapes).filter(s => s.visible);
  let targets: Targets = { x: [], y: [] };      // what the drag snaps to (everything except the shapes being dragged)
  const reset = () => { mode = 'idle'; orig = []; changed = false; guides.set([]); snapGuides.set([]); };
  const startSnap = () => { targets = objectSnapOn() ? currentTargets(new Set(orig.map(s => s.id))) : { x: [], y: [] }; };

  return {
    down(i) {
      const sel = selected();
      const h = handleAt(i.target);
      if (h && sel.length >= 1) {
        orig = sel; handle = h; mode = 'resize'; changed = false; startSnap();
        grab = sel.length === 1 ? handleGap(sel[0], h) : { x: 0, y: 0 };
        editor.beginDrag(); return;
      }
      if (pivotAt(i.target) && sel.length === 1) {
        orig = sel; mode = 'pivot'; changed = false;
        editor.beginDrag(); return;
      }
      if (rotateAt(i.target) && sel.length >= 1) {
        // one shape turns about its rotation origin, a multi-selection about the centre of its common box
        orig = sel;
        origin = sel.length === 1 ? getPivot(sel[0]) : centerOf(unionBounds(sel.map(getWorldBounds))!);
        mode = 'rotate'; changed = false;
        startAngle = Math.atan2(i.raw.y - origin.y, i.raw.x - origin.x);
        editor.beginDrag(); return;
      }
      const hitId = shapeIdAt(i.target);
      const hit = hitId ? resolveHit(documentStore.get().shapes, ui.get().groupPath, hitId) : null;
      if (hit) {
        const u = ui.get(), id = hit.id;
        if (hit.groupPath.length !== u.groupPath.length) ui.setSelectionIn([id], hit.groupPath);   // clicked outside the entered group
        else if (i.shift) { editor.toggleSelect(id); if (!ui.get().selectedIds.includes(id)) return; }
        else if (!u.selectedIds.includes(id)) editor.selectOnly(id);
        orig = selected(); start = i.raw; mode = 'move'; changed = false; startSnap();
        editor.beginDrag(); return;
      }
      prevSel = i.shift ? ui.get().selectedIds : [];
      if (!i.shift) editor.deselectAll();
      start = i.raw; mode = 'band';
    },

    move(i) {
      switch (mode) {
        case 'move': {
          let dx = i.raw.x - start.x, dy = i.raw.y - start.y;
          if (i.shift) { if (Math.abs(dx) >= Math.abs(dy)) dy = 0; else dx = 0; }
          const u = ui.get();
          const ub = unionBounds(orig.map(getWorldBounds));
          if (!ub) return;
          // other objects / the canvas / guides first (an axis locked by Shift stays put) …
          const moved = { ...ub, x: ub.x + dx, y: ub.y + dy };
          const sn = i.ctrl ? { dx: 0, dy: 0, snappedX: false, snappedY: false, guides: [] } : snapBox(moved, targets, snapThreshold(ctx.zoom()), { x: !(i.shift && dx === 0), y: !(i.shift && dy === 0) });
          dx += sn.dx; dy += sn.dy;
          snapGuides.set(sn.guides);
          if (u.snapEnabled) {                          // … then the grid: land the selection's top-left corner on it
            if (!sn.snappedX) dx = Math.round((ub.x + dx) / u.gridSizeX) * u.gridSizeX - ub.x;
            if (!sn.snappedY) dy = Math.round((ub.y + dy) / u.gridSizeY) * u.gridSizeY - ub.y;
          }
          if (!dx && !dy && !changed) return;
          changed = true;
          editor.previewShapes(new Map(orig.map(s => [s.id, translateShape(s, dx, dy)])));
          break;
        }
        case 'resize': {
          changed = true;
          // the edge being dragged snaps to other objects (not for a rotated single shape: its edges are not axis-aligned)
          let p = i.p;
          const canSnap = orig.length > 1 || !orig[0].rotation;
          if (canSnap && objectSnapOn()) {
            const th = snapThreshold(ctx.zoom());
            const px = { x: i.p.x - grab.x, y: i.p.y - grab.y };
            const sx = /[ew]/.test(handle) ? snapAxis([px.x], targets.x, th) : null;
            const sy = /[ns]/.test(handle) ? snapAxis([px.y], targets.y, th) : null;
            p = { x: i.p.x + (sx?.delta ?? 0), y: i.p.y + (sy?.delta ?? 0) };
            const ub = unionBounds(orig.map(getWorldBounds))!;
            snapGuides.set(snapLines(sx, sy, ub));
          }
          if (orig.length === 1) editor.previewShapes(new Map([[orig[0].id, resizeShape(orig[0], handle, { x: p.x - grab.x, y: p.y - grab.y }, i.shift)]]));
          else editor.previewShapes(new Map(resizeMany(orig, handle, p, i.shift).map(s => [s.id, s])));
          break;
        }
        case 'rotate': {
          const a = Math.atan2(i.raw.y - origin.y, i.raw.x - origin.x);
          const delta = (a - startAngle) * 180 / Math.PI;
          changed = true;
          if (orig.length === 1) {
            let rot = normDeg(orig[0].rotation + delta);
            rot = i.shift ? normDeg(Math.round(rot / 15) * 15) : normDeg(Math.round(rot * 10) / 10);   // 359.96 rounds to 360 → back to 0
            editor.previewShapes(new Map([[orig[0].id, rotateToAbout(orig[0], rot, origin)]]));
          } else {
            const d = i.shift ? Math.round(delta / 15) * 15 : Math.round(delta * 10) / 10;
            editor.previewShapes(new Map(rotateMany(orig, origin, d).map(s => [s.id, s])));
          }
          break;
        }
        case 'pivot': {
          // Snaps to the box's corners, edge middles and centre (8 screen px), so "turn about a corner" is exact.
          const s = orig[0], b = getLocalBounds(s), c = centerOf(b);
          let p = i.raw;
          for (const fx of [0, 0.5, 1]) for (const fy of [0, 0.5, 1]) {
            const q = rotatePoint({ x: b.x + fx * b.width, y: b.y + fy * b.height }, c, s.rotation);
            if (Math.hypot(q.x - i.raw.x, q.y - i.raw.y) < 8 / ctx.zoom()) p = q;
          }
          changed = true;
          editor.previewShapes(new Map([[s.id, withOrigin(s, originAt(s, p))]]));
          break;
        }
        case 'band':
          guides.set([{ kind: 'rect', x: Math.min(start.x, i.raw.x), y: Math.min(start.y, i.raw.y),
            width: Math.abs(i.raw.x - start.x), height: Math.abs(i.raw.y - start.y), color: ACCENT }]);
          break;
      }
    },

    up(i) {
      snapGuides.set([]);
      switch (mode) {
        case 'move':   editor.commitDrag(orig.length > 1 ? `Move ${orig.length} shapes` : 'Move'); break;
        case 'resize': editor.commitDrag(orig.length > 1 ? `Resize ${orig.length} shapes` : 'Resize'); break;
        case 'rotate': editor.commitDrag(orig.length > 1 ? `Rotate ${orig.length} shapes` : 'Rotate'); break;
        case 'pivot':  if (changed) editor.commitDrag('Move rotation origin'); else editor.cancelDrag(); break;
        case 'band': {
          const box = { x: Math.min(start.x, i.raw.x), y: Math.min(start.y, i.raw.y),
            width: Math.abs(i.raw.x - start.x), height: Math.abs(i.raw.y - start.y) };
          if (box.width >= 3 / ctx.zoom() || box.height >= 3 / ctx.zoom()) {
            const hit = get(currentLevel)
              .filter(s => s.visible && !s.locked && rectsIntersect(getWorldBounds(s), box)).map(s => s.id);
            editor.select([...new Set([...prevSel, ...hit])]);
          }
          break;
        }
      }
      reset();
    },

    dblclick(i) {
      const sel = selected();
      if (pivotAt(i.target) && sel.length === 1) {
        if (sel[0].origin) editor.replaceShape(withOrigin(sel[0], { x: 0.5, y: 0.5 }), 'Reset rotation origin');
        return;
      }
      const hitId = shapeIdAt(i.target);
      if (!hitId) return;
      const doc = documentStore.get(), u = ui.get();
      const hit = resolveHit(doc.shapes, u.groupPath, hitId);
      const path = pathTo(doc.shapes, hitId);
      if (!hit || !path || hit.groupPath.length !== u.groupPath.length) return;
      const shape = get(currentLevel).find(s => s.id === hit.id);
      if (!shape) return;
      // A group: step into it and select the child that was clicked (isolation, as in Illustrator).
      if (shape.type === 'group') { editor.enterGroup(shape.id, path[hit.groupPath.length + 1]); return; }
      if (shape.type === 'text') ctx.openText(shape, false);
      else { editor.selectOnly(shape.id); editor.selectTool('edit'); }
    },

    escape() {
      if (mode === 'idle') return false;
      if (mode !== 'band') editor.cancelDrag();
      reset();
      return true;
    },
    deactivate() { if (mode !== 'idle') { if (mode !== 'band') editor.cancelDrag(); reset(); } },
    busy: () => mode !== 'idle',
  };
}
