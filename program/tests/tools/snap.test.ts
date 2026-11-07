// @vitest-environment jsdom
// Snapping and ruler guides.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { createTools } from '../../src/lib/tools';
import type { PointerInfo } from '../../src/lib/tools';
import { editor } from '../../src/lib/stores/editor';
import { documentStore, historyPast } from '../../src/lib/stores/document';
import { ui } from '../../src/lib/stores/ui';
import { snapGuides } from '../../src/lib/stores/interaction';
import { makeRect } from '../../src/lib/utils/shapes';
import { collectTargets, snapAxis, snapBox, snapPointTo } from '../../src/lib/utils/snap';
import { parseProject, serializeProject } from '../../src/lib/utils/project';

const st = { fill: '#336699', stroke: 'none', strokeWidth: 0 };
const ctx = { zoom: () => 1, openText: vi.fn() };
const tools = createTools(ctx);
const tgt = (id: string) => ({ closest: (sel: string) => sel === '[data-shape-id]' ? { getAttribute: () => id } : null }) as unknown as Element;
const I = (x: number, y: number, o: Partial<PointerInfo> = {}): PointerInfo =>
  ({ p: { x, y }, raw: { x, y }, shift: false, alt: false, ctrl: false, target: null, ...o });
const shapes = () => documentStore.get().shapes;

beforeEach(() => {
  Object.values(tools).forEach(t => t.deactivate());
  editor.newDocument(800, 600);
  ui.set({ snapEnabled: false, snapObjects: true, guidesVisible: true, tool: 'transform' });
});

describe('snap math', () => {
  const t = collectTargets([makeRect(100, 100, 50, 40, st)], new Set(), { canvas: { width: 800, height: 600 } });
  it('targets: edges and centers of shapes and canvas', () => {
    expect(t.x.map(x => x.v).sort((a, b) => a - b)).toEqual([0, 100, 125, 150, 400, 800]);
    expect(t.y.map(y => y.v).sort((a, b) => a - b)).toEqual([0, 100, 120, 140, 300, 600]);
  });
  it('picks the nearest target within the threshold, else nothing', () => {
    expect(snapAxis([97], t.x, 6)).toMatchObject({ v: 100, delta: 3 });
    expect(snapAxis([112], t.x, 6)).toBeNull();
    expect(snapAxis([97, 149], t.x, 6)).toMatchObject({ v: 150, delta: 1 });             // 149 is nearer to 150 than 97 to 100
  });
  it('a moved box snaps by edge OR center, per axis, and reports guide lines', () => {
    const r = snapBox({ x: 203, y: 55, width: 40, height: 20 }, t, 6);                   // left 203 → no; center 223 → no; right 243 → no
    expect(r).toMatchObject({ dx: 0, snappedX: false });
    const r2 = snapBox({ x: 106, y: 300, width: 30, height: 30 }, t, 6);                 // center x 121 → 125 … left 106 → 100 is nearer (6)
    expect(r2.snappedX).toBe(true);
    expect(Math.abs(r2.dx)).toBeLessThanOrEqual(6);
    expect(r2.guides.length).toBeGreaterThan(0);
  });
  it('a drawn point snaps both axes independently', () => {
    const r = snapPointTo({ x: 98, y: 300.5 }, t, 6);
    expect(r.p).toEqual({ x: 100, y: 300 });
  });
});

describe('select tool snapping', () => {
  const t = tools.transform;
  it('dragging next to another shape snaps its edge to it and shows the guide; releasing clears it', () => {
    const a = makeRect(100, 100, 100, 100, st), b = makeRect(300, 150, 50, 50, st);
    editor.addShapes([a, b]); editor.selectOnly(b.id);
    t.down(I(310, 160, { target: tgt(b.id) }));
    t.move(I(310 - 97, 160));                      // b.x would be 203 → its left edge snaps to a's right edge (200)
    expect(get(snapGuides).length).toBeGreaterThan(0);
    t.up(I(213, 160));
    expect(shapes().find(s => s.id === b.id)).toMatchObject({ x: 200, y: 150 });
    expect(get(snapGuides)).toEqual([]);
  });
  it('Ctrl switches snapping off for the drag; so does the setting', () => {
    const a = makeRect(100, 100, 100, 100, st), b = makeRect(300, 150, 50, 50, st);
    editor.addShapes([a, b]); editor.selectOnly(b.id);
    t.down(I(310, 160, { target: tgt(b.id) })); t.move(I(213, 160, { ctrl: true })); t.up(I(213, 160, { ctrl: true }));
    expect(shapes().find(s => s.id === b.id)).toMatchObject({ x: 203 });
    ui.set({ snapObjects: false });
    t.down(I(213, 160, { target: tgt(b.id) })); t.move(I(211, 160)); t.up(I(211, 160));      // 203 → 201: near 200, but snapping is off
    expect(shapes().find(s => s.id === b.id)).toMatchObject({ x: 201 });
  });
  it('moving onto a ruler guide snaps; the moved shape itself is never a target', () => {
    const b = makeRect(300, 150, 50, 50, st);
    editor.addShape(b); editor.addGuide('x', 500);
    editor.selectOnly(b.id);
    t.down(I(310, 160, { target: tgt(b.id) })); t.move(I(310 + 148, 160)); t.up(I(458, 160));   // right edge 498 → guide at 500
    expect(shapes()[0]).toMatchObject({ x: 450 });
  });
  it('resizing an edge snaps to another shape (unrotated)', () => {
    const a = makeRect(100, 100, 100, 100, st), b = makeRect(300, 100, 50, 50, st);
    editor.addShapes([a, b]); editor.selectOnly(b.id);
    const h = { closest: (sel: string) => sel === '[data-handle]' ? { getAttribute: () => 'w' } : null } as unknown as Element;
    t.down(I(300, 125, { target: h })); t.move(I(203, 125)); t.up(I(203, 125));          // west edge 203 → 200
    expect(shapes().find(s => s.id === b.id)).toMatchObject({ x: 200, width: 150 });
  });
});

describe('ruler guides', () => {
  it('add / move / remove / clear are undoable entries; they are saved in the project but never exported', async () => {
    const n = get(historyPast).length;
    editor.addGuide('x', 120.456); editor.addGuide('y', 80);
    expect(documentStore.get().guides).toEqual([{ axis: 'x', pos: 120.46 }, { axis: 'y', pos: 80 }]);
    editor.moveGuide(1, 90); expect(documentStore.get().guides![1].pos).toBe(90);
    editor.removeGuide(0); expect(documentStore.get().guides).toEqual([{ axis: 'y', pos: 90 }]);
    expect(get(historyPast).length).toBe(n + 4);
    const back = parseProject(serializeProject(documentStore.get()));
    expect(back.guides).toEqual([{ axis: 'y', pos: 90 }]);
    const { buildSvgDocument } = await import('../../src/lib/utils/serializer');
    expect(buildSvgDocument(documentStore.get())).not.toMatch(/guide|90/);
    editor.clearGuides(); expect(documentStore.get().guides).toBeUndefined();
    editor.undo(); expect(documentStore.get().guides).toHaveLength(1);
  });
  it('a project with broken guides loads without them', () => {
    const text = serializeProject({ ...documentStore.get(), guides: [{ axis: 'x', pos: 5 }, { axis: 'z', pos: 1 } as any, { axis: 'y', pos: NaN } as any] });
    expect(parseProject(text).guides).toEqual([{ axis: 'x', pos: 5 }]);
  });
});
