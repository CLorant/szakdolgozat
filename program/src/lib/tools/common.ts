/**
 * @file Helpers shared by the drawing tools (the style of new shapes, grid snapping).
 */
import type { Style, BoundingBox, Point } from '../utils/types';
import { ui } from '../stores/ui';
import { dashFor } from '../utils/dash';

export const currentStyle = (): Style => {
  const u = ui.get();
  return {
    fill: u.fill, stroke: u.stroke, strokeWidth: u.strokeWidth,
    strokeLinecap: u.strokeLinecap, strokeLinejoin: u.strokeLinejoin,
    strokeDasharray: dashFor(u.dashKind, u.strokeWidth, u.strokeLinecap),
  };
};

export const snapPoint = (p: Point): Point => {
  const u = ui.get();
  return u.snapEnabled
    ? { x: Math.round(p.x / u.gridSizeX) * u.gridSizeX, y: Math.round(p.y / u.gridSizeY) * u.gridSizeY }
    : p;
};

/** Box dragged from `a` to `b`. Shift = square, Alt = `a` is the centre. */
export function dragBox(a: Point, b: Point, shift: boolean, alt: boolean): BoundingBox {
  let dx = b.x - a.x, dy = b.y - a.y;
  if (shift) { const s = Math.max(Math.abs(dx), Math.abs(dy)); dx = dx < 0 ? -s : s; dy = dy < 0 ? -s : s; }
  if (alt) return { x: a.x - Math.abs(dx), y: a.y - Math.abs(dy), width: 2 * Math.abs(dx), height: 2 * Math.abs(dy) };
  return { x: Math.min(a.x, a.x + dx), y: Math.min(a.y, a.y + dy), width: Math.abs(dx), height: Math.abs(dy) };
}

export const ACCENT = '#4A90D9';
