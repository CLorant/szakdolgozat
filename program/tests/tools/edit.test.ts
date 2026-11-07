// Edit Nodes tool: nodes, handles, radius handles, several nodes at once.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { createTools } from '../../src/lib/tools';
import type { PointerInfo } from '../../src/lib/tools';
import { editor } from '../../src/lib/stores/editor';
import { documentStore, historyPast } from '../../src/lib/stores/document';
import { ui } from '../../src/lib/stores/ui';
import { tempShape, guides, activeNode, pickedNodes } from '../../src/lib/stores/interaction';
import { makeRect, makePath, getWorldBounds, getRotationOrigin, setTextContent, makeText, makeEllipse, moveAnchors, anchorPositions } from '../../src/lib/utils/shapes';
import { corner } from '../../src/lib/utils/path';
import { rotatePoint } from '../../src/lib/utils/math';
import { DEFAULT_TEXT_PROPS } from '../../src/lib/utils/text';
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

beforeEach(() => {
  Object.values(tools).forEach(t => t.deactivate());
  editor.newDocument();
  ui.set({ snapEnabled: false, polygonClosed: true, fill: '#336699', stroke: '#000000', strokeWidth: 2 });
  ctx.openText.mockClear();
});

const K = (key: string, shiftKey = false) => ({ key, shiftKey }) as KeyboardEvent;   // node environment: no DOM events
const square = () => makePath([corner(0, 0), corner(100, 0), corner(100, 100), corner(0, 100), corner(50, 150)], true, st);

describe('edit tool', () => {
  const t = tools.edit;
  it('dragging the radius handle of a rotated rect keeps it under the cursor', () => {
    const r = { ...makeRect(0, 0, 100, 50, st), rotation: 30 }; editor.addShape(r); editor.selectTool('edit');
    const to = rotatePoint({ x: 25, y: 0 }, getRotationOrigin(r), 30);
    t.down(I(0, 0, { target: tgt({ 'data-node': 'rx' }) })); t.move(I(to.x, to.y)); t.up(I(to.x, to.y));
    const n: any = shapes()[0];
    expect(n.rx).toBeCloseTo(25, 5);
    const w = rotatePoint({ x: n.x + n.rx, y: n.y }, getRotationOrigin(n), 30);
    expect(w.x).toBeCloseTo(to.x, 5); expect(w.y).toBeCloseTo(to.y, 5);
    expect(get(activeNode)).toBe('rx');
  });
  it('double-click on a path adds a node; on a node toggles smooth; Delete removes the node, not the shape', () => {
    const p = makePath([corner(0, 0), corner(100, 0), corner(100, 100)], false, st); editor.addShape(p); editor.selectTool('edit');
    t.dblclick!(I(50, 2, { target: tgt({ 'data-shape-id': p.id }) }));
    expect((shapes()[0] as any).nodes).toHaveLength(4);
    expect(get(activeNode)).toBe('a1');
    t.dblclick!(I(0, 0, { target: tgt({ 'data-node': 'a1' }) }));
    expect((shapes()[0] as any).nodes[1].smooth).toBe(true);
    expect(t.key!({ key: 'Delete', shiftKey: false, ctrlKey: false, metaKey: false })).toBe(true);
    expect(shapes()).toHaveLength(1); expect((shapes()[0] as any).nodes).toHaveLength(3);
    expect(t.key!({ key: 'Delete', shiftKey: false, ctrlKey: false, metaKey: false })).toBe(false);   // no active node → Canvas deletes shape
  });
  it('Esc cancels a node drag', () => {
    const p = makePath([corner(0, 0), corner(100, 0), corner(100, 100)], true, st); editor.addShape(p); editor.selectTool('edit');
    t.down(I(0, 0, { target: tgt({ 'data-node': 'a0' }) })); t.move(I(-50, -50));
    expect(t.escape()).toBe(true);
    expect((shapes()[0] as any).nodes[0]).toMatchObject({ x: 0, y: 0 });
  });
});

describe('Edit tool: several nodes', () => {
  beforeEach(() => { ui.set({ tool: 'edit', snapEnabled: false }); });
  const t = tools.edit;
  it('a rectangle from the empty canvas picks the anchors inside it; they move as ONE step', () => {
    const p = square(); editor.addShape(p);
    t.down(I(-10, -10)); t.move(I(60, 110)); t.up(I(60, 110));               // covers a0 (0,0) and a3 (0,100)
    expect(get(pickedNodes)).toEqual({ shapeId: p.id, ids: ['a0', 'a3'] });
    expect(ui.get().selectedIds).toEqual([p.id]);                              // the shape stays selected
    const n = hist();
    t.down(I(0, 0, { target: tgt({ 'data-node': 'a0' }) })); t.move(I(5, 10)); t.move(I(10, 20)); t.up(I(10, 20));
    expect(hist()).toBe(n + 1);
    const nodes = (shapes()[0] as PathShape).nodes;
    expect(nodes[0]).toMatchObject({ x: 10, y: 20 });
    expect(nodes[3]).toMatchObject({ x: 10, y: 120 });
    expect(nodes[1]).toMatchObject({ x: 100, y: 0 });                          // not picked: stays
  });
  it('Shift-click adds and removes; a plain click on empty canvas deselects; Delete removes all picked', () => {
    const p = square(); editor.addShape(p);
    t.down(I(0, 0, { target: tgt({ 'data-node': 'a1' }) })); t.up(I(0, 0));
    t.down(I(0, 0, { target: tgt({ 'data-node': 'a2' }), shift: true }));
    expect(get(pickedNodes)!.ids).toEqual(['a1', 'a2']);
    t.down(I(0, 0, { target: tgt({ 'data-node': 'a1' }), shift: true }));
    expect(get(pickedNodes)!.ids).toEqual(['a2']);
    t.down(I(0, 0, { target: tgt({ 'data-node': 'a1' }), shift: true }));
    expect(t.key!(K('Delete'))).toBe(true);
    expect((shapes()[0] as PathShape).nodes).toHaveLength(3);
    expect(get(pickedNodes)).toBeNull();
    t.down(I(500, 500)); t.up(I(500, 500));
    expect(ui.get().selectedIds).toEqual([]);
  });
  it('a closed contour keeps 3 nodes, arrow keys nudge the picked anchors', () => {
    const p = square(); editor.addShape(p);
    t.down(I(-10, -10)); t.move(I(200, 200)); t.up(I(200, 200));             // all 5
    t.key!(K('Delete'));
    expect((shapes()[0] as PathShape).nodes).toHaveLength(3);
    t.down(I(-10, -10)); t.move(I(200, 200)); t.up(I(200, 200));
    t.key!(K('ArrowRight', true));
    t.key!(K('ArrowRight', true));
    expect((shapes()[0] as PathShape).nodes[0].x).toBe(20);
  });
  it('moveAnchors keeps rotated shapes under the pointer', () => {
    const p = { ...square(), rotation: 30 };
    const before = anchorPositions(p).find(a => a.id === 'a0')!.p;
    const moved = moveAnchors(p, ['a0', 'a1'], { x: 7, y: -4 });
    const after = anchorPositions(moved).find(a => a.id === 'a0')!.p;
    expect(after.x).toBeCloseTo(before.x + 7, 6);
    expect(after.y).toBeCloseTo(before.y - 4, 6);
  });
  it('one node in the rectangle shows its handles; Esc drops the pick', () => {
    const p = square(); editor.addShape(p);
    t.down(I(90, -10)); t.move(I(110, 10)); t.up(I(110, 10));
    expect(get(activeNode)).toBe('a1');
    expect(t.escape()).toBe(true);
    expect(get(pickedNodes)).toBeNull();
  });
});
