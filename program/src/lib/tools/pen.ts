/**
 * @file Bézier pen: click = corner node, click-drag = smooth node with symmetric handles. Click the first node to close
 * (two nodes are enough when a segment is curved); double-click, Enter or Esc finish an open path. Clicking the end of
 * an open path continues it; pressing A switches to the Arc tool without ending the path (tools/pathDraft.ts).
 */
import type { Point } from '../utils/types';
import { ui } from '../stores/ui';
import { guides, tempShape } from '../stores/interaction';
import { corner, smoothNode } from '../utils/path';
import { dist } from '../utils/math';
import type { Tool, ToolContext } from './types';
import { pathDraft, DRAFT_TOOLS, continueAt, openEndAt } from './pathDraft';

export function createPenTool(ctx: ToolContext): Tool {
  let anchor: Point = { x: 0, y: 0 };
  let dragging = false;
  let cursor: Point | null = null;

  const reach = () => 10 / ctx.zoom();
  const nearStart = (p: Point) => pathDraft.canClose() && dist(p, pathDraft.nodes[0]) < reach();

  function refresh() {
    const nodes = pathDraft.nodes;
    const g: any[] = [];
    if (!nodes.length) {                                            // idle: show which open ends can be continued
      tempShape.set(null);
      const end = cursor && openEndAt(cursor, reach());
      if (end) g.push({ kind: 'ring', x: end.point.x, y: end.point.y, r: 8, color: '#9b59b6' });
      guides.set(g);
      return;
    }
    const closing = !!cursor && !dragging && nearStart(cursor);
    // Near the first node the preview shows the CLOSED path, i.e. exactly what a click will create.
    tempShape.set(pathDraft.shape(closing, cursor && !dragging && !closing ? [corner(cursor.x, cursor.y)] : []));
    if (dragging) {
      const n = nodes[nodes.length - 1];
      for (const h of [n.hin, n.hout]) {
        if (!h) continue;
        g.push({ kind: 'line', x1: n.x, y1: n.y, x2: h.x, y2: h.y, color: '#9b59b6' });
        g.push({ kind: 'dot', x: h.x, y: h.y, r: 3.5, color: '#9b59b6' });
      }
    }
    if (closing) g.push({ kind: 'ring', x: nodes[0].x, y: nodes[0].y, r: 8, color: '#27ae60' });
    nodes.forEach(n => g.push({ kind: 'dot', x: n.x, y: n.y, r: 4, color: '#9b59b6' }));
    guides.set(g);
  }

  const clear = () => { dragging = false; guides.set([]); tempShape.set(null); };
  const finish = (closed: boolean) => { clear(); pathDraft.finish(closed); };

  return {
    down(i) {
      if (nearStart(i.p)) { finish(true); return; }
      if (!pathDraft.active && continueAt(i.p, reach())) { cursor = i.p; refresh(); return; }   // an open end: carry on from it
      const first = !pathDraft.active;
      if (first) pathDraft.start(corner(i.p.x, i.p.y)); else pathDraft.push(corner(i.p.x, i.p.y));
      // Only nodes after the first can be dragged into smooth nodes: a dragged first node would get a
      // hidden incoming handle that only shows up when the path is closed (preview ≠ result).
      anchor = i.p; dragging = !first; cursor = i.p; refresh();
    },
    move(i) {
      cursor = i.p;
      if (dragging && pathDraft.active) {
        pathDraft.setLast(dist(i.p, anchor) > 3 / ctx.zoom() ? smoothNode(anchor, i.p) : corner(anchor.x, anchor.y));
      }
      refresh();
    },
    up() { if (dragging) { dragging = false; refresh(); } },
    dblclick() {
      const n = pathDraft.nodes;
      if (n.length >= 2 && dist(n[n.length - 1], n[n.length - 2]) < 2 / ctx.zoom()) pathDraft.pop();  // 2nd click of the double-click
      finish(false);
    },
    key(e) {
      if (!pathDraft.active) return false;
      if (e.key === 'Enter') { finish(false); return true; }
      if (e.key === 'Backspace') { pathDraft.pop(); refresh(); return true; }
      return false;
    },
    escape() { if (!pathDraft.active) return false; finish(false); return true; },
    // Switching to the Arc tool hands the path over; any other tool ends it.
    deactivate() { clear(); cursor = null; if (!DRAFT_TOOLS.has(ui.get().tool)) pathDraft.finish(false); },
    busy: () => pathDraft.active,
  };
}
