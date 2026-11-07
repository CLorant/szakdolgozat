/**
 * @file Line, rectangle and ellipse tools: drag to draw.
 */
import type { Point, Shape } from '../utils/types';
import { editor } from '../stores/editor';
import { tempShape } from '../stores/interaction';
import { makeLine, makeRect, makeEllipse } from '../utils/shapes';
import type { Tool, PointerInfo } from './types';
import { currentStyle, dragBox } from './common';

type Kind = 'line' | 'rectangle' | 'ellipse';

function build(kind: Kind, a: Point, i: PointerInfo): Shape | null {
  const st = currentStyle();
  if (kind === 'line') {
    let { x, y } = i.p;
    if (i.shift) {                                    // snap to 45° steps
      const d = Math.hypot(x - a.x, y - a.y);
      const ang = Math.round(Math.atan2(y - a.y, x - a.x) / (Math.PI / 4)) * (Math.PI / 4);
      x = a.x + d * Math.cos(ang); y = a.y + d * Math.sin(ang);
    }
    return makeLine(a, { x, y }, st);
  }
  const b = dragBox(a, i.p, i.shift, i.alt);
  if (kind === 'rectangle') return makeRect(b.x, b.y, Math.max(b.width, 1), Math.max(b.height, 1), st);
  return makeEllipse(b.x + b.width / 2, b.y + b.height / 2, Math.max(b.width / 2, 0.5), Math.max(b.height / 2, 0.5), st);
}

const tooSmall = (s: Shape) => {
  if (s.type === 'line') return Math.hypot(s.x2 - s.x1, s.y2 - s.y1) < 2;
  if (s.type === 'rectangle') return s.width < 2 && s.height < 2;
  if (s.type === 'ellipse') return s.rx < 1 && s.ry < 1;
  return false;
};

export function createShapeTool(kind: Kind): Tool {
  let start: Point | null = null;
  const cancel = () => { start = null; tempShape.set(null); };
  return {
    down(i) { start = i.p; },
    move(i) { if (start) tempShape.set(build(kind, start, i)); },
    up(i) {
      if (!start) return;
      const s = build(kind, start, i);
      cancel();
      if (s && !tooSmall(s)) editor.addShape(s, `Add ${kind}`);
    },
    escape() { if (!start) return false; cancel(); return true; },
    deactivate: cancel,
    busy: () => start !== null,
  };
}
