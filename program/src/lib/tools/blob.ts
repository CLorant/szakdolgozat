/**
 * @file Blob tool: paint filled shapes with the current fill and stroke. Each stroke merges with the shapes it
 * touches that have the same fill and stroke (utils/blob.ts). The brush diameter is ui.blobSize.
 */
import { get } from 'svelte/store';
import { editor, currentLevel } from '../stores/editor';
import { tempShape } from '../stores/interaction';
import { ui } from '../stores/ui';
import { makePath } from '../utils/shapes';
import { corner } from '../utils/path';
import { paintBlob } from '../utils/blob';
import { dist } from '../utils/math';
import type { Point } from '../utils/types';
import type { Tool, ToolContext } from './types';
import { currentStyle } from './common';

export function createBlobTool(ctx: ToolContext): Tool {
  let pts: Point[] | null = null;
  const brush = () => {
    const u = ui.get();
    const fill = u.fill === 'none' ? '#000000' : u.fill;
    return { fill, size: u.blobSize };
  };
  const preview = () => {
    if (!pts) return;
    const b = brush();
    const line = pts.length > 1 ? pts : [pts[0], { x: pts[0].x + 0.01, y: pts[0].y }];
    tempShape.set({ ...makePath(line.map(p => corner(p.x, p.y)), false, { fill: 'none', stroke: b.fill, strokeWidth: b.size, strokeLinecap: 'round', strokeLinejoin: 'round' }) });
  };
  const cancel = () => { pts = null; tempShape.set(null); };

  return {
    down(i) { pts = [i.raw]; preview(); },
    move(i) {
      if (!pts || dist(i.raw, pts[pts.length - 1]) < 1 / ctx.zoom()) return;
      pts.push(i.raw); preview();
    },
    up() {
      if (!pts) return;
      const b = brush();
      const base = makePath([], true, { ...currentStyle(), fill: b.fill });
      const r = paintBlob(pts, b.size, base, get(currentLevel), ctx.zoom());
      cancel();
      if (r) editor.addBlob(r.shape, r.merged);
    },
    escape() { if (!pts) return false; cancel(); return true; },
    deactivate: cancel,
    busy: () => pts !== null,
  };
}
