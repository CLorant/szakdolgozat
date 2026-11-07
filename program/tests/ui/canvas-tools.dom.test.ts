// @vitest-environment jsdom
// Canvas interactions that need components: Shift lock, Hand tool, text selection, multi-selection boxes, toolbar.
// Pan tool, Shift lock, Export dialog, instant theme switch.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import { get } from 'svelte/store';
import Canvas from '../../src/lib/layouts/Canvas.svelte';
import PropertyPanel from '../../src/lib/layouts/PropertyPanel.svelte';
import PropertyBar from '../../src/lib/layouts/PropertyBar.svelte';
import ColorPicker from '../../src/lib/components/ColorPicker.svelte';
import ExportDialog from '../../src/lib/components/ExportDialog.svelte';
import ThemeToggle from '../../src/lib/components/ThemeToggle.svelte';
import Toolbar from '../../src/lib/layouts/Toolbar.svelte';
import { editor } from '../../src/lib/stores/editor';
import { documentStore } from '../../src/lib/stores/document';
import { ui, PANEL_MIN_WIDTH, PANEL_MAX_WIDTH } from '../../src/lib/stores/ui';
import { textEdit } from '../../src/lib/stores/interaction';
import { viewport } from '../../src/lib/stores/viewport';
import { colorMode } from '../../src/lib/stores/colorMode';
import { exportDialogOpen, exportSettings } from '../../src/lib/utils/exportSettings';
import { makeRect } from '../../src/lib/utils/shapes';

const st = { fill: '#336699', stroke: '#000000', strokeWidth: 2 };
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const type = (el: HTMLInputElement | HTMLTextAreaElement, value: string, event = 'input') => { el.value = value; el.dispatchEvent(new Event(event, { bubbles: true })); flushSync(); };
const mouse = (el: EventTarget, t: string, x = 0, y = 0, extra: MouseEventInit = {}) => { el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, ...extra })); flushSync(); };

let mounted: any[] = [];
const boot = (C: any, props: any = {}, extra: any = {}) => { const a = mount(C, { target: document.body, props, ...extra } as any); mounted.push(a); flushSync(); return a; };
afterEach(() => { mounted.forEach(m => unmount(m)); mounted = []; document.body.innerHTML = ''; try { localStorage.clear(); } catch {} exportDialogOpen.set(false); colorMode.set('hex'); });

describe('canvas interactions', () => {
  let svg: SVGSVGElement;
  beforeEach(() => {
    editor.newDocument(800, 600);
    ui.set({ tool: 'transform', snapEnabled: false, gridEnabled: false, shiftLock: false, selectedIds: [], groupPath: [] });
    viewport.setZoom(1);
    viewport.setScroll(100, 100);
    boot(Canvas);
    svg = $('svg.svge-canvas') as unknown as SVGSVGElement;
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0 } as any);
  });
  const drag = (a: [number, number], b: [number, number]) => { mouse(svg, 'pointerdown', ...a); mouse(window, 'pointermove', ...b); mouse(window, 'pointerup', ...b); };

  it('Shift lock = a virtual Shift: a rectangle drag becomes a square, an ellipse a circle', () => {
    ui.set({ shiftLock: true, tool: 'rectangle' }); flushSync();
    drag([10, 10], [110, 60]);
    const r = documentStore.get().shapes[0] as any;
    expect([r.width, r.height]).toEqual([100, 100]);
    ui.set({ tool: 'ellipse' }); flushSync();
    drag([200, 200], [300, 230]);
    const e = documentStore.get().shapes[1] as any;
    expect(e.rx).toBe(e.ry);
  });
  it('the Hand tool pans the scroll area and never draws or selects', () => {
    editor.addShape(makeRect(0, 0, 50, 50, st)); editor.deselectAll();
    ui.set({ tool: 'pan' }); flushSync();
    drag([300, 300], [250, 270]);
    expect([viewport.get().scrollLeft, viewport.get().scrollTop]).toEqual([150, 130]);
    expect(documentStore.get().shapes).toHaveLength(1);
    expect(get(ui).selectedIds).toEqual([]);
    expect(svg.style.cursor).toBe('grab');
  });
  it('text: after finishing with the Text tool it stays selected, like the shape of every drawing tool', () => {
    ui.set({ tool: 'text' }); flushSync();
    mouse(svg, 'pointerdown', 50, 80); mouse(window, 'pointerup', 50, 80);
    expect(get(textEdit)).not.toBeNull();
    const ta = $<HTMLTextAreaElement>('.svg-text-editor')!;
    type(ta, 'Hello');
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); flushSync();
    expect(documentStore.get().shapes).toHaveLength(1);
    expect(get(ui).selectedIds).toEqual([documentStore.get().shapes[0].id]);
  });
  it('text: edited with the Select tool it stays selected (its box is visible there)', () => {
    ui.set({ tool: 'text' }); flushSync();
    mouse(svg, 'pointerdown', 50, 80); mouse(window, 'pointerup', 50, 80);
    type($<HTMLTextAreaElement>('.svg-text-editor')!, 'Hello');
    $<HTMLTextAreaElement>('.svg-text-editor')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); flushSync();
    ui.set({ tool: 'transform' }); flushSync();
    const id = documentStore.get().shapes[0].id;
    editor.selectOnly(id);
    mouse($(`[data-shape-id="${id}"]`)!, 'dblclick', 52, 70);                    // re-open with the Select tool
    expect(get(textEdit)).not.toBeNull();
    const ta = $<HTMLTextAreaElement>('.svg-text-editor')!;
    type(ta, 'Hello!');
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); flushSync();
    expect(get(ui).selectedIds).toEqual([id]);
  });
  it('multi-selection: every shape keeps its own box; handles and knob sit on the common box', () => {
    editor.addShapes([makeRect(0, 0, 100, 50, st), makeRect(200, 100, 100, 100, st)]); flushSync();
    expect($$('svg.svge-canvas rect[stroke-dasharray]')).toHaveLength(2);       // one dashed box per shape, none around the whole
    expect($$('[data-handle]')).toHaveLength(8);
    expect($$('[data-rotate]')).toHaveLength(1);
    const se = $('[data-handle="se"]')!;
    expect(parseFloat(se.getAttribute('x')!) + parseFloat(se.getAttribute('width')!) / 2).toBeCloseTo(300, 5);   // on the union box corner (300,200)
  });
});

describe('toolbar', () => {
  it('has a Hand tool (H) and a Shift lock toggle', () => {
    ui.set({ shiftLock: false, tool: 'transform' });
    boot(Toolbar);
    const hand = $('.svge-tool-btn[title^="Pan"]')!;
    hand.click(); flushSync();
    expect(get(ui).tool).toBe('pan');
    const lock = $('.svge-lock-btn')!;
    lock.click(); flushSync();
    expect(get(ui).shiftLock).toBe(true);
    expect(lock.getAttribute('aria-pressed')).toBe('true');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', bubbles: true })); flushSync();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true })); flushSync();
    expect(get(ui).tool).toBe('pan');
  });
});
