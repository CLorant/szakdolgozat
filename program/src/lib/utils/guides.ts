/**
 * @file Dragging ruler guides: out of a ruler (a new guide) or an existing one (moved; dropped on a ruler or outside the
 * drawing area = removed). A preview line follows the pointer; one history entry on release.
 */
import { get } from 'svelte/store';
import { documentStore } from '../stores/document';
import { guidePreview } from '../stores/interaction';
import { editor } from '../stores/editor';
import { getScrollArea } from './zoom';

/** Client pixels → document units (the page's own frame), using the rendered canvas. */
export function clientToDoc(clientX: number, clientY: number): { x: number; y: number } | null {
  const svg = document.querySelector('svg.svge-canvas');
  if (!svg) return null;
  const r = svg.getBoundingClientRect(), d = documentStore.get();
  if (!r.width || !r.height) return null;
  return { x: (clientX - r.left) * d.width / r.width, y: (clientY - r.top) * d.height / r.height };
}

export function startGuideDrag(e: PointerEvent, axis: 'x' | 'y', index?: number) {
  if (e.button !== 0) return;
  e.preventDefault(); e.stopPropagation();
  const posOf = (ev: PointerEvent) => { const p = clientToDoc(ev.clientX, ev.clientY); return p ? (axis === 'x' ? p.x : p.y) : null; };
  const insideArea = (ev: PointerEvent) => {
    const a = getScrollArea();
    if (!a) return true;
    const r = a.getBoundingClientRect();
    return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
  };
  const show = (ev: PointerEvent) => {
    const pos = posOf(ev);
    guidePreview.set(pos === null || !insideArea(ev) ? (index === undefined ? null : { axis, pos: pos ?? 0, index }) : { axis, pos, index });
  };
  show(e);
  const move = (ev: PointerEvent) => show(ev);
  const end = (ev: PointerEvent) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    const pos = posOf(ev), ok = ev.type === 'pointerup' && pos !== null;
    guidePreview.set(null);
    if (!ok) return;
    if (index === undefined) { if (insideArea(ev)) editor.addGuide(axis, pos!); }
    else if (insideArea(ev)) editor.moveGuide(index, pos!);
    else editor.removeGuide(index);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
}
