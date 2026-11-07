// @vitest-environment jsdom
// Copy and paste: between tabs, other programs, pictures, paste here.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { editor } from '../../src/lib/stores/editor';
import { documentStore, historyPast } from '../../src/lib/stores/document';
import { ui } from '../../src/lib/stores/ui';
import { makeRect, makePath, makeEllipse, moveAnchors, anchorPositions } from '../../src/lib/utils/shapes';
import { saveSharedClip, loadSharedClip, clipSvg, looksLikeSvg, MARKER } from '../../src/lib/utils/clipboard';
import { onCopyEvent, onPasteEvent, pasteClipboardText } from '../../src/lib/utils/clipboardActions';
import { get } from 'svelte/store';
import { createTools } from '../../src/lib/tools';
import type { PointerInfo } from '../../src/lib/tools';
import { pickedNodes, activeNode } from '../../src/lib/stores/interaction';
import { corner } from '../../src/lib/utils/path';
import { normalizeShape } from '../../src/lib/utils/project';
import { mergeable } from '../../src/lib/utils/blob';
import type { PathShape } from '../../src/lib/utils/types';

const st = { fill: 'lg:0;#ff0000@0,#0000ff@100', stroke: '#000000', strokeWidth: 2 };
const shapes = () => documentStore.get().shapes;
const copyEvent = (target: EventTarget = document.body) => {
  const data: Record<string, string> = {};
  const e = { target, clipboardData: { setData: (k: string, v: string) => { data[k] = v; }, getData: (k: string) => data[k] ?? '' }, preventDefault: vi.fn() } as unknown as ClipboardEvent;
  return { e, data };
};
const pasteEvent = (text: string, target: EventTarget = document.body) => {
  return { target, clipboardData: { getData: () => text }, preventDefault: vi.fn() } as unknown as ClipboardEvent;
};

beforeEach(() => { localStorage.clear(); editor.newDocument(); ui.set({ tool: 'transform' }); });

const ctx = { zoom: () => 1, openText: vi.fn() };
const tools = createTools(ctx);
const tgt = (attrs: Record<string, string>) => ({
  closest: (sel: string) => { const k = /^\[(.+)\]$/.exec(sel)![1]; return k in attrs ? { getAttribute: () => attrs[k] } : null; },
}) as unknown as Element;
const I = (x: number, y: number, o: Partial<PointerInfo> = {}): PointerInfo =>
  ({ p: { x, y }, raw: { x, y }, shift: false, alt: false, ctrl: false, target: null, ...o });
const hist = () => get(historyPast).length;
const K = (key: string, shiftKey = false) => ({ key, shiftKey }) as KeyboardEvent;   // node environment: no DOM events
const square = () => makePath([corner(0, 0), corner(100, 0), corner(100, 100), corner(0, 100), corner(50, 150)], true, st);

beforeEach(() => {
  Object.values(tools).forEach(t => t.deactivate());
  editor.newDocument();
  ui.set({ tool: 'edit', snapEnabled: false });
});

describe('clipboard', () => {
  it('copy event: SVG text on the system clipboard, tagged; paste event with that text pastes the shapes', () => {
    const r = makeRect(10, 20, 100, 50, st); editor.addShape(r); editor.selectOnly(r.id);
    const { e, data } = copyEvent();
    onCopyEvent(e, false);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(data['text/plain']).toMatch(/^<\?xml[^>]*>\n<!--svgeditor-clip:[a-z0-9]+-->\n<svg /);
    expect(data['text/plain']).toContain('viewBox="10 20 100 50"');
    expect(looksLikeSvg(data['text/plain'])).toBe(true);
    const p = pasteEvent(data['text/plain']);
    onPasteEvent(p);
    expect(p.preventDefault).toHaveBeenCalled();
    expect(shapes()).toHaveLength(2);
    expect(shapes()[1]).toMatchObject({ type: 'rectangle', x: 20, y: 30, fill: 'lg:0;#ff0000@0,#0000ff@100' });   // +10 offset, gradient kept
    expect(shapes()[1].id).not.toBe(r.id);
  });
  it('cut copies and deletes; empty selection does nothing and leaves the event alone', () => {
    const r = makeRect(0, 0, 10, 10, st); editor.addShape(r); editor.selectOnly(r.id);
    const { e, data } = copyEvent();
    onCopyEvent(e, true);
    expect(shapes()).toHaveLength(0);
    expect(data['text/plain']).toBeTruthy();
    const none = copyEvent(); onCopyEvent(none.e, false);
    expect(none.e.preventDefault).not.toHaveBeenCalled();
  });
  it('another tab: a newer entry in the shared storage is what paste uses (full fidelity, names kept)', () => {
    const mine = makeRect(0, 0, 10, 10, st); editor.addShape(mine); editor.selectOnly(mine.id); editor.copy();
    const theirs = { ...makeRect(300, 300, 20, 20, st), name: 'from tab B' };
    saveSharedClip([theirs]);                                  // the other tab copies later
    const stored = JSON.parse(localStorage.getItem('svgeditor.clipboard')!); stored.time += 1000; localStorage.setItem('svgeditor.clipboard', JSON.stringify(stored));
    editor.paste();
    expect(shapes().at(-1)).toMatchObject({ name: 'from tab B', x: 310, y: 310 });
  });
  it('the shared storage is validated: garbage is ignored', () => {
    localStorage.setItem('svgeditor.clipboard', '{"nonce":"a","time":1,"shapes":[{"type":"nope"},5,null]}');
    expect(loadSharedClip()).toBeNull();
    localStorage.setItem('svgeditor.clipboard', 'not json');
    expect(loadSharedClip()).toBeNull();
  });
  it('SVG from another program is imported; ordinary text is left alone; fields keep their own copy / paste', () => {
    expect(pasteClipboardText('hello world')).toBe(false);
    expect(shapes()).toHaveLength(0);
    expect(pasteClipboardText('<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"><circle cx="25" cy="25" r="10" fill="#00ff00"/></svg>')).toBe(true);
    expect(shapes()).toHaveLength(1);
    expect(shapes()[0]).toMatchObject({ type: 'ellipse', fill: '#00ff00' });
    const input = document.createElement('input'); document.body.append(input);
    const p = pasteEvent('<svg xmlns="http://www.w3.org/2000/svg" width="5" height="5"><rect width="5" height="5"/></svg>', input);
    onPasteEvent(p);
    expect(p.preventDefault).not.toHaveBeenCalled();
    expect(shapes()).toHaveLength(1);
    input.remove();
  });
  it('SVG far outside the page is brought into it', () => {
    pasteClipboardText('<svg xmlns="http://www.w3.org/2000/svg" width="5000" height="5000"><rect x="4000" y="4000" width="100" height="100"/></svg>');
    const r = shapes()[0] as any;
    expect(r.x).toBeCloseTo(350, 0); expect(r.y).toBeCloseTo(250, 0);
  });
  it('clipSvg is tagged with the stored entry and MARKER finds the nonce', () => {
    const r = makeRect(0, 0, 10, 10, st);
    const entry = saveSharedClip([r]);
    expect(MARKER.exec(clipSvg([r], entry.nonce))![1]).toBe(entry.nonce);
  });
});

describe('which clipboard source wins', () => {
  it('SVG text over a picture, a picture over the editor\'s own copy, ordinary text over nothing', async () => {
    const fa = await import('../../src/lib/utils/fileActions');
    const spy = vi.spyOn(fa, 'importFile').mockResolvedValue({ count: 1, warnings: [] });
    const { pasteContent } = await import('../../src/lib/utils/clipboardActions');
    const r = makeRect(0, 0, 10, 10, st); editor.addShape(r); editor.selectOnly(r.id); editor.copy();
    const png = new File([new Uint8Array([1])], 'image.png', { type: 'image/png' });
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="5" height="5"><circle cx="2" cy="2" r="2"/></svg>';

    expect(await pasteContent({ text: '', svg, image: png })).toBe(true);          // Inkscape: SVG + PNG → the SVG
    expect(shapes().at(-1)!.type).toBe('ellipse');
    expect(spy).not.toHaveBeenCalled();

    expect(await pasteContent({ text: '', svg: '', image: png }, { x: 50, y: 60 })).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].name).toBe('Pasted image.png');                    // not the browser's "image.png"
    expect(spy.mock.calls[0][1]).toEqual({ x: 50, y: 60 });
    expect(spy.mock.calls[0][2]).toBe('Paste image');

    const n = shapes().length;
    expect(await pasteContent({ text: 'hello', svg: '', image: null })).toBe(false);
    expect(shapes()).toHaveLength(n);
    expect(await pasteContent({ text: '', svg: '', image: null })).toBe(true);     // empty → the editor's own copy
    expect(shapes()).toHaveLength(n + 1);
    spy.mockRestore();
  });
});

describe('Paste here', () => {
  it('centres the pasted shapes on the point', async () => {
    const a = makeRect(0, 0, 40, 20, { ...st, strokeWidth: 0, stroke: 'none' });
    editor.addShape(a); editor.copy();
    await editor.pasteAt({ x: 300, y: 200 }, () => editor.paste());
    const s = shapes()[1] as any;
    expect(s.x + s.width / 2).toBeCloseTo(300);
    expect(s.y + s.height / 2).toBeCloseTo(200);
    editor.paste();                                                           // without the anchor: the usual offset
    expect((shapes()[2] as any).x).toBe(10);
  });
});
