/**
 * @file Reads what the pointer is over. Hit-testing itself is done by the browser: the renderer and the overlays tag
 * their elements with data-* attributes, and the event target names what was hit (transforms, strokes, curves and
 * text included).
 */

const attr = (t: Element | null, name: string): string | null =>
  (t as any)?.closest?.(`[${name}]`)?.getAttribute(name) ?? null;

export const shapeIdAt = (t: Element | null) => attr(t, 'data-shape-id');
export const handleAt  = (t: Element | null) => attr(t, 'data-handle');
export const nodeAt    = (t: Element | null) => attr(t, 'data-node');
export const rotateAt  = (t: Element | null) => attr(t, 'data-rotate') !== null;
export const pivotAt   = (t: Element | null) => attr(t, 'data-pivot') !== null;
