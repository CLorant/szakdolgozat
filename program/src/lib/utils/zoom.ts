/**
 * @file Zooming (keeping a chosen point fixed on screen), panning and fit-to-window.
 *
 * The drawing area has no scrollbars and no edges: the view is an offset (viewport.scrollLeft / scrollTop) that can
 * go anywhere. Document x = 0 is drawn at CANVAS_PADDING − scrollLeft px from the area's left edge.
 */
import { viewport, CANVAS_PADDING, MIN_ZOOM, MAX_ZOOM } from '../stores/viewport';
import { documentStore } from '../stores/document';

let area: HTMLElement | null = null;
/** App registers the drawing area element once (its size and position are needed here). */
export const registerScrollArea = (el: HTMLElement | null) => { area = el; };
export const getScrollArea = () => area;

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/**
 * New view offset after zooming z0 → z1 so the document point under `anchor` (px from the area's edge) stays
 * under it.
 */
export function anchoredScroll(scroll: number, anchor: number, z0: number, z1: number, pad = CANVAS_PADDING): number {
  return (scroll + anchor - pad) / z0 * z1 + pad - anchor;
}

/** Moves the view by (dx, dy) screen pixels (content moves the other way, like a scrollbar). */
export function panBy(dx: number, dy: number) {
  const v = viewport.get();
  viewport.setScroll(v.scrollLeft + dx, v.scrollTop + dy);
}

/** `anchor` in CLIENT pixels; default = centre of the visible area. */
export function zoomTo(next: number, anchor?: { x: number; y: number }) {
  const v = viewport.get(), z0 = v.zoom, z1 = clampZoom(next);
  if (!area || z1 === z0) { viewport.setZoom(z1); return; }
  const r = area.getBoundingClientRect();
  const ax = anchor ? anchor.x - r.left : r.width / 2;
  const ay = anchor ? anchor.y - r.top  : r.height / 2;
  viewport.setZoom(z1);
  viewport.setScroll(anchoredScroll(v.scrollLeft, ax, z0, z1), anchoredScroll(v.scrollTop, ay, z0, z1));
}

export const zoomBy = (factor: number, anchor?: { x: number; y: number }) => zoomTo(viewport.get().zoom * factor, anchor);

/** Fits the whole page into the visible area, centred (never above 800 %). */
export function zoomFit() {
  const d = documentStore.get();
  if (!area) return;
  const w = area.clientWidth, h = area.clientHeight;
  // A margin around the page that suits the screen (the old 120 px CANVAS_PADDING left a phone ~30 px of page).
  const m = Math.max(12, Math.min(40, Math.min(w, h) * 0.08));
  const z = clampZoom(Math.min(8, Math.max(MIN_ZOOM, Math.min((w - 2 * m) / d.width, (h - 2 * m) / d.height))));
  viewport.setZoom(z);
  viewport.setScroll(CANVAS_PADDING + (d.width * z - w) / 2, CANVAS_PADDING + (d.height * z - h) / 2);
}

/** Fits a box (document units) into the visible area, centred (never above 800 %): View → Zoom to selection. */
export function zoomToBox(box: { x: number; y: number; width: number; height: number }) {
  if (!area) return;
  const w = area.clientWidth, h = area.clientHeight;
  const pad = 40;
  const z = clampZoom(Math.min(8, (w - 2 * pad) / Math.max(1, box.width), (h - 2 * pad) / Math.max(1, box.height)));
  viewport.setZoom(z);
  viewport.setScroll(CANVAS_PADDING + (box.x + box.width / 2) * z - w / 2, CANVAS_PADDING + (box.y + box.height / 2) * z - h / 2);
}
