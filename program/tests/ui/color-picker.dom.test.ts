// @vitest-environment jsdom
// Color picker inputs and the recent colors.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
import { documentStore, historyPast } from '../../src/lib/stores/document';
import { ui, PANEL_MIN_WIDTH, PANEL_MAX_WIDTH } from '../../src/lib/stores/ui';
import { textEdit, pickedNodes, activeNode } from '../../src/lib/stores/interaction';
import { viewport } from '../../src/lib/stores/viewport';
import { colorMode } from '../../src/lib/stores/colorMode';
import { exportDialogOpen, exportSettings } from '../../src/lib/utils/exportSettings';
import { makeRect, makePath, makeEllipse, moveAnchors, anchorPositions } from '../../src/lib/utils/shapes';
import { createTools } from '../../src/lib/tools';
import type { PointerInfo } from '../../src/lib/tools';
import { corner } from '../../src/lib/utils/path';
import { normalizeShape } from '../../src/lib/utils/project';
import { mergeable } from '../../src/lib/utils/blob';
import type { PathShape } from '../../src/lib/utils/types';
// The parts of this round that need real components: color inputs, panel resize, text deselect,
// Pan tool, Shift lock, Export dialog, instant theme switch.

const st = { fill: '#336699', stroke: '#000000', strokeWidth: 2 };
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const type = (el: HTMLInputElement | HTMLTextAreaElement, value: string, event = 'input') => { el.value = value; el.dispatchEvent(new Event(event, { bubbles: true })); flushSync(); };
const mouse = (el: EventTarget, t: string, x = 0, y = 0, extra: MouseEventInit = {}) => { el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, ...extra })); flushSync(); };

let mounted: any[] = [];
const boot = (C: any, props: any = {}, extra: any = {}) => { const a = mount(C, { target: document.body, props, ...extra } as any); mounted.push(a); flushSync(); return a; };
afterEach(() => { mounted.forEach(m => unmount(m)); mounted = []; document.body.innerHTML = ''; try { localStorage.clear(); } catch {} exportDialogOpen.set(false); colorMode.set('hex'); });

const ctx = { zoom: () => 1, openText: vi.fn() };
const tools = createTools(ctx);
const tgt = (attrs: Record<string, string>) => ({
  closest: (sel: string) => { const k = /^\[(.+)\]$/.exec(sel)![1]; return k in attrs ? { getAttribute: () => attrs[k] } : null; },
}) as unknown as Element;
const I = (x: number, y: number, o: Partial<PointerInfo> = {}): PointerInfo =>
  ({ p: { x, y }, raw: { x, y }, shift: false, alt: false, ctrl: false, target: null, ...o });
const shapes = () => documentStore.get().shapes;
const hist = () => get(historyPast).length;
const K = (key: string, shiftKey = false) => ({ key, shiftKey }) as KeyboardEvent;   // node environment: no DOM events
const square = () => makePath([corner(0, 0), corner(100, 0), corner(100, 100), corner(0, 100), corner(50, 150)], true, st);

beforeEach(() => {
  Object.values(tools).forEach(t => t.deactivate());
  editor.newDocument();
  ui.set({ tool: 'edit', snapEnabled: false });
});

describe('color inputs apply while typing and are sanitised', () => {
  let changes: string[];
  beforeEach(() => { changes = []; });
  const picker = (value = '#112233') => boot(ColorPicker, { value, showAlpha: true }, { events: { change: (e: CustomEvent) => changes.push(e.detail) } });

  it('HEX: a complete code is applied at once, 3 / 4 / 6 / 8 digits; partial codes are not; junk is stripped', () => {
    picker();
    const hex = $<HTMLInputElement>('.hex-input')!;
    type(hex, '#ff0'); expect(changes.at(-1)).toBe('#ffff00');
    type(hex, '#ff00'); expect(changes.at(-1)).toBe('#ffff0000');                // 4 digits = #rgba (ff ff 00 00)
    changes.length = 0;
    type(hex, '#ff00f'); expect(changes).toEqual([]);                            // 5 digits: wait
    type(hex, '#ff00ff'); expect(changes.at(-1)).toBe('#ff00ff');
    type(hex, '#ff00ff80'); expect(changes.at(-1)).toBe('#ff00ff80');
    type(hex, 'zz#12 34xx56'); expect(hex.value).toBe('#123456'); expect(changes.at(-1)).toBe('#123456');
  });
  it('HEX: opacity digits are omitted when fully opaque (blur normalises); 100% alpha typed as ff is the same color', () => {
    picker();
    const hex = $<HTMLInputElement>('.hex-input')!;
    type(hex, '#abcdefff'); expect(changes.at(-1)).toBe('#abcdef');
    hex.dispatchEvent(new Event('blur')); flushSync();
    expect(hex.value).toBe('#ABCDEF');
    type(hex, '#abcdef00'); expect(changes.at(-1)).toBe('#abcdef00');             // 0 % is kept
  });
  it('HEX: an incomplete code is restored on blur', () => {
    picker('#112233');
    const hex = $<HTMLInputElement>('.hex-input')!;
    type(hex, '#12'); hex.dispatchEvent(new Event('blur')); flushSync();
    expect(hex.value).toBe('#112233');
  });
  it('HEX alpha %: clamped to 0–100 while typing', () => {
    picker('#112233');
    const a = $<HTMLInputElement>('.alpha-num-wrap input')!;
    type(a, '50'); expect(changes.at(-1)).toBe('#11223380');
    type(a, '250'); expect(changes.at(-1)).toBe('#112233');                      // → 100 %
    type(a, '-5'); expect(changes.at(-1)).toBe('#11223300');                     // → 0 %
  });
  it('RGB: clamped 0–255 live, field shows the real value when left', async () => {
    picker('#112233');
    $$('.mode-tab').find(b => b.textContent === 'RGB')!.click(); flushSync();
    const [r, g] = $$('.channel input') as HTMLInputElement[];
    type(r, '300'); expect(changes.at(-1)).toBe('#ff2233');
    type(g, '-9'); expect(changes.at(-1)).toBe('#ff0033');
    type(r, '300', 'change'); await new Promise(res => setTimeout(res, 0)); flushSync();
    expect(r.value).toBe('255');
  });
  it('HSL: hue is 0–360, saturation / lightness / alpha 0–100', () => {
    picker('#ff0000');
    $$('.mode-tab').find(b => b.textContent === 'HSL')!.click(); flushSync();
    const [h, s, l] = $$('.channel input') as HTMLInputElement[];
    type(h, '999'); expect(changes.at(-1)).toBe('#ff0000');                      // 360° = red again
    type(h, '120'); expect(changes.at(-1)).toBe('#00ff00');
    type(l, '500'); expect(changes.at(-1)).toBe('#ffffff');                      // L 100 %
    type(l, '50'); type(s, '-3'); expect(changes.at(-1)).toBe('#808080');         // S 0 % = grey
  });
});

describe('Recent colors', () => {
  it('keeps the newest first, once each, at most 16; the drawing colors include gradient stops', async () => {
    const { recentColors, rememberColor, documentColors, MAX_RECENT } = await import('../../src/lib/stores/recentColors');
    for (let i = 0; i < 20; i++) rememberColor(`#0000${i.toString(16).padStart(2, '0')}`);
    rememberColor('#000005');
    const list = get(recentColors);
    expect(list).toHaveLength(MAX_RECENT);
    expect(list[0]).toBe('#000005');
    expect(new Set(list).size).toBe(list.length);
    rememberColor('not a color');
    expect(get(recentColors)[0]).toBe('#000005');
    editor.addShapes([makeRect(0, 0, 5, 5, { fill: 'lg:0;#ff0000@0,#0000ff@100', stroke: '#000000', strokeWidth: 1 })]);
    expect(get(documentColors)).toEqual(['#ff0000', '#0000ff', '#000000']);
  });
});
