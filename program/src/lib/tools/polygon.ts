/**
 * @file Polygon / polyline tool: click to add vertices; click the first vertex, double-click or press Enter to finish;
 * Esc keeps an open polyline; Backspace removes the last vertex.
 */
import type { Point } from '../utils/types';
import { editor } from '../stores/editor';
import { ui } from '../stores/ui';
import { guides, tempShape } from '../stores/interaction';
import { makePath } from '../utils/shapes';
import { corner } from '../utils/path';
import { dist } from '../utils/math';
import type { Tool, ToolContext } from './types';
import { currentStyle } from './common';

export function createPolygonTool(ctx: ToolContext): Tool {
  let pts: Point[] = [];
  let cursor: Point | null = null;

  const nearStart = (p: Point) => pts.length >= 3 && dist(p, pts[0]) < 10 / ctx.zoom();

  function refresh() {
    tempShape.set(null);
    const g: any[] = [];
    for (let k = 1; k < pts.length; k++) g.push({ kind: 'line', x1: pts[k - 1].x, y1: pts[k - 1].y, x2: pts[k].x, y2: pts[k].y });
    const closing = !!cursor && ui.get().polygonClosed && nearStart(cursor);
    if (pts.length && cursor) {
      const last = pts[pts.length - 1];
      g.push({ kind: 'line', x1: last.x, y1: last.y, x2: cursor.x, y2: cursor.y, dash: true, color: closing ? '#27ae60' : undefined });
    }
    if (closing) g.push({ kind: 'ring', x: pts[0].x, y: pts[0].y, r: 8, color: '#27ae60' });
    pts.forEach(p => g.push({ kind: 'dot', x: p.x, y: p.y }));
    guides.set(g);
  }

  function reset() { pts = []; cursor = null; guides.set([]); tempShape.set(null); }

  function finish(closed: boolean) {
    const nodes = pts.map(p => corner(p.x, p.y));
    const ok = nodes.length >= (closed ? 3 : 2);
    const shape = ok ? makePath(nodes, closed, currentStyle()) : null;
    reset();
    if (shape) editor.addShape(shape, closed ? 'Add polygon' : 'Add polyline');
  }

  return {
    down(i) {
      if (ui.get().polygonClosed && nearStart(i.p)) { finish(true); return; }
      if (pts.length && dist(i.p, pts[pts.length - 1]) < 0.5 / ctx.zoom()) return;   // 2nd click of a double-click
      pts.push(i.p); cursor = i.p; refresh();
    },
    move(i) { if (pts.length) { cursor = i.p; refresh(); } },
    up() {},
    dblclick() { if (pts.length) finish(ui.get().polygonClosed && pts.length >= 3); },
    key(e) {
      if (!pts.length) return false;
      if (e.key === 'Enter') { finish(ui.get().polygonClosed && pts.length >= 3); return true; }
      if (e.key === 'Backspace') { pts.pop(); if (pts.length) refresh(); else reset(); return true; }
      return false;
    },
    escape() { if (!pts.length) return false; finish(false); return true; },
    deactivate() { if (pts.length) finish(false); },
    busy: () => pts.length > 0,
  };
}
