/**
 * @file Freehand tool: draw freely; the stroke is simplified (RDP) and smoothed into Bézier nodes. A stroke that starts
 * on an end of the selected open path continues that path; ending it on the path's other end closes it.
 */
import type { Point, Shape } from '../utils/types';
import { editor } from '../stores/editor';
import { tempShape, guides } from '../stores/interaction';
import { makePath } from '../utils/shapes';
import { corner, freehandToNodes } from '../utils/path';
import { dist } from '../utils/math';
import type { Tool, ToolContext } from './types';
import { currentStyle } from './common';
import { openEndAt, nodesForContinuing } from './pathDraft';

export function createFreehandTool(ctx: ToolContext): Tool {
  let pts: Point[] | null = null;
  let cont: ReturnType<typeof nodesForContinuing> = null;     // the selected open path being continued
  const reach = () => 10 / ctx.zoom();
  const cancel = () => { pts = null; cont = null; tempShape.set(null); guides.set([]); };
  return {
    down(i) {
      const end = openEndAt(i.raw, reach());
      cont = end ? nodesForContinuing(end.shape, end.atStart) : null;
      pts = [end ? end.point : i.raw];
      guides.set([]);
    },
    move(i) {
      if (!pts) {                                                   // hovering: show which open ends can be continued
        const end = openEndAt(i.raw, reach());
        guides.set(end ? [{ kind: 'ring', x: end.point.x, y: end.point.y, r: 8, color: '#9b59b6' }] : []);
        return;
      }
      if (dist(i.raw, pts[pts.length - 1]) < 1.5 / ctx.zoom()) return;      // thin out raw samples
      pts.push(i.raw);
      tempShape.set(makePath(pts.map(p => corner(p.x, p.y)), false, currentStyle()));
    },
    up() {
      if (!pts) return;
      const nodes = freehandToNodes(pts, Math.max(0.8, 1.5 / ctx.zoom()));
      const c = cont;
      cancel();
      if (nodes.length < 2) return;
      if (!c) { editor.addShape(makePath(nodes, false, currentStyle()), 'Add freehand'); return; }
      // Continue: the stroke's first node is the path's end (it takes over its outgoing handle).
      const merged = c.nodes.map(n => ({ ...n }));
      const end = merged[merged.length - 1];
      merged[merged.length - 1] = { ...end, hout: nodes[0].hout, smooth: false };
      const tail = nodes.slice(1);
      const closes = merged.length >= 2 && dist(tail[tail.length - 1], merged[0]) < reach();
      if (closes) { const t = tail.pop()!; merged[0] = { ...merged[0], hin: t.hin }; }
      const fill = closes ? (c.source.fill !== 'none' ? c.source.fill : currentStyle().fill) : c.source.fill;
      editor.replaceShape({ ...c.source, type: 'path', nodes: [...merged, ...tail], closed: closes, fill } as Shape,
        closes ? 'Close path' : 'Continue path');
    },
    escape() { if (!pts) return false; cancel(); return true; },
    deactivate: cancel,
    busy: () => pts !== null,
  };
}
