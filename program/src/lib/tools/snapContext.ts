/**
 * @file What the pointer snaps to right now (shared by the select tool and the drawing tools).
 */
import { get } from 'svelte/store';
import { documentStore } from '../stores/document';
import { ui } from '../stores/ui';
import { collectTargets, snapAxis, snapLines, SNAP_PX, type Targets } from '../utils/snap';
import type { Guide } from '../stores/interaction';
import type { Point, ToolType } from '../utils/types';
import { containerAt, groupsOf } from '../utils/tree';

/** Targets for the level the user works in: its other shapes, the canvas (only in the page's own frame) and the ruler guides. */
export function currentTargets(exclude: ReadonlySet<string> = new Set()): Targets {
  const d = documentStore.get(), u = ui.get();
  const level = containerAt(d.shapes, u.groupPath) ?? d.shapes;
  const rotated = groupsOf(d.shapes, u.groupPath).some(g => g.rotation);
  return collectTargets(level, exclude, {
    canvas: rotated ? null : { width: d.width, height: d.height },
    guides: u.guidesVisible && !rotated ? d.guides : [],
  });
}

export const snapThreshold = (zoom: number) => SNAP_PX / Math.max(zoom, 1e-6);
export const objectSnapOn = () => ui.get().snapObjects;

/** Tools whose clicks place points: they snap to other objects while drawing. */
export const SNAPPING_TOOLS: ReadonlySet<ToolType> = new Set(['line', 'rectangle', 'ellipse', 'polygon', 'pen', 'arc']);

// The same document / level is asked many times during a drawing gesture: build the targets once.
let memo: { shapes: unknown; path: string; guides: unknown; w: number; h: number; vis: boolean; t: Targets } | null = null;
function cachedTargets(): Targets {
  const d = documentStore.get(), u = ui.get(), path = u.groupPath.join('/');
  if (memo && memo.shapes === d.shapes && memo.path === path && memo.guides === d.guides && memo.w === d.width && memo.h === d.height && memo.vis === u.guidesVisible) return memo.t;
  const t = currentTargets();
  memo = { shapes: d.shapes, path, guides: d.guides, w: d.width, h: d.height, vis: u.guidesVisible, t };
  return t;
}

/** Per-axis object snapping of a drawing point: null where nothing is near (the grid may still apply there). */
export function snapDrawPoint(p: Point, zoom: number): { x: number | null; y: number | null; guides: Guide[] } {
  const t = cachedTargets(), th = snapThreshold(zoom);
  const sx = snapAxis([p.x], t.x, th), sy = snapAxis([p.y], t.y, th);
  const x = sx ? p.x + sx.delta : null, y = sy ? p.y + sy.delta : null;
  return { x, y, guides: snapLines(sx, sy, { x: x ?? p.x, y: y ?? p.y, width: 0, height: 0 }) };
}
