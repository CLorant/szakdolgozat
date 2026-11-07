/**
 * @file Arc tool (circular arcs through three points): drag from one end of the arc to the other (or click both
 * ends), move the pointer to bend it and click. The path goes on from the arc's end: click the next end, bend, click,
 * and so on. Double-click, Enter or Esc finish; clicking the first point as an end closes the path. Shift rounds the
 * sweep to 15° steps. Pressing B switches to the Pen without ending the path, A comes back (tools/pathDraft.ts);
 * clicking the end of an open path continues it.
 */
import type { PathNode, Point } from '../utils/types';
import { ui } from '../stores/ui';
import { guides, tempShape } from '../stores/interaction';
import { corner } from '../utils/path';
import { dist } from '../utils/math';
import { arcThrough, arcNodes } from '../utils/arc';
import type { Tool, ToolContext } from './types';
import { pathDraft, DRAFT_TOOLS, continueAt, openEndAt } from './pathDraft';

export function createArcTool(ctx: ToolContext): Tool {
  let b: Point | null = null;          // the end of the arc being bent (its start is the draft's last node)
  let closing = false;                 // b is the draft's first node: committing closes the path
  let pressed = false;                 // the first press of a new path: a drag sets both ends
  let cursor: Point | null = null;
  let segments: number[] = [];         // draft length before each arc (Backspace removes a whole arc)

  const reach = () => 10 / ctx.zoom();
  const last = () => pathDraft.nodes[pathDraft.nodes.length - 1];

  /** The draft's nodes with the arc (or straight segment) from its last node to b through p appended. */
  function withArc(p: Point, shift: boolean): PathNode[] {
    const nodes = pathDraft.nodes.map(n => ({ ...n }));
    const a = nodes[nodes.length - 1];
    if (!b) return nodes;
    const arc = arcThrough(a, b, p, shift ? 15 : 0);
    const seg = arc ? arcNodes(arc) : [corner(a.x, a.y), corner(b.x, b.y)];
    nodes[nodes.length - 1] = { ...a, hout: seg[0].hout };
    const rest = seg.slice(1);
    if (closing) { const end = rest.pop()!; nodes[0] = { ...nodes[0], hin: end.hin }; }
    return [...nodes, ...rest];
  }

  function refresh(shift = false) {
    const g: any[] = [];
    if (!pathDraft.active) {                                        // idle: show which open ends can be continued
      tempShape.set(null);
      const end = cursor && openEndAt(cursor, reach());
      if (end) g.push({ kind: 'ring', x: end.point.x, y: end.point.y, r: 8, color: '#9b59b6' });
      guides.set(g);
      return;
    }
    const a = last();
    if (b && cursor) tempShape.set(pathDraft.shapeOf(withArc(cursor, shift), closing));
    else tempShape.set(pathDraft.shape(false));
    if (!b && cursor) {
      const toStart = pathDraft.canClose() && dist(cursor, pathDraft.nodes[0]) < reach();
      g.push({ kind: 'line', x1: a.x, y1: a.y, x2: cursor.x, y2: cursor.y, dash: true });
      if (toStart) g.push({ kind: 'ring', x: pathDraft.nodes[0].x, y: pathDraft.nodes[0].y, r: 8, color: '#27ae60' });
    }
    if (b) g.push({ kind: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y, dash: true }, { kind: 'dot', x: b.x, y: b.y });
    pathDraft.nodes.forEach(n => g.push({ kind: 'dot', x: n.x, y: n.y, r: 4, color: '#9b59b6' }));
    guides.set(g);
  }

  const clear = () => { b = null; closing = false; pressed = false; segments = []; tempShape.set(null); guides.set([]); };
  const finish = (closed: boolean) => { clear(); pathDraft.finish(closed); };

  /** Sets the end of the next arc (the first node of the path closes it). */
  function setEnd(p: Point, shift: boolean) {
    if (dist(p, last()) < 1 / ctx.zoom()) return;                    // the 2nd click of a double-click
    closing = pathDraft.canClose() && dist(p, pathDraft.nodes[0]) < reach();
    b = closing ? { x: pathDraft.nodes[0].x, y: pathDraft.nodes[0].y } : p;
    refresh(shift);
  }

  return {
    down(i) {
      if (pathDraft.active && b) {                                  // the bend click: the arc joins the path
        segments.push(pathDraft.nodes.length);
        const nodes = withArc(i.p, i.shift);
        const close = closing;
        pathDraft.setNodes(nodes);
        b = null; closing = false;
        if (close) finish(true); else refresh(i.shift);
        return;
      }
      if (pathDraft.active) { setEnd(i.p, i.shift); return; }
      if (continueAt(i.p, reach())) { cursor = i.p; segments = []; refresh(); return; }   // an open end: carry on from it
      pathDraft.start(corner(i.p.x, i.p.y)); segments = []; pressed = true; cursor = i.p; refresh();
    },
    move(i) { cursor = i.p; refresh(i.shift); },
    up(i) {
      if (!pressed) return;
      pressed = false;
      // A drag sets both ends at once; a plain click leaves the start waiting for the second click.
      if (!b && dist(i.p, last()) > 4 / ctx.zoom()) setEnd(i.p, i.shift);
    },
    dblclick() { if (pathDraft.active) finish(false); },
    key(e) {
      if (!pathDraft.active) return false;
      if (e.key === 'Enter') { finish(false); return true; }
      if (e.key === 'Backspace') {
        if (b) { b = null; closing = false; }
        else if (segments.length) pathDraft.truncate(segments.pop()!);
        else pathDraft.pop();
        refresh(); return true;
      }
      return false;
    },
    escape() { if (!pathDraft.active) return false; finish(false); return true; },
    // Switching to the Pen hands the path over (an arc still being bent is dropped); any other tool ends it.
    deactivate() {
      const keep = DRAFT_TOOLS.has(ui.get().tool);
      b = null; closing = false; pressed = false; segments = []; cursor = null; tempShape.set(null); guides.set([]);
      if (!keep) pathDraft.finish(false);
    },
    busy: () => pathDraft.active,
  };
}
