// @vitest-environment jsdom
// The whole app mounted: toolbar, menus, panels, autosave.
// Smoke + regression tests: mounts the WHOLE app and drives it through the UI.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';
import { get } from 'svelte/store';
import App from '../../src/App.svelte';
import { editor } from '../../src/lib/stores/editor';
import { documentStore } from '../../src/lib/stores/document';
import { ui } from '../../src/lib/stores/ui';
import { viewport } from '../../src/lib/stores/viewport';
import { toasts } from '../../src/lib/stores/notify';
import { serializeProject } from '../../src/lib/utils/project';
import { makeRect, makeEllipse } from '../../src/lib/utils/shapes';

const st = { fill: '#336699', stroke: '#000000', strokeWidth: 2 };
let app: any;

class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as any).ResizeObserver = RO;

const $ = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const click = (el: Element | null) => { expect(el).not.toBeNull(); el!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); flushSync(); };
const key = (k: string, extra: KeyboardEventInit = {}, target: EventTarget = window) => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra })); flushSync();
};
const tab = (label: string) => click($(`.svge-propbar-btn[aria-label="${label}"]`));
const menu = (name: string) => click($$('.svge-menu-btn').find(b => b.textContent?.trim() === name)!);
const item = (text: string) => click($$('.svge-dd-item').find(b => b.textContent?.trim().startsWith(text))!);

function boot() {
  app = mount(App, { target: document.body });
  flushSync();
}

beforeEach(() => {
  localStorage.clear();
  editor.newDocument(800, 600);
  ui.set({ tool: 'transform', panelOpen: false, property: '', gridEnabled: false, snapEnabled: false });
  viewport.setZoom(1); viewport.setScroll(0, 0);
  toasts.set([]);
});
afterEach(() => { unmount(app); document.body.innerHTML = ''; vi.restoreAllMocks(); });

describe('App', () => {
  it('mounts: toolbar has 13 tools + the Shift lock toggle (Arc, Scissors and Blob included), canvas and rulers render', () => {
    boot();
    expect($$('.svge-tool-btn')).toHaveLength(14);
    expect($('.svge-tool-btn[title="Arc [A]"]')).not.toBeNull();
    expect($('.svge-tool-btn[title="Scissors [C]"]')).not.toBeNull();
    expect($('.svge-tool-btn[title="Blob [Shift+B]"]')).not.toBeNull();
    expect($('.svge-tool-btn[title^="Pen"]')).not.toBeNull();
    expect($('.svge-tool-btn[title^="Zoom"]')).toBeNull();
    expect($('svg.svge-canvas')).not.toBeNull();
    expect($$('.svge-tick').length).toBeGreaterThan(10);
  });

  it('REGRESSION: Undo button state updates immediately after drawing (was stale)', () => {
    boot();
    const undo = () => $('button[aria-label="Undo"]') as HTMLButtonElement;
    expect(undo().disabled).toBe(true);
    editor.addShape(makeRect(0, 0, 10, 10, st)); flushSync();
    expect(undo().disabled).toBe(false);
    click(undo());
    expect(documentStore.get().shapes).toHaveLength(0);
    expect((($('button[aria-label="Redo"]')) as HTMLButtonElement).disabled).toBe(false);
  });

  it('REGRESSION: multi-select shows the Align toolbar (it was unreachable)', () => {
    boot();
    const a = makeRect(0, 0, 10, 10, st), b = makeRect(50, 50, 10, 10, st);
    editor.addShapes([a, b]); flushSync();
    expect($('.svge-cmdbar')!.textContent).toContain('2 selected');
    expect($('.svge-cmdbar')!.textContent).toContain('Align');
    click($('button[title="Align left edges"]'));
    expect(documentStore.get().shapes.map(s => (s as any).x)).toEqual([0, 0]);
  });

  it('REGRESSION: Ctrl+Z / Ctrl+V no longer switch tools; plain letters do', () => {
    boot();
    key('z', { ctrlKey: true }); key('v', { ctrlKey: true }); key('r', { ctrlKey: true });
    expect(get(ui).tool).toBe('transform');
    key('r'); expect(get(ui).tool).toBe('rectangle');
    key('b'); expect(get(ui).tool).toBe('pen');
    const input = document.createElement('input'); document.body.appendChild(input);
    key('e', {}, input); expect(get(ui).tool).toBe('pen');                      // typing in a field
    input.remove();
  });

  it('property tabs all open without errors and show the right content', () => {
    boot();
    editor.addShapes([makeRect(0, 0, 100, 50, st), makeEllipse(60, 60, 20, 10, st)]); flushSync();
    editor.select([get(documentStore).shapes[0].id]); flushSync();
    // [tab, panel title, something only that panel shows]
    for (const [label, title, text] of [['Fill', 'Fill', 'Color'], ['Stroke', 'Stroke', 'Dash pattern'], ['Geometry', 'Geometry', 'Position'],
                                         ['Typography', 'Typography', 'Font family'], ['Objects', 'Objects', 'Rectangle'],
                                         ['History', 'History', 'Undo'], ['Canvas', 'Canvas', 'Size']] as const) {
      tab(label);
      expect($('.svge-panel .panel-title')!.textContent!.trim().startsWith(title), label).toBe(true);
      expect($('.svge-panel')!.textContent, label).toContain(text);
    }
    expect($('.svge-panel')!.textContent).not.toContain('Actions');
    expect($$('.svge-propbar-btn')).toHaveLength(7);
  });

  it('style edits from the panel apply to ALL selected shapes and coalesce into one history step', () => {
    boot();
    editor.addShapes([makeRect(0, 0, 10, 10, st), makeRect(20, 0, 10, 10, st)]); flushSync();
    tab('Stroke');
    for (let i = 1; i <= 20; i++) editor.setStyle({ strokeWidth: i }, 'Change stroke width');
    expect(documentStore.get().shapes.every(s => s.strokeWidth === 20)).toBe(true);
    editor.undo(); flushSync();
    expect(documentStore.get().shapes.every(s => s.strokeWidth === 2)).toBe(true);
  });

  it('Layers: click selects, double-click renames (one history entry), eye hides, padlock locks', () => {
    boot();
    const a = makeRect(0, 0, 10, 10, st), b = makeEllipse(5, 5, 5, 5, st);
    editor.addShapes([a, b]); editor.deselectAll(); flushSync();
    tab('Objects');
    const rows = () => $$('.layer-item');
    expect(rows().map(r => r.querySelector('.layer-name')!.textContent!.trim())).toEqual(['Ellipse', 'Rectangle']);   // top first
    click(rows()[1]);
    expect(get(ui).selectedIds).toEqual([a.id]);
    rows()[1].querySelector('.layer-name')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); flushSync();
    const input = $('.rename-input') as HTMLInputElement;
    input.value = 'Box'; input.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); flushSync();
    expect(documentStore.get().shapes[0].name).toBe('Box');
    click(rows()[0].querySelector('.vis-btn'));
    expect(documentStore.get().shapes[1].visible).toBe(false);
    expect(rows()[0].querySelector('.z-btn')).toBeNull();                       // reordering is by dragging only
    click(rows()[1].querySelector('.lock-btn'));                                // the selected Box gets locked …
    expect(documentStore.get().shapes[0].locked).toBe(true);
    expect(get(ui).selectedIds).toEqual([]);                                    // … and leaves the selection
    click(rows()[1]);
    expect(get(ui).selectedIds).toEqual([]);                                    // locked rows cannot be selected
    click(rows()[1].querySelector('.lock-badge'));                              // the always-visible padlock unlocks
    expect(documentStore.get().shapes[0].locked).toBeUndefined();
  });

  it('History panel: jumping to an entry lands on the state its label names', () => {
    boot();
    editor.addShape(makeRect(0, 0, 10, 10, st), 'Add rectangle');
    editor.addShape(makeEllipse(5, 5, 5, 5, st), 'Add ellipse'); flushSync();
    tab('History');
    const labels = $$('.history-item .history-label, .history-present .history-label').map(e => e.textContent);
    expect(labels).toEqual(['Add ellipse', 'Add rectangle', 'New document']);       // current, then older
    click($$('.history-item').find(b => b.textContent!.includes('Add rectangle'))!);
    expect(documentStore.get().shapes).toHaveLength(1);                         // state AFTER "Add rectangle"
  });

  it('Menu: opens, actions run, Edit→Undo works, only real shortcuts are advertised', () => {
    boot();
    editor.addShape(makeRect(0, 0, 10, 10, st)); flushSync();
    menu('File');
    expect($$('.svge-dd-item').map(b => b.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('Save project'), expect.stringContaining('Export as PNG')]));
    expect($('.svge-dropdown')!.textContent).not.toContain('Ctrl N');
    menu('Edit'); item('Undo');
    expect(documentStore.get().shapes).toHaveLength(0);
    expect($('.svge-dropdown')).toBeNull();                                      // closes after an action
    menu('View'); item('Grid');
    expect(get(ui).gridEnabled).toBe(true);
  });

  it('File→New asks for confirmation only when there are unsaved changes', () => {
    boot();
    const conf = vi.spyOn(window, 'confirm').mockReturnValue(false);
    menu('File'); item('New');
    expect(conf).not.toHaveBeenCalled();                                          // nothing to lose
    editor.addShape(makeRect(0, 0, 10, 10, st)); flushSync();
    menu('File'); item('New');
    expect(conf).toHaveBeenCalledTimes(1);
    expect(documentStore.get().shapes).toHaveLength(1);                            // cancelled
    conf.mockReturnValue(true);
    menu('File'); item('New');
    expect(documentStore.get().shapes).toHaveLength(0);
  });

  it('restores the autosaved session on start-up, quietly (the drawing itself shows it)', async () => {
    localStorage.setItem('svg-editor:autosave:v1', serializeProject({ ...documentStore.get(), width: 640, shapes: [makeRect(1, 2, 3, 4, st)] }));
    boot(); await tick(); flushSync();
    expect(documentStore.get().shapes).toHaveLength(1);
    expect(documentStore.get().width).toBe(640);
    expect($('.toasts')?.textContent ?? '').not.toContain('Restored');
  });

  it('autosaves edits (debounced) after start-up', () => {
    vi.useFakeTimers();
    boot();
    editor.addShape(makeRect(0, 0, 10, 10, st));
    vi.advanceTimersByTime(1200);
    expect(JSON.parse(localStorage.getItem('svg-editor:autosave:v1')!).doc.shapes).toHaveLength(1);
    vi.useRealTimers();
  });

  it('rulers keep ticks after scrolling / zooming far (was blank)', () => {
    boot();
    viewport.setZoom(0.05); viewport.setScroll(0, 0); flushSync();
    expect($$('.svge-ruler-h .svge-tick').length).toBeGreaterThan(5);
    viewport.setZoom(8); viewport.setScroll(20000, 0); flushSync();
    expect($$('.svge-ruler-h .svge-tick').length).toBeGreaterThan(5);
  });

  it('Canvas tab: changing the size updates the document; theme toggle flips data-theme', () => {
    boot();
    tab('Canvas');
    const w = $$('.svge-num-input')[0] as HTMLInputElement;
    w.value = '1000'; w.dispatchEvent(new Event('change', { bubbles: true })); flushSync();
    expect(documentStore.get().width).toBe(1000);
    const before = document.documentElement.getAttribute('data-theme');
    click($('.theme-toggle'));
    expect(document.documentElement.getAttribute('data-theme')).not.toBe(before);
  });

  it('hint text is context-sensitive and never mentions removed features', () => {
    boot();
    for (const t of ['line', 'rectangle', 'ellipse', 'polygon', 'pen', 'freehand', 'text', 'edit', 'transform'] as const) {
      ui.selectTool(t); flushSync();
      const txt = $('.svge-cmdbar')!.textContent!;
      expect(txt).not.toMatch(/quad|cubic/i);                                     // the old Pen sub-modes are gone
    }
    ui.selectTool('pen'); flushSync();
    expect($('.svge-cmdbar')!.textContent).toMatch(/continues with arcs/);
  });
});
