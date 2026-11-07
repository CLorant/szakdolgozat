/**
 * @file "Fit around objects": the box that contains everything visible.
 */
import type { BoundingBox, Shape } from './types';
import { getWorldBounds, unionBounds } from './shapes';
import { leaves } from './tree';

/** Largest stroke width among the visible leaves of `s` (half of it sticks out of the geometry). */
const maxStroke = (s: Shape): number =>
  Math.max(0, ...leaves([s]).filter(l => l.visible && l.stroke !== 'none').map(l => l.strokeWidth));

/**
 * Bounds of all visible shapes including half of their stroke width. Null when nothing is visible.
 * (Miter joins can reach further than half the width — use padding for that.)
 */
export function contentBounds(shapes: readonly Shape[]): BoundingBox | null {
  const boxes: BoundingBox[] = [];
  for (const s of shapes) {
    if (!s.visible) continue;
    const b = getWorldBounds(s), h = maxStroke(s) / 2;
    boxes.push({ x: b.x - h, y: b.y - h, width: b.width + 2 * h, height: b.height + 2 * h });
  }
  return unionBounds(boxes);
}

/** The rectangle to export: the page, or the content grown by `padding` (page when there is no content). */
export function exportArea(
  doc: { shapes: readonly Shape[]; width: number; height: number },
  area: 'canvas' | 'content', padding: number,
): BoundingBox {
  if (area === 'content') {
    const c = contentBounds(doc.shapes);
    if (c) {
      const x = Math.floor(c.x - padding), y = Math.floor(c.y - padding);
      return { x, y, width: Math.max(1, Math.ceil(c.x + c.width + padding) - x), height: Math.max(1, Math.ceil(c.y + c.height + padding) - y) };
    }
  }
  return { x: 0, y: 0, width: doc.width, height: doc.height };
}
