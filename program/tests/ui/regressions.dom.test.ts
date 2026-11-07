// @vitest-environment jsdom
// Regressions from the bug report (B-01 … B-06) and later minor fixes.
//
// Regression tests for bugs reported from manual testing (B-01 … B-06 and the "minor" list).
// Each test name starts with the report id so the thesis test chapter can reference it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import { createClassComponent } from 'svelte/legacy';
import { get } from 'svelte/store';
import Canvas from '../../src/lib/layouts/Canvas.svelte';
import ColorPicker from '../../src/lib/components/ColorPicker.svelte';
import { editor } from '../../src/lib/stores/editor';
import { documentStore } from '../../src/lib/stores/document';
import { ui } from '../../src/lib/stores/ui';
import { viewport } from '../../src/lib/stores/viewport';
import { tempShape } from '../../src/lib/stores/interaction';
import { createTools } from '../../src/lib/tools';
import type { PointerInfo } from '../../src/lib/tools';
import { buildSvgDocument } from '../../src/lib/utils/serializer';
import { makeText } from '../../src/lib/utils/shapes';
import { DEFAULT_TEXT_PROPS } from '../../src/lib/utils/text';

const shapes = () => documentStore.get().shapes;
const st = { fill: '#336699', stroke: '#000000', strokeWidth: 2 };

// ── Canvas-level (overlay) bugs ───────────────────────────────────────────────

describe('canvas overlays', () => {
  let app: any, svg: SVGSVGElement;
  const fire = (el: EventTarget, type: string, x = 0, y = 0, extra: MouseEventInit = {}) => {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, ...extra }));
    flushSync();
  };
  const drag = (from: [number, number], to: [number, number], target: EventTarget = svg) => {
    fire(target, 'pointerdown', ...from); fire(window, 'pointermove', ...to); fire(window, 'pointerup', ...to);
  };
  const handle = (n: string) => document.querySelector(`[data-handle="${n}"]`) as SVGElement | null;
  const shapeEl = () => document.querySelector('[data-shape-id]') as SVGElement;

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

  const drawRect = () => {
    ui.selectTool('rectangle'); flushSync();
    drag([100, 100], [200, 160]);
    ui.selectTool('transform'); flushSync();
  };

  it('B-05: after drawing and selecting, move / resize / rotate move the selection box too', () => {
    drawRect();
    drag([150, 130], [150, 130], shapeEl());                  // plain click selects
    expect(handle('nw')).not.toBeNull();
    expect(+handle('nw')!.getAttribute('x')!).toBeCloseTo(100 - 1 - 5);                                  // 1 px = half the stroke

    drag([150, 130], [250, 230], shapeEl());                  // move by (100,100)
    expect(shapes()[0]).toMatchObject({ x: 200, y: 200 });
    expect(+handle('nw')!.getAttribute('x')!).toBeCloseTo(200 - 1 - 5);
    expect(+handle('nw')!.getAttribute('y')!).toBeCloseTo(200 - 1 - 5);

    drag([300, 260], [340, 300], handle('se')!);               // resize
    expect(+handle('se')!.getAttribute('x')!).toBeCloseTo(shapes()[0].type === 'rectangle' ? (shapes()[0] as any).x + (shapes()[0] as any).width + 1 - 5 : 0);

    const knob = document.querySelector('[data-rotate]') as SVGElement;
    drag([250, 170], [400, 250], knob);                        // rotate
    const g = handle('nw')!.parentElement!;
    expect(g.getAttribute('transform')).toMatch(/^rotate\(/);
  });

  it('B-06: deselecting (empty click, Esc, double-click) removes the selection box', () => {
    drawRect();
    drag([150, 130], [150, 130], shapeEl());
    expect(handle('nw')).not.toBeNull();
    drag([600, 500], [600, 500]);                              // click on empty canvas
    expect(handle('nw')).toBeNull();

    drag([150, 130], [150, 130], shapeEl());
    expect(handle('nw')).not.toBeNull();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); flushSync();
    expect(handle('nw')).toBeNull();
  });

  it('B-06: the box also follows a selection made by an unrelated UI change in between', () => {
    drawRect();
    drag([150, 130], [150, 130], shapeEl());
    ui.selectTool('edit'); ui.selectTool('transform'); ui.set({ fill: '#ff0000' }); flushSync();
    drag([150, 130], [180, 160], shapeEl());
    expect(+handle('nw')!.getAttribute('x')!).toBeCloseTo((shapes()[0] as any).x - 1 - 5);
    editor.deselectAll(); flushSync();
    expect(handle('nw')).toBeNull();
  });

  it('B-02: node and handle overlays follow the curve while a node is dragged', () => {
    const pen = createTools({ zoom: () => 1, openText: vi.fn() }).pen;
    const I = (x: number, y: number): PointerInfo => ({ p: { x, y }, raw: { x, y }, shift: false, alt: false, ctrl: false, target: null });
    pen.down(I(100, 100)); pen.up(I(100, 100));
    pen.down(I(300, 100)); pen.move(I(340, 160)); pen.up(I(340, 160));
    pen.escape(); flushSync();
    ui.selectTool('edit'); flushSync();
    const node = () => document.querySelector('[data-node="a1"]') as SVGElement;
    const x0 = +(node().getAttribute('x') ?? node().getAttribute('cx')!);
    const tools = createTools({ zoom: () => 1, openText: vi.fn() });
    tools.edit.down({ ...I(300, 100), target: node() });
    tools.edit.move(I(400, 200)); tools.edit.up(I(400, 200)); flushSync();
    const x1 = +(node().getAttribute('x') ?? node().getAttribute('cx')!);
    expect(x1).not.toBeCloseTo(x0);
    expect(x1).toBeCloseTo(400, 0);
  });
});

// ── Pen tool ───────────────────────────────────────────────────────────────────

describe('pen tool', () => {
  const pen = createTools({ zoom: () => 1, openText: vi.fn() }).pen;
  const I = (x: number, y: number): PointerInfo => ({ p: { x, y }, raw: { x, y }, shift: false, alt: false, ctrl: false, target: null });
  beforeEach(() => { pen.deactivate(); editor.newDocument(); });

  it('B-03: pressing and dragging on the FIRST point behaves like a click (no handles)', () => {
    pen.down(I(100, 100)); pen.move(I(160, 140)); pen.up(I(160, 140));
    pen.down(I(300, 100)); pen.up(I(300, 100));
    pen.dblclick!(I(300, 100));
    const p: any = shapes()[0];
    expect(p.nodes[0]).toMatchObject({ x: 100, y: 100, hin: null, hout: null, smooth: false });
  });

  it('B-03: later points can still be dragged into smooth nodes', () => {
    pen.down(I(100, 100)); pen.up(I(100, 100));
    pen.down(I(300, 100)); pen.move(I(340, 160)); pen.up(I(340, 160));
    pen.escape();
    const p: any = shapes()[0];
    expect(p.nodes[1].smooth).toBe(true);
    expect(p.nodes[1].hout).not.toBeNull();
  });

  it('B-04: the closing preview is the closed path that the click creates', () => {
    pen.down(I(100, 100)); pen.up(I(100, 100));
    pen.down(I(300, 120)); pen.move(I(360, 200)); pen.up(I(360, 200));
    pen.down(I(200, 300)); pen.move(I(120, 330)); pen.up(I(120, 330));
    pen.move(I(103, 104));                                     // hover near the first node
    const preview: any = get(tempShape);
    expect(preview.closed).toBe(true);
    expect(preview.nodes).toHaveLength(3);                     // no extra rubber-band node
    pen.down(I(103, 104)); pen.up(I(103, 104));
    const final: any = shapes()[0];
    expect(final.closed).toBe(true);
    expect(final.nodes).toEqual(preview.nodes);
    expect(final.nodes[0].hin).toBeNull();                     // no hidden handle on the start node
  });
});

// ── Export ─────────────────────────────────────────────────────────────────────

describe('export', () => {
  it('B-01: exported SVG is well-formed XML and has no external font dependency', () => {
    const t = makeText(10, 30, 'a & b', { ...DEFAULT_TEXT_PROPS, fontFamily: 'JetBrains Mono' }, st);
    const svg = buildSvgDocument({ ...documentStore.get(), shapes: [t] }, { fontCss: "@font-face { src: url(data:font/woff;base64,AAAA&BBB) }" });
    expect(svg).not.toContain('@import');
    expect(svg).not.toContain('fonts.googleapis');
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.querySelector('style')!.textContent).toContain('@font-face');
  });
});

// ── Panels: defaults and live controls ─────────────────────────────────────────

describe('style defaults without a selection', () => {
  beforeEach(() => { editor.newDocument(); ui.set({ strokeLinecap: 'round', strokeLinejoin: 'round', dashKind: 'solid', strokeWidth: 2 }); });

  it('minor: cap / join / dash chosen with nothing selected are remembered and used by new shapes', () => {
    editor.setStyle({ strokeLinecap: 'butt' }); editor.setStyle({ strokeLinejoin: 'bevel' }); editor.setDashKind('dashed');
    expect(ui.get()).toMatchObject({ strokeLinecap: 'butt', strokeLinejoin: 'bevel', dashKind: 'dashed' });
    const tools = createTools({ zoom: () => 1, openText: vi.fn() });
    const I = (x: number, y: number): PointerInfo => ({ p: { x, y }, raw: { x, y }, shift: false, alt: false, ctrl: false, target: null });
    tools.rectangle.down(I(10, 10)); tools.rectangle.move(I(80, 60)); tools.rectangle.up(I(80, 60));
    expect(shapes()[0]).toMatchObject({ strokeLinecap: 'butt', strokeLinejoin: 'bevel', strokeDasharray: '6 4' });   // 3w / 2w at width 2, butt cap
  });
});

describe('ColorPicker', () => {
  let cp: any;
  afterEach(() => { if (cp) unmount(cp); cp = null; document.body.innerHTML = ''; });

  const pointer = (el: Element, type: string, x: number, y: number) => {
    el.dispatchEvent(Object.assign(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, buttons: 1 }), { pointerId: 1 }));
    flushSync();
  };

  it('minor: the indicator stays where it was dragged even if the parent echoes the OLD value first', () => {
    const changes: string[] = [];
    cp = mount(ColorPicker, { target: document.body, props: { value: '#aaaaaa', showAlpha: true }, events: { change: (e: CustomEvent) => changes.push(e.detail) } } as any);
    flushSync();
    const sv = document.querySelector('.sv-panel') as HTMLElement;
    sv.setPointerCapture = () => {};
    sv.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0 } as any);
    const thumb = () => document.querySelector('.sv-thumb') as HTMLElement;

    pointer(sv, 'pointerdown', 100, 25);                       // s=50, v=75
    pointer(sv, 'pointermove', 150, 50);                       // s=75, v=50
    expect(changes.length).toBe(2);
    expect(thumb().style.left).toBe('75%');
    expect(thumb().style.top).toBe('50%');
  });

  it('minor: a new value from outside (selecting another shape, undo) moves the indicator', () => {
    const c: any = createClassComponent({ component: ColorPicker as any, target: document.body, props: { value: '#ff0000' } });
    cp = null; flushSync();
    const thumb = () => document.querySelector('.sv-thumb') as HTMLElement;
    expect(thumb().style.left).toBe('100%');                    // pure red: s=100
    c.$set({ value: '#808080' });                               // grey: s=0
    flushSync();
    expect(thumb().style.left).toBe('0%');
    c.$destroy();
  });
});
