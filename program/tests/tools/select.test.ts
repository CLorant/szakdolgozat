// Select tool: select, move, resize, rotate, one shape and several.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { createTools } from '../../src/lib/tools';
import type { PointerInfo } from '../../src/lib/tools';
import { editor } from '../../src/lib/stores/editor';
import { documentStore, historyPast, emptyDocument } from '../../src/lib/stores/document';
import { ui } from '../../src/lib/stores/ui';
import { tempShape, guides, activeNode } from '../../src/lib/stores/interaction';
import { makeRect, makePath, getWorldBounds, getRotationOrigin, setTextContent, makeText, makeEllipse, resizeMany, rotateMany, unionBounds, getPivot, withOrigin } from '../../src/lib/utils/shapes';
import { corner } from '../../src/lib/utils/path';
import { rotatePoint } from '../../src/lib/utils/math';
import { DEFAULT_TEXT_PROPS } from '../../src/lib/utils/text';
import { sanitizeSettings, DEFAULT_SETTINGS, svgSettingsOf } from '../../src/lib/utils/exportSettings';
import { exportArea, contentBounds } from '../../src/lib/utils/exportArea';
import { exportSize, buildSvgFromSettings } from '../../src/lib/utils/exportDoc';
import { buildSvgDocument, backgroundColor } from '../../src/lib/utils/serializer';
import { embedFontCss } from '../../src/lib/fonts/embed';
import { serializeProject, parseProject } from '../../src/lib/utils/project';
import type { DocumentState } from '../../src/lib/utils/types';
import { net } from '../helpers/fakeGoogle';

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

const doc = (o: Partial<DocumentState> = {}): DocumentState => ({ ...emptyDocument(), ...o });
const T = (family: string, text: string, extra: Record<string, unknown> = {}) =>
  makeText(0, 50, text, { ...DEFAULT_TEXT_PROPS, fontFamily: family, fontSize: 40, ...extra } as any, { fill: '#000', stroke: 'none', strokeWidth: 0 });

describe('select tool', () => {
  const t = tools.transform;
  it('click selects without touching history; drag moves as ONE entry; Esc cancels', () => {
    const r = makeRect(0, 0, 100, 50, st); editor.addShape(r); editor.deselectAll();
    const n = hist();
    t.down(I(10, 10, { target: tgt({ 'data-shape-id': r.id }) })); t.up(I(10, 10));
    expect(ui.get().selectedIds).toEqual([r.id]); expect(hist()).toBe(n);

    t.down(I(10, 10, { target: tgt({ 'data-shape-id': r.id }) }));
    for (let k = 1; k <= 30; k++) t.move(I(10 + k, 10 + k * 2));
    t.up(I(40, 70));
    expect(hist()).toBe(n + 1);
    expect(shapes()[0]).toMatchObject({ x: 30, y: 60 });

    t.down(I(0, 0, { target: tgt({ 'data-shape-id': r.id }) })); t.move(I(50, 50));
    expect(t.escape()).toBe(true);
    expect(shapes()[0]).toMatchObject({ x: 30, y: 60 }); expect(hist()).toBe(n + 1);
  });
  it('shift constrains the move axis; snapping snaps the delta', () => {
    const r = makeRect(0, 0, 10, 10, st); editor.addShape(r);
    t.down(I(5, 5, { target: tgt({ 'data-shape-id': r.id }) })); t.move(I(25, 8, { shift: true })); t.up(I(25, 8));
    expect(shapes()[0]).toMatchObject({ x: 20, y: 0 });
    ui.set({ snapEnabled: true, gridSizeX: 20, gridSizeY: 20 });
    t.down(I(0, 0, { target: tgt({ 'data-shape-id': r.id }) })); t.move(I(3, 12)); t.up(I(3, 12));
    expect(shapes()[0]).toMatchObject({ x: 20, y: 20 });
  });
  it('rubber band selects intersecting shapes; shift adds; tiny band just deselects', () => {
    const a = makeRect(0, 0, 10, 10, st), b = makeRect(100, 100, 10, 10, st), c = makeRect(300, 300, 10, 10, st);
    editor.addShapes([a, b, c]);
    t.down(I(-5, -5)); t.move(I(120, 120)); expect(get(guides)).toHaveLength(1); t.up(I(120, 120));
    expect(ui.get().selectedIds.sort()).toEqual([a.id, b.id].sort()); expect(get(guides)).toHaveLength(0);
    t.down(I(295, 295, { shift: true })); t.move(I(320, 320, { shift: true })); t.up(I(320, 320, { shift: true }));
    expect(ui.get().selectedIds).toHaveLength(3);
    t.down(I(500, 500)); t.up(I(500, 500));
    expect(ui.get().selectedIds).toHaveLength(0);
  });
  it('resizes via handle keeping the opposite corner fixed, even when rotated', () => {
    const r = { ...makeRect(0, 0, 100, 50, st), rotation: 40 }; editor.addShape(r);
    const corner0 = rotatePoint({ x: 0, y: 0 }, getRotationOrigin(r), 40);
    t.down(I(0, 0, { target: tgt({ 'data-handle': 'se' }) }));
    t.move(I(200, 150)); t.up(I(200, 150));
    const n: any = shapes()[0];
    const after = rotatePoint({ x: n.x, y: n.y }, getRotationOrigin(n), 40);
    expect(after.x).toBeCloseTo(corner0.x, 5); expect(after.y).toBeCloseTo(corner0.y, 5);
    expect(hist()).toBe(2);
  });
  it('rotates via the knob; shift snaps to 15°; Esc cancels', () => {
    const r = makeRect(0, 0, 100, 100, st); editor.addShape(r);
    t.down(I(50, -30, { target: tgt({ 'data-rotate': '' }) }));     // straight above the centre
    t.move(I(130, 50, { shift: true })); t.up(I(130, 50));            // 90° clockwise
    expect(shapes()[0].rotation).toBeCloseTo(90, 5);
    t.down(I(50, -30, { target: tgt({ 'data-rotate': '' }) })); t.move(I(130, 50)); t.escape();
    expect(shapes()[0].rotation).toBeCloseTo(90, 5);
  });
  it('double-click: text opens the editor, other shapes switch to the edit tool', () => {
    const r = makeRect(0, 0, 10, 10, st), tx = makeText(0, 20, 'hi', DEFAULT_TEXT_PROPS, st);
    editor.addShapes([r, tx]);
    t.dblclick!(I(1, 1, { target: tgt({ 'data-shape-id': tx.id }) }));
    expect(ctx.openText).toHaveBeenCalledWith(expect.objectContaining({ id: tx.id }), false);
    t.dblclick!(I(1, 1, { target: tgt({ 'data-shape-id': r.id }) }));
    expect(ui.get().tool).toBe('edit');
  });
});

describe('multi-selection transforms', () => {
  const a = makeRect(0, 0, 100, 50, st), b = makeRect(200, 100, 100, 100, st);
  const box = (list: any[]) => unionBounds(list.map(getWorldBounds))!;

  it('resizeMany scales the common box; the opposite corner stays; shift keeps the aspect', () => {
    const out = resizeMany([a, b], 'se', { x: 600, y: 400 });                 // box 0,0–300,200 → 600,400 (×2)
    expect(box(out)).toMatchObject({ x: 0, y: 0, width: 600, height: 400 });
    expect(getWorldBounds(out[1])).toMatchObject({ x: 400, y: 200, width: 200, height: 200 });
    const k = resizeMany([a, b], 'se', { x: 600, y: 300 }, true);              // dominant axis wins, aspect stays 3:2
    expect(box(k).width / box(k).height).toBeCloseTo(1.5, 5);
    const w = resizeMany([a, b], 'nw', { x: 100, y: 50 });                     // anchor is the se corner
    expect(box(w).x).toBeCloseTo(100, 6); expect(box(w).y).toBeCloseTo(50, 6);
    expect(box(w).width).toBeCloseTo(200, 6); expect(box(w).height).toBeCloseTo(150, 6);
  });
  it('rotateMany turns every shape about the common pivot', () => {
    const out = rotateMany([a, b], { x: 150, y: 100 }, 180);
    expect(out.map(s => Math.round(s.rotation))).toEqual([180, 180]);
    expect(getWorldBounds(out[0]).x).toBeCloseTo(200, 5);                     // a and b swap places
    expect(getWorldBounds(out[1]).x).toBeCloseTo(0, 5);
  });
});

describe('select tool with several shapes', () => {
  const ctx = { zoom: () => 1, openText: vi.fn() };
  const t = createTools(ctx).transform;
  const tgt = (attrs: Record<string, string>) => ({ closest: (sel: string) => { const k = /^\[(.+)\]$/.exec(sel)![1]; return k in attrs ? { getAttribute: () => attrs[k] } : null; } }) as unknown as Element;
  const I = (x: number, y: number, o: Partial<PointerInfo> = {}): PointerInfo => ({ p: { x, y }, raw: { x, y }, shift: false, alt: false, ctrl: false, target: null, ...o });
  beforeEach(() => { t.deactivate(); editor.newDocument(); ui.set({ snapEnabled: false }); });

  it('dragging a handle resizes ALL selected shapes as one undo step', () => {
    editor.addShapes([makeRect(0, 0, 100, 50, st), makeRect(200, 100, 100, 100, st)]);
    t.down(I(300, 200, { target: tgt({ 'data-handle': 'se' }) })); t.move(I(600, 400)); t.up(I(600, 400));
    const [a, b] = documentStore.get().shapes.map(getWorldBounds);
    expect(a).toMatchObject({ x: 0, y: 0, width: 200, height: 100 });
    expect(b).toMatchObject({ x: 400, y: 200, width: 200, height: 200 });
    editor.undo();
    expect(getWorldBounds(documentStore.get().shapes[1])).toMatchObject({ width: 100 });
  });
  it('dragging the knob rotates them about the centre of the common box; shift snaps to 15°', () => {
    editor.addShapes([makeRect(0, 0, 100, 50, st), makeRect(200, 100, 100, 100, st)]);
    // pivot (150,100); knob straight above → pointer to the right of the pivot = +90°
    t.down(I(150, 0, { target: tgt({ 'data-rotate': '' }) })); t.move(I(250, 100)); t.up(I(250, 100));
    expect(documentStore.get().shapes.map(s => Math.round(s.rotation))).toEqual([90, 90]);
    editor.undo();
    t.down(I(150, 0, { target: tgt({ 'data-rotate': '' }) })); t.move(I(250, 80, { shift: true })); t.up(I(250, 80));
    expect(documentStore.get().shapes.map(s => s.rotation % 15)).toEqual([0, 0]);
  });
});

describe('rotation origin', () => {
  const t = tools.transform;
  it('the crosshair drags (snapping to the corners) without moving the shape; the knob then turns about it', () => {
    const r = makeRect(0, 0, 100, 50, st); editor.addShape(r); editor.selectOnly(r.id);
    t.down(I(50, 25, { target: tgt({ 'data-pivot': '' }) })); t.move(I(30, 10)); t.move(I(97, 48)); t.up(I(97, 48));
    expect(shapes()[0].origin).toEqual({ x: 1, y: 1 });                             // snapped to the bottom-right corner
    expect(shapes()[0]).toMatchObject({ x: 0, y: 0 });
    const knob = { x: 50, y: -26 };
    t.down(I(knob.x, knob.y, { target: tgt({ 'data-rotate': '' }) }));
    const p = rotatePoint(knob, { x: 100, y: 50 }, 90); t.move(I(p.x, p.y)); t.up(I(p.x, p.y));
    const s = shapes()[0];
    expect(s.rotation).toBeCloseTo(90, 0);
    const pv = getPivot(s);
    expect(pv.x).toBeCloseTo(100); expect(pv.y).toBeCloseTo(50);
  });
  it('double-clicking the crosshair centres it again; the origin is saved in the project', async () => {
    const { serializeProject, parseProject } = await import('../../src/lib/utils/project');
    const r = withOrigin(makeRect(0, 0, 100, 50, st), { x: 0.25, y: 1 }); editor.addShape(r); editor.selectOnly(r.id);
    expect(parseProject(serializeProject(documentStore.get())).shapes[0].origin).toEqual({ x: 0.25, y: 1 });
    t.dblclick!(I(25, 50, { target: tgt({ 'data-pivot': '' }) }));
    expect(shapes()[0].origin).toBeUndefined();
  });
});
