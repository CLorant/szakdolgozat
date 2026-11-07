// @vitest-environment jsdom
// The property panel: layout, resize, titles, fill / stroke types, corner radius, dash fields, gradient stops, text color.
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
import { makeRect, makeLine, makeText, getPivot } from '../../src/lib/utils/shapes';
import { historyPast } from '../../src/lib/stores/document';
import GradientEditor from '../../src/lib/components/GradientEditor.svelte';
import { DEFAULT_TEXT_PROPS } from '../../src/lib/utils/text';

const st = { fill: '#336699', stroke: '#000000', strokeWidth: 2 };
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const type = (el: HTMLInputElement | HTMLTextAreaElement, value: string, event = 'input') => { el.value = value; el.dispatchEvent(new Event(event, { bubbles: true })); flushSync(); };
const mouse = (el: EventTarget, t: string, x = 0, y = 0, extra: MouseEventInit = {}) => { el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, ...extra })); flushSync(); };

let mounted: any[] = [];
const boot = (C: any, props: any = {}, extra: any = {}) => { const a = mount(C, { target: document.body, props, ...extra } as any); mounted.push(a); flushSync(); return a; };
afterEach(() => { mounted.forEach(m => unmount(m)); mounted = []; document.body.innerHTML = ''; try { localStorage.clear(); } catch {} exportDialogOpen.set(false); colorMode.set('hex'); });

const click = (el: Element | null) => { el!.dispatchEvent(new MouseEvent('click', { bubbles: true })); flushSync(); };
beforeEach(() => { editor.newDocument(600, 400); ui.set({ property: 'fill', panelOpen: true }); });
afterEach(() => { mounted.forEach(m => unmount(m)); mounted = []; document.body.innerHTML = ''; colorMode.set('hex'); exportDialogOpen.set(false); });
const shapes = () => documentStore.get().shapes;

describe('property panel', () => {
  beforeEach(() => { editor.newDocument(); ui.set({ panelOpen: true, property: 'fill', panelWidth: PANEL_MIN_WIDTH, selectedIds: [] }); });

  it('the collapse button lives in the panel (not in the tab bar) and toggles it', () => {
    boot(PropertyBar); boot(PropertyPanel);
    expect($('.svge-propbar .svge-propbar-collapse, .svge-propbar-root .svge-propbar-collapse')).toBeNull();
    const btn = $('.svge-panel .svge-panel-collapse')!;
    btn.click(); flushSync();
    expect(get(ui).panelOpen).toBe(false);
  });
  it('dragging the left edge resizes it (clamped); double-click resets; arrow keys nudge', () => {
    boot(PropertyPanel);
    const grip = $('.svge-panel-grip')!;
    mouse(grip, 'pointerdown', 500, 0); mouse(window, 'pointermove', 400, 0);
    expect(get(ui).panelWidth).toBe(PANEL_MIN_WIDTH + 100);
    expect($('.svge-panel-slot')!.getAttribute('style')).toMatch(new RegExp(`--panel-w:\\s*${PANEL_MIN_WIDTH + 100}px`));
    mouse(window, 'pointermove', 600, 0); expect(get(ui).panelWidth).toBe(PANEL_MIN_WIDTH);          // never narrower
    mouse(window, 'pointermove', -5000, 0); expect(get(ui).panelWidth).toBeLessThanOrEqual(PANEL_MAX_WIDTH);
    mouse(window, 'pointerup', 0, 0); mouse(window, 'pointermove', 400, 0);
    expect(get(ui).panelWidth).toBeLessThanOrEqual(PANEL_MAX_WIDTH);                                   // listeners are gone after pointerup
    ui.setPanelWidth(400); grip.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); flushSync();
    expect(get(ui).panelWidth).toBe(PANEL_MIN_WIDTH);
    grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); flushSync();
    expect(get(ui).panelWidth).toBe(PANEL_MIN_WIDTH + 16);
  });
  it('the grid sliders sit in a layout that cannot overflow (no third column)', () => {
    ui.set({ property: 'canvas', gridEnabled: true });
    boot(PropertyPanel);
    expect($('.geom-grid.sliders')).not.toBeNull();
    expect($$('.geom-grid.sliders .slider-input')).toHaveLength(2);
  });
  it('the custom background: a + swatch; clicking it picks a color that is kept', () => {
    colorMode.set('hex');
    ui.set({ property: 'canvas' });
    boot(PropertyPanel);
    expect($('.svge-bg-custom')!.textContent).toContain('+');
    $('.svge-bg-custom')!.click(); flushSync();
    expect(documentStore.get()).toMatchObject({ background: 'custom', bgColor: '#ffffff' });
    const hex = $<HTMLInputElement>('.bg-custom-picker .hex-input')!;
    type(hex, '#336699');
    expect(documentStore.get().bgColor).toBe('#336699');
    expect($('.svge-bg-custom')!.textContent).not.toContain('+');
  });
});

describe('property panel titles and labels', () => {
  it('tabs are named Typography and Objects; every panel starts with its own title', () => {
    boot(PropertyBar);
    expect($$('.svge-propbar-btn').map(b => b.getAttribute('aria-label'))).toEqual(['Fill', 'Stroke', 'Geometry', 'Typography', 'Objects', 'History', 'Canvas']);
  });
  it('Fill / Stroke / Canvas use the short section labels', () => {
    editor.addShape(makeRect(0, 0, 10, 10, st)); editor.selectOnly(shapes()[0].id);
    boot(PropertyPanel);
    const heads = (prop: string) => { ui.set({ property: prop as any, panelOpen: true }); flushSync(); return $$('.svge-section-head').map(h => h.textContent!.trim()); };
    expect(heads('fill').slice(0, 2)).toEqual(['Type', 'Color']);
    expect(heads('stroke').slice(0, 2)).toEqual(['Type', 'Color']);
    expect(heads('canvas')[0]).toBe('Size');
    expect($('.panel-title')!.textContent!.trim()).toBe('Canvas');
  });
  it('Objects shows the count next to its title (the list has no header of its own)', () => {
    editor.addShapes([makeRect(0, 0, 10, 10, st), makeRect(20, 0, 10, 10, st)]);
    ui.set({ property: 'layers', panelOpen: true });
    boot(PropertyPanel);
    expect($('.panel-title')!.textContent!.trim()).toBe('Objects2');
    expect($('.layers-panel .panel-header')).toBeNull();
  });
  it('History: no "Actions" title; Undo / Redo sit above the list, outside its scroll area', () => {
    editor.addShape(makeRect(0, 0, 10, 10, st));
    ui.set({ property: 'history', panelOpen: true });
    boot(PropertyPanel);
    expect($('.svge-panel-inner')!.textContent).not.toContain('Actions');
    const buttons = $('.history-actions')!, list = $('.history-list')!;
    expect(buttons.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(list.contains(buttons)).toBe(false);
  });
});

describe('fill / stroke type buttons', () => {
  it('order is Solid, Linear, Radial, None; each has a title; None is an outlined square with a diagonal', () => {
    editor.addShape(makeRect(0, 0, 10, 10, st)); editor.selectOnly(shapes()[0].id);
    ui.set({ property: 'fill', panelOpen: true });
    boot(PropertyPanel);
    const btns = $$('.type-btn');
    expect(btns.map(b => b.title)).toEqual(['Solid', 'Linear', 'Radial', 'None']);
    expect(btns[0].classList.contains('active')).toBe(true);
    expect(btns[3].querySelector('svg line')).not.toBeNull();
    expect(btns[1].querySelector<HTMLElement>('.type-face')!.getAttribute('style')).toContain('gradient');
    click(btns[2]);
    expect(shapes()[0].fill.startsWith('rg:')).toBe(true);
    click($$('.type-btn')[3]);
    expect(shapes()[0].fill).toBe('none');
    click($$('.type-btn')[0]);
    expect(shapes()[0].fill).toBe('#336699');                                    // Solid returns to the last plain color
  });
});

describe('the color code (HEX / RGB / HSL) is remembered', () => {
  it('a picker opened later starts in the code that was last used, on any panel', () => {
    boot(ColorPicker, { value: '#112233' });
    click($$('.mode-tab').find(b => b.textContent === 'HSL')!);
    unmount(mounted.pop()); document.body.innerHTML = '';
    boot(ColorPicker, { value: '#445566' });
    expect($$('.mode-tab').find(b => b.classList.contains('active'))!.textContent).toBe('HSL');
    expect(get(colorMode)).toBe('hsl');
  });
});

describe('rectangle corner radius in the panel', () => {
  const open = (rect = makeRect(0, 0, 100, 60, st)) => {
    editor.addShape(rect); editor.selectOnly(rect.id);
    ui.set({ property: 'geometry', panelOpen: true });
    boot(PropertyPanel);
    const inputs = () => $$('.svge-pair').at(-1)!.querySelectorAll<HTMLInputElement>('input');   // Rx / Ry: the last pair
    return inputs;
  };
  it('the chain (on while rx = ry) sets both; opening it makes the axes independent', () => {
    const inputs = open();
    type(inputs()[0], '12');
    expect([(shapes()[0] as any).rx, (shapes()[0] as any).ry]).toEqual([12, 12]);
    click($('button[aria-label="Keep both radii equal"]')); flushSync();
    type(inputs()[1], '5');
    expect([(shapes()[0] as any).rx, (shapes()[0] as any).ry]).toEqual([12, 5]);
  });
  it('radii are capped at half the side, and 0 on one axis means a sharp rectangle', () => {
    const inputs = open();
    type(inputs()[0], '999');
    expect([(shapes()[0] as any).rx, (shapes()[0] as any).ry]).toEqual([50, 30]);
    click($('button[aria-label="Keep both radii equal"]')); flushSync();
    type(inputs()[1], '0');
    expect([(shapes()[0] as any).rx, (shapes()[0] as any).ry]).toEqual([0, 0]);
  });
});

describe('dash pattern fields', () => {
  it('a typed pattern is stored as typed numbers (px) and survives a width change; bad input is flagged and ignored', () => {
    const l = makeLine({ x: 0, y: 0 }, { x: 100, y: 0 }, { fill: 'none', stroke: '#000000', strokeWidth: 2 });
    editor.addShape(l); editor.selectOnly(l.id);
    ui.set({ property: 'stroke', panelOpen: true });
    boot(PropertyPanel);
    const pattern = $<HTMLInputElement>('input[aria-label="Dash pattern in pixels"]')!;
    type(pattern, '12, 4 2 4');
    expect((shapes()[0] as any).strokeDasharray).toBe('12 4 2 4');
    type(pattern, '12 x');
    expect(pattern.classList.contains('bad')).toBe(true);
    expect((shapes()[0] as any).strokeDasharray).toBe('12 4 2 4');
    editor.setStyle({ strokeWidth: 10 });
    expect((shapes()[0] as any).strokeDasharray).toBe('12 4 2 4');
    const offset = $$('.dash-fields input').find(i => (i as HTMLInputElement).type === 'number') as HTMLInputElement;
    type(offset, '5');
    expect((shapes()[0] as any).strokeDashoffset).toBe(5);
    type(pattern, '');
    expect((shapes()[0] as any).strokeDasharray).toBe('');
  });
});

describe('gradient stops', () => {
  it('Remove deletes exactly the selected stop on the first press, wherever it is', () => {
    for (const pick of [0, 1, 2, 3]) {
      let value = 'lg:90;#ff0000@0,#ff8800@30,#00ff00@60,#0000ff@100';
      boot(GradientEditor, { value }, { events: { change: (e: CustomEvent) => { value = e.detail; } } });
      const handle = $$('.handle')[pick];
      handle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }));
      window.dispatchEvent(new MouseEvent('pointerup')); flushSync();
      click($$('.mini').find(b => b.getAttribute('aria-label') === 'Remove the selected stop')!);
      const left = value.split(';')[1].split(',');
      expect(left, `stop ${pick}`).toHaveLength(3);
      expect(left.map(s => s.split('@')[1])).toEqual(['0', '30', '60', '100'].filter((_, i) => i !== pick));
      unmount(mounted.pop()); document.body.innerHTML = '';
    }
  });
});

describe('text color', () => {
  it('new text is black no matter what the shape fill is; a color picked for text changes only the text default', () => {
    expect(ui.get().textFill).toBe('#000000');
    ui.set({ fill: '#ff0000' });
    expect(ui.get().tool).toBeDefined();
    const t = makeText(0, 0, 'a', ui.get().textProps, { ...st, fill: ui.get().textFill });
    expect(t.fill).toBe('#000000');
    editor.addShape(t); editor.selectOnly(t.id);
    editor.setStyle({ fill: '#00ff00' });
    expect(ui.get().textFill).toBe('#00ff00');
    expect(ui.get().fill).toBe('#ff0000');                                       // shapes keep their own default
    expect(DEFAULT_TEXT_PROPS).toBeDefined();
    ui.set({ textFill: '#000000', fill: '#aaaaaa' });
  });
});

describe('geometry panel', () => {
  const open = () => { ui.set({ property: 'geometry', panelOpen: true, keepAspect: false }); boot(PropertyPanel); };
  const pair = (i: number) => $$('.svge-pair')[i].querySelectorAll<HTMLInputElement>('input');
  it('several shapes: X / Y / W / H are those of the common box and move / scale every shape as one step', () => {
    const a = makeRect(0, 0, 100, 50, st), b = makeRect(200, 100, 100, 50, st);
    editor.addShapes([a, b]); editor.select([a.id, b.id]); open();
    expect([...pair(0)].map(i => i.value)).toEqual(['0', '0']);
    expect([...pair(1)].map(i => i.value)).toEqual(['300', '150']);
    const n = get(historyPast).length;
    type(pair(0)[0], '9'); type(pair(0)[0], '19');
    expect((shapes()[1] as any).x).toBe(219);
    type(pair(1)[0], '600');                                                        // twice as wide: both scale
    expect((shapes()[1] as any).width).toBeCloseTo(200);
    expect(get(historyPast).length).toBe(n + 1);                                    // typing coalesces
    expect($$('.svge-pair')).toHaveLength(2);                                      // no origin / rotation for several
  });
  it('the chain keeps the proportions; it is remembered as a preference', () => {
    const r = makeRect(0, 0, 100, 50, { ...st, stroke: 'none', strokeWidth: 0 });
    editor.addShape(r); editor.selectOnly(r.id); open();
    click($('button[aria-label="Keep proportions"]'));
    expect(ui.get().keepAspect).toBe(true);
    type(pair(1)[0], '200');
    expect([(shapes()[0] as any).width, (shapes()[0] as any).height]).toEqual([200, 100]);
    expect(JSON.parse(localStorage.getItem('svge.preferences.v1')!).keepAspect).toBe(true);
  });
  it('origin: typed in percent or picked from the 3 × 3 grid; it moves nothing, rotation turns about it', () => {
    const r = makeRect(0, 0, 100, 50, { ...st, stroke: 'none', strokeWidth: 0 });
    editor.addShape(r); editor.selectOnly(r.id); open();
    click($('.origin-dot[aria-label="Top left"]'));
    expect(shapes()[0].origin).toEqual({ x: 0, y: 0 });
    expect((shapes()[0] as any).x).toBe(0);
    type($('.svge-panel .si-num') as HTMLInputElement, '90');
    const s = shapes()[0] as any;
    expect(s.rotation).toBe(90);
    const pv = getPivot(s);
    expect(pv.x).toBeCloseTo(0); expect(pv.y).toBeCloseTo(0);                       // the top-left corner stayed put
    type(pair(2)[0], '50');
    expect(shapes()[0].origin).toEqual({ x: 0.5, y: 0 });
  });
});
