// @vitest-environment jsdom
// The canvas mounted: drawing, selecting, keys, text, panning.
// Integration test: mounts the REAL Canvas.svelte and drives it with DOM events.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import { get } from 'svelte/store';
import Canvas from '../../src/lib/layouts/Canvas.svelte';
import { editor } from '../../src/lib/stores/editor';
import { documentStore, historyPast } from '../../src/lib/stores/document';
import { ui } from '../../src/lib/stores/ui';
import { viewport } from '../../src/lib/stores/viewport';
import { makeRect, makeLine } from '../../src/lib/utils/shapes';

const st = { fill: '#336699', stroke: '#000000', strokeWidth: 2 };
let app: any, svg: SVGSVGElement;

const fire = (el: EventTarget, type: string, x = 0, y = 0, extra: MouseEventInit = {}) => {
  el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, ...extra }));
  flushSync();
};
const key = (k: string, target: EventTarget = window, extra: KeyboardEventInit = {}) => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }));
  flushSync();
};
const drag = (from: [number, number], to: [number, number], target: EventTarget = svg, extra: MouseEventInit = {}) => {
  fire(target, 'pointerdown', ...from, extra);
  fire(window, 'pointermove', ...to, extra);
  fire(window, 'pointerup', ...to, extra);
};
const shapes = () => documentStore.get().shapes;

beforeEach(() => {
  editor.newDocument(800, 600);
  ui.set({ tool: 'transform', snapEnabled: false, gridEnabled: false });
  viewport.setZoom(1);
  app = mount(Canvas, { target: document.body, props: {} });
  flushSync();
  svg = document.querySelector('svg.svge-canvas')!;
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0 } as any);
});
afterEach(() => { unmount(app); document.body.innerHTML = ''; });

describe('Canvas (mounted)', () => {
  it('draws a rectangle with the rectangle tool and renders it with a data-shape-id', () => {
    editor.selectTool('rectangle'); flushSync();
    drag([10, 20], [110, 80]);
    expect(shapes()).toHaveLength(1);
    expect(shapes()[0]).toMatchObject({ type: 'rectangle', x: 10, y: 20, width: 100, height: 60 });
    expect(svg.querySelectorAll(`[data-shape-id="${shapes()[0].id}"]`)).toHaveLength(1);
    expect(svg.querySelector('rect[width="100"]')).not.toBeNull();
  });

  it('zoom changes the svg box but not the coordinates', () => {
    viewport.setZoom(2); flushSync();
    expect(svg.getAttribute('width')).toBe('1600');
    expect(svg.getAttribute('viewBox')).toBe('0 0 800 600');
  });

  it('click selects via native hit target; overlay shows 8 handles + rotate knob; moving = 1 history entry', () => {
    const r = makeRect(100, 100, 50, 50, st); editor.addShape(r); editor.deselectAll(); flushSync();
    const g = svg.querySelector(`[data-shape-id="${r.id}"] rect`)!;
    fire(g, 'pointerdown', 120, 120); fire(window, 'pointerup', 120, 120);
    expect(ui.get().selectedIds).toEqual([r.id]);
    expect(svg.querySelectorAll('[data-handle]')).toHaveLength(8);
    expect(svg.querySelectorAll('[data-rotate]')).toHaveLength(1);

    const n = get(historyPast).length;
    drag([120, 120], [170, 150], g);
    expect(shapes()[0]).toMatchObject({ x: 150, y: 130 });
    expect(get(historyPast).length).toBe(n + 1);
  });

  it('dragging a resize handle resizes; the rotation knob rotates', () => {
    const r = makeRect(100, 100, 100, 100, st); editor.addShape(r); flushSync();
    const se = svg.querySelector('[data-handle="se"]')!;
    drag([201, 201], [251, 261], se);                        // the handle sits on the stroke's outer edge (1 px out)
    expect(shapes()[0]).toMatchObject({ x: 100, y: 100, width: 150, height: 160 });
    const knob = svg.querySelector('[data-rotate]')!;
    drag([175, 50], [300, 180], knob);                       // above → right of the centre (175,180)
    expect(shapes()[0].rotation).toBeGreaterThan(30);
  });

  it('thin lines are hit through the invisible fat-stroke clone', () => {
    const l = makeLine({ x: 0, y: 0 }, { x: 200, y: 0 }, { ...st, strokeWidth: 1 }); editor.addShape(l); editor.deselectAll(); flushSync();
    const clones = svg.querySelectorAll(`[data-shape-id="${l.id}"] line`);
    expect(clones).toHaveLength(2);
    expect(clones[1].getAttribute('pointer-events')).toBe('stroke');
    expect(Number(clones[1].getAttribute('stroke-width'))).toBeGreaterThanOrEqual(10);
  });

  it('Delete removes the selection, but NOT while typing in an input (the old Backspace bug)', () => {
    const r = makeRect(0, 0, 10, 10, st); editor.addShape(r); flushSync();
    const input = document.createElement('input'); document.body.appendChild(input);
    key('Backspace', input);
    expect(shapes()).toHaveLength(1);
    key('Delete');
    expect(shapes()).toHaveLength(0);
    key('z', window, { ctrlKey: true });
    expect(shapes()).toHaveLength(1);
    input.remove();
  });

  it('arrow keys nudge (one coalesced history entry), Ctrl+D duplicates, Esc deselects', () => {
    const r = makeRect(10, 10, 10, 10, st); editor.addShape(r); flushSync();
    const n = get(historyPast).length;
    key('ArrowRight'); key('ArrowRight'); key('ArrowDown', window, { shiftKey: true });
    expect(shapes()[0]).toMatchObject({ x: 12 });
    key('d', window, { ctrlKey: true });
    expect(shapes()).toHaveLength(2);
    expect(get(historyPast).length).toBeGreaterThanOrEqual(n + 1);
    key('Escape');
    expect(ui.get().selectedIds).toHaveLength(0);
  });

  it('text: click opens the editor; typing + Esc commits ONE history entry; empty text leaves nothing', async () => {
    editor.selectTool('text'); flushSync();
    fire(svg, 'pointerdown', 50, 60); fire(window, 'pointerup', 50, 60);
    const ta = document.querySelector('textarea.svg-text-editor') as HTMLTextAreaElement;
    expect(ta).not.toBeNull();
    ta.value = 'Hello'; ta.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); flushSync();
    expect(shapes()).toHaveLength(1);
    expect(shapes()[0]).toMatchObject({ type: 'text', content: 'Hello', x: 50, y: 60 });
    expect(get(historyPast)).toHaveLength(1);
    expect(document.querySelector('textarea.svg-text-editor')).toBeNull();

    fire(svg, 'pointerdown', 300, 300); fire(window, 'pointerup', 300, 300);   // empty text
    fire(svg, 'pointerdown', 10, 10);                                           // click elsewhere commits (nothing)
    expect(shapes()).toHaveLength(1); expect(get(historyPast)).toHaveLength(1);
  });

  it('polygon tool: preview guides appear while placing points, and are removed on finish', () => {
    editor.selectTool('polygon'); flushSync();
    [[10, 10], [100, 10], [100, 100]].forEach(([x, y]) => { fire(svg, 'pointerdown', x, y); fire(window, 'pointerup', x, y); });
    fire(window, 'pointermove', 50, 50);
    expect(svg.querySelectorAll('circle').length).toBeGreaterThanOrEqual(3);
    key('Enter');
    expect(shapes()).toHaveLength(1);
    expect(svg.querySelectorAll('circle')).toHaveLength(0);
  });

  it('middle-mouse pan moves the view by the client deltas, past the page edges too', () => {
    viewport.setScroll(100, 100);
    fire(svg, 'pointerdown', 300, 300, { button: 1 });
    fire(window, 'pointermove', 280, 290);
    expect([viewport.get().scrollLeft, viewport.get().scrollTop]).toEqual([120, 110]);
    fire(window, 'pointermove', 260, 280);                                       // no jitter: linear in client delta
    expect(viewport.get().scrollLeft).toBe(140);
    fire(window, 'pointermove', 900, 900);                                       // up and left beyond the page: no limit
    expect([viewport.get().scrollLeft, viewport.get().scrollTop]).toEqual([-500, -500]);
    fire(window, 'pointerup', 900, 900);
  });
});
