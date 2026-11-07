/**
 * @file Zoom and view offset of the drawing area, and the pointer position for the rulers.
 */
import { writable, get } from 'svelte/store';

/** Single source of truth for the gap around the canvas inside the scroll area. */
export const CANVAS_PADDING = 120;
export const RULER_SIZE = 20;
export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 20;

export interface ViewportState { zoom: number; scrollLeft: number; scrollTop: number; }

const store = writable<ViewportState>({ zoom: 1, scrollLeft: 0, scrollTop: 0 });

export const viewport = {
  subscribe: store.subscribe,
  get: () => get(store),
  setZoom: (z: number) => store.update(s => ({ ...s, zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)) })),
  setScroll: (left: number, top: number) =>
    store.update(s => (s.scrollLeft === left && s.scrollTop === top) ? s : { ...s, scrollLeft: left, scrollTop: top }),
};

/** Pointer position in CLIENT pixels. Kept apart so only the rulers re-render on mouse-move. */
export const cursor = writable({ x: 0, y: 0 });
