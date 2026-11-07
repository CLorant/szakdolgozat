// Locked shapes.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { createTools } from '../../src/lib/tools';
import type { PointerInfo } from '../../src/lib/tools';
import { editor } from '../../src/lib/stores/editor';
import { documentStore, historyPast } from '../../src/lib/stores/document';
import { ui } from '../../src/lib/stores/ui';
import { pickedNodes, activeNode } from '../../src/lib/stores/interaction';
import { makeRect, makePath, makeEllipse, moveAnchors, anchorPositions } from '../../src/lib/utils/shapes';
import { corner } from '../../src/lib/utils/path';
import { normalizeShape } from '../../src/lib/utils/project';
import { mergeable } from '../../src/lib/utils/blob';
import type { PathShape } from '../../src/lib/utils/types';

const st = { fill: '#336699', stroke: '#000000', strokeWidth: 2 };
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

describe('Lock', () => {
  it('locked shapes leave the selection and are skipped by Select All, the band and the Blob merge', () => {
    const a = makeRect(0, 0, 10, 10, st), b = makeRect(20, 0, 10, 10, st);
    editor.addShapes([a, b]);
    editor.setLocked(a.id, true);
    expect(ui.get().selectedIds).toEqual([b.id]);
    editor.selectAll();
    expect(ui.get().selectedIds).toEqual([b.id]);
    editor.selectDeep(a.id);
    expect(ui.get().selectedIds).toEqual([b.id]);                             // the Objects panel cannot select it either
    expect(mergeable(shapes()[0], st as any)).toBe(false);
    tools.transform.down(I(-5, -5)); tools.transform.move(I(50, 50)); tools.transform.up(I(50, 50));
    expect(ui.get().selectedIds).toEqual([b.id]);
    editor.undo();
    expect(shapes()[0].locked).toBeUndefined();
  });
  it('lockSelected / hideSelected are one step each; Unlock All; the flag survives a project load', () => {
    const a = makeRect(0, 0, 10, 10, st), b = makeEllipse(5, 5, 5, 5, st);
    editor.addShapes([a, b]);
    const n = hist();
    editor.lockSelected();
    expect(hist()).toBe(n + 1);
    expect(shapes().every(s => s.locked)).toBe(true);
    expect(ui.get().selectedIds).toEqual([]);
    expect(editor.hasLocked()).toBe(true);
    editor.unlockAll();
    expect(editor.hasLocked()).toBe(false);
    editor.select([a.id]); editor.hideSelected();
    expect(shapes()[0].visible).toBe(false);
    expect(normalizeShape({ ...b, locked: true }, new Set())!.locked).toBe(true);
    expect('locked' in normalizeShape({ ...b }, new Set())!).toBe(false);
  });
  it('a shape inside a locked group cannot be selected from the Objects panel', () => {
    const a = makeRect(0, 0, 10, 10, st), b = makeRect(20, 0, 10, 10, st);
    editor.addShapes([a, b]); editor.group();
    const g = shapes()[0];
    editor.setLocked(g.id, true);
    editor.selectDeep(a.id);
    expect(ui.get().selectedIds).toEqual([]);
  });
});
