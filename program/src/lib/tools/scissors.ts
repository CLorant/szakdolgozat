/**
 * @file Scissors tool.
 *   Drag            → a freehand knife: every shape it crosses is cut along it (closed shapes into closed pieces,
 *                     so the stroke runs along the cut; open paths split where they are crossed).
 *   Drag back to the start → a lasso: the area inside the loop is cut out.
 *   Shift-drag      → a straight knife.
 *   Click an outline → cut the path at that point only (open paths split, closed paths open there).
 * Everything the knife reaches is cut; when it reaches selected shapes, only those (select one of several
 * overlapping shapes to cut just that one).
 */
import { get } from 'svelte/store';
import { editor, currentLevel, selectedShapes } from '../stores/editor';
import { guides } from '../stores/interaction';
import { toPathShape, getWorldBounds, rectsIntersect } from '../utils/shapes';
import { cutPathAt, bakeRotation } from '../utils/scissors';
import { cutShape, isLasso, straightKnife } from '../utils/boolean';
import { nearestOnPath, simplifyRDP, corner } from '../utils/path';
import { dist } from '../utils/math';
import { notifyError } from '../stores/notify';
import type { PathShape, Point, Shape } from '../utils/types';
import type { Guide } from '../stores/interaction';
import type { Tool, ToolContext } from './types';
import { shapeIdAt } from './hit';

/** Knife color: a strong orange, unlike the selection blue, the snap pink and the guide turquoise. */
export const KNIFE_COLOR = '#ff6a00';

/** Shapes the knife can cut. */
const cuttable = (s: Shape) => s.visible && !s.locked && (s.type === 'path' || s.type === 'line' || s.type === 'rectangle' || s.type === 'ellipse');

export function createScissorsTool(ctx: ToolContext): Tool {
  const reach = () => 8 / ctx.zoom();
  let start: Point | null = null;
  let points: Point[] = [];
  let dragging = false;
  let straight = false;
  let target: Element | null = null;

  /** The cuttable shape of the current level under the pointer, as a path. */
  function targetAt(t: Element | null): { shape: Shape; path: PathShape } | null {
    const id = shapeIdAt(t);
    const shape = id ? get(currentLevel).find(s => s.id === id) : undefined;
    if (!shape || !cuttable(shape)) return null;
    const path = toPathShape(shape);
    return path ? { shape, path } : null;
  }
  function hover(p: Point, t: Element | null) {
    const hit = targetAt(t);
    const near = hit ? nearestOnPath(bakeRotation(hit.path).nodes, hit.path.closed, p) : null;
    guides.set(near && near.dist <= reach() ? [{ kind: 'dot', x: near.point.x, y: near.point.y, r: 4, color: KNIFE_COLOR, fill: KNIFE_COLOR }] : []);
  }
  function preview() {
    const pts = straight && start ? [start, points[points.length - 1]] : points;
    const lasso = !straight && isLasso(points, 12 / ctx.zoom());
    const g: Guide[] = [{ kind: 'poly', points: pts, closed: lasso, color: KNIFE_COLOR, dash: true }];
    guides.set(g);
  }
  const reset = () => { start = null; points = []; dragging = false; target = null; guides.set([]); };

  async function cutWithKnife() {
    const lasso = !straight && isLasso(points, 12 / ctx.zoom());
    const pts = straight ? [start!, points[points.length - 1]] : lasso ? [...points.slice(0, -1), points[0]] : points;
    const knife = straight ? straightKnife(pts[0], pts[1])
      : lasso ? pts.map(p => corner(p.x, p.y))                        // the loop as drawn (smoothing could open it)
      : simplifyRDP(pts, Math.max(0.4, 0.8 / ctx.zoom())).map(p => corner(p.x, p.y));   // the line as previewed
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const box = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    // Only shapes the drawn knife really reaches are cut. When it reaches selected shapes, only those: so a cut
    // through overlapping shapes can be limited to one of them by selecting it first.
    const near = get(currentLevel).filter(s => cuttable(s) && rectsIntersect(getWorldBounds(s), box));
    const chosen = new Set(get(selectedShapes).map(s => s.id));
    const cutAll = async (list: Shape[]) => {
      const out = new Map<string, Shape[]>();
      for (const s of list) {
        const pieces = await cutShape(s, knife, lasso, true);
        if (pieces?.length) out.set(s.id, pieces);
      }
      return out;
    };
    let result = await cutAll(near.filter(s => chosen.has(s.id)));
    if (!result.size) result = await cutAll(near.filter(s => !chosen.has(s.id)));
    editor.replaceManyWithPieces(result, lasso ? 'Cut out' : 'Cut');
  }

  return {
    down(i) {
      start = i.raw; points = [i.raw]; dragging = false; straight = i.shift; target = i.target;
    },
    move(i) {
      if (!start) { hover(i.raw, i.target); return; }
      if (!dragging && dist(i.raw, start) < 3 / ctx.zoom()) return;
      dragging = true;
      straight = i.shift;
      if (straight) points = [start, i.raw];
      else if (dist(i.raw, points[points.length - 1]) >= 1.5 / ctx.zoom()) points.push(i.raw);
      preview();
    },
    up(i) {
      if (!start) return;
      if (dragging) {
        if (straight) points = [start, i.raw];
        if (points.length >= 2) void cutWithKnife().catch(notifyError).finally(reset);
        else reset();
        start = null;
        return;
      }
      // A click: cut the path under the pointer at that point of its outline.
      const hit = targetAt(target);
      if (hit) {
        const pieces = cutPathAt(hit.path, i.raw, reach());
        if (pieces) editor.replaceWithPieces(hit.shape.id, pieces, 'Cut path');
      }
      reset();
    },
    escape() { if (!start) return false; reset(); return true; },
    deactivate() { reset(); },
    busy: () => start !== null,
  };
}
