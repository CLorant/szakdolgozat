// @vitest-environment jsdom
// Export Options dialog and the theme switch.
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
import { makeRect, makeLine, makeText } from '../../src/lib/utils/shapes';
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

describe('Export Options dialog', () => {
  beforeEach(() => { editor.newDocument(800, 600); exportSettings.reset(); });
  const open = () => { boot(ExportDialog); exportDialogOpen.set(true); flushSync(); };

  it('opens, shows both sections, closes with the X, Esc and a click on the backdrop', () => {
    boot(ExportDialog);
    expect($('.dialog')).toBeNull();
    exportDialogOpen.set(true); flushSync();
    expect($('.dialog h2')!.textContent).toBe('Export Options');
    expect($$('.dialog h3').map(h => h.textContent!.trim().split(' ')[0])).toEqual(['General', 'SVG', 'Raster']);
    $('.dialog .x')!.click(); flushSync();
    expect($('.dialog')).toBeNull();
    exportDialogOpen.set(true); flushSync();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); flushSync();
    expect($('.dialog')).toBeNull();
    exportDialogOpen.set(true); flushSync();
    mouse($('.backdrop')!, 'pointerdown'); expect($('.dialog')).toBeNull();
  });
  it('choices are saved as you click and survive a reload of the settings', () => {
    open();
    const radio = (name: string, i: number) => $$(`input[name="${name}"]`)[i] as HTMLInputElement;
    radio('g-inc', 1).click(); flushSync();
    radio('g-cov', 1).click(); flushSync();
    radio('s-inc', 1).click(); flushSync();
    $$('.global input')[0].click(); flushSync();
    expect(exportSettings.get().svg).toMatchObject({ google: { include: 'linked', coverage: 'full' }, local: { include: 'embedded' }, textToPaths: true });
    expect(JSON.parse(localStorage.getItem('svge.exportSettings.v1')!).svg.textToPaths).toBe(true);
  });
  it('"convert all text to paths" greys out the font options', () => {
    open();
    expect($$('.cols input:disabled')).toHaveLength(0);
    $$('.global input')[0].click(); flushSync();
    expect($$('.cols input').every(i => (i as HTMLInputElement).disabled)).toBe(true);
  });
  it('padding is only editable for "fit around objects"; the raster size is shown live', () => {
    open();
    const pad = $$('.pad input')[0] as HTMLInputElement;
    expect(pad.disabled).toBe(true);
    ($$('input[name="area"]')[1] as HTMLInputElement).click(); flushSync();
    expect(exportSettings.get().general.area).toBe('content');
    expect(($$('.pad input')[0] as HTMLInputElement).disabled).toBe(false);
    expect($('.result')!.textContent).toContain('4000 × 3000 px');
    ($$('input[name="r-size"]')[1] as HTMLInputElement).click(); flushSync();
    type($$('input.inline')[0] as HTMLInputElement, '2');
    expect($('.result')!.textContent).toContain('1600 × 1200 px');
    ($$('input[name="r-size"]')[2] as HTMLInputElement).click(); flushSync();
    type($$('input.inline')[1] as HTMLInputElement, '1000');
    expect($('.result')!.textContent).toContain('1000 × 750 px');
  });
  it('Reset restores the defaults', () => {
    open();
    $$('.global input')[0].click(); flushSync();
    $('.foot .link')!.click(); flushSync();
    expect(exportSettings.get().svg.textToPaths).toBe(false);
  });
});

describe('theme switch', () => {
  it('is instant for everything: transitions are off for the switch and back afterwards', async () => {
    document.documentElement.setAttribute('data-theme', 'light');
    boot(ThemeToggle);
    $('.theme-toggle')!.click(); flushSync();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.classList.contains('theme-switching')).toBe(true);
    await new Promise(r => setTimeout(r, 120));
    expect(document.documentElement.classList.contains('theme-switching')).toBe(false);
  });
});

describe('export options', () => {
  it('the viewBox-only option is labelled as such and there is no AVIF anywhere', () => {
    exportDialogOpen.set(true);
    boot(ExportDialog);
    expect(document.body.textContent).toContain('ViewBox only');
    expect(document.body.textContent).not.toMatch(/avif/i);
  });
});
