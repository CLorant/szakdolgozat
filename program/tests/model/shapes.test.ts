// Shape geometry: resize, mirror, bounds, size and text anchors on rotated shapes.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { rotatePoint } from '../../src/lib/utils/math';
import { corner } from '../../src/lib/utils/path';
import type { RectShape } from '../../src/lib/utils/types';
import { niceStep, rulerTicks } from '../../src/lib/utils/ruler';
import { anchoredScroll } from '../../src/lib/utils/zoom';
import { makeRect, makeText, setShapeSize, getLocalBounds, getRotationOrigin, makePath, getWorldBounds, setTextContent } from '../../src/lib/utils/shapes';
import { DEFAULT_TEXT_PROPS } from '../../src/lib/utils/text';
import { notify, toasts, dismiss } from '../../src/lib/stores/notify';
import { get } from 'svelte/store';
import { createTools } from '../../src/lib/tools';
import type { PointerInfo } from '../../src/lib/tools';
import { editor } from '../../src/lib/stores/editor';
import { documentStore, historyPast } from '../../src/lib/stores/document';
import { ui } from '../../src/lib/stores/ui';
import { tempShape, guides, activeNode } from '../../src/lib/stores/interaction';
import { makeLine, makeEllipse, resizeShape, moveEditNode, getEditNodes, mirrorShape, toPathShape, translateShape, centerOf } from '../../src/lib/utils/shapes';

const st = { fill: '#fff', stroke: '#000', strokeWidth: 1 };
const worldPt = (s: RectShape, p: { x: number; y: number }) => rotatePoint(p, getRotationOrigin(s), s.rotation);

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

describe('shapes', () => {
  it('resize keeps the opposite corner fixed on a rotated rect', () => {
    const r = { ...makeRect(10, 20, 100, 50, st), rotation: 30 };
    const before = worldPt(r, { x: r.x, y: r.y });
    const target = worldPt(r, { x: r.x + 160, y: r.y + 90 });
    const n = resizeShape(r, 'se', target) as RectShape;
    const after = worldPt(n, { x: n.x, y: n.y });
    expect(after.x).toBeCloseTo(before.x, 6); expect(after.y).toBeCloseTo(before.y, 6);
    const se = worldPt(n, { x: n.x + n.width, y: n.y + n.height });
    expect(se.x).toBeCloseTo(target.x, 6); expect(se.y).toBeCloseTo(target.y, 6);
  });
  it('resizing a line keeps its orientation', () => {
    const l = makeLine({ x: 0, y: 100 }, { x: 100, y: 0 }, st);
    const n = resizeShape(l, 'se', { x: 200, y: 200 });
    if (n.type !== 'line') throw 0;
    expect(n.y1).toBeGreaterThan(n.y2);       // still rising to the right
  });
  it('radius handle follows the cursor on a rotated rect', () => {
    const r = { ...makeRect(0, 0, 100, 50, st), rotation: 45 };
    const target = worldPt(r, { x: 20, y: 0 });
    const n = moveEditNode(r, 'rx', target) as RectShape;
    expect(n.rx).toBeCloseTo(20, 6);
    const w = worldPt(n, { x: n.x + n.rx, y: n.y });
    expect(w.x).toBeCloseTo(target.x, 6); expect(w.y).toBeCloseTo(target.y, 6);
  });
  it('a rectangle has two radius handles (rx, ry) and no resizing nodes', () => {
    const r = makeRect(0, 0, 100, 50, st);
    expect(getEditNodes(r).map(n => n.id)).toEqual(['rx', 'ry']);
    const a = moveEditNode(r, 'rx', { x: 30, y: 0 }) as RectShape;
    expect([a.rx, a.ry]).toEqual([30, 25]);                  // a sharp rectangle rounds uniformly first (ry capped at half the height)
    const b = moveEditNode(a, 'ry', { x: 0, y: 10 }) as RectShape;
    expect([b.rx, b.ry]).toEqual([30, 10]);                  // then the axes are independent
    const c = moveEditNode(b, 'ry', { x: 0, y: 0 }) as RectShape;
    expect([c.rx, c.ry]).toEqual([0, 0]);                    // one radius 0 = square corners (that is what SVG draws)
    expect((moveEditNode(r, 'rx', { x: 999, y: 0 }) as RectShape).rx).toBe(50);   // limited to half the width
  });
  it('mirror negates rotation and keeps the centre', () => {
    const r = { ...makeRect(0, 0, 100, 50, st), rotation: 30 };
    const m = mirrorShape(r, 'h');
    expect(m.rotation).toBeCloseTo(330);
    expect(centerOf(getLocalBounds(m))).toEqual(centerOf(getLocalBounds(r)));
  });
  it('mirror of a path really mirrors', () => {
    const p = makePath([corner(0, 0), corner(10, 0), corner(10, 10)], true, st);
    const m = mirrorShape(p, 'h');
    if (m.type !== 'path') throw 0;
    expect(m.nodes[0].x).toBe(10); expect(m.nodes[1].x).toBe(0);
  });
  it('rounded rect / ellipse → path keep their bounds', () => {
    const r = { ...makeRect(5, 5, 100, 60, st), rx: 10, ry: 10 };
    const p = toPathShape(r)!;
    const b = getLocalBounds(p);
    expect(b.x).toBeCloseTo(5, 5); expect(b.width).toBeCloseTo(100, 5); expect(b.height).toBeCloseTo(60, 5);
    const e = toPathShape(makeEllipse(50, 50, 30, 20, st))!;
    const eb = getLocalBounds(e);
    expect(eb.width).toBeCloseTo(60, 1); expect(eb.height).toBeCloseTo(40, 1);
  });
  it('world bounds account for rotation', () => {
    const r = { ...makeRect(0, 0, 100, 0.0001, st), rotation: 90 };
    const w = getWorldBounds(r);
    expect(w.height).toBeCloseTo(100, 3);
  });
  it('translate is pure', () => {
    const r = makeRect(0, 0, 1, 1, st);
    const t = translateShape(r, 5, 5);
    expect(r.x).toBe(0); expect(t.x).toBe(5);
  });
});

describe('setShapeSize', () => {
  it('resizes a rotated rect around its top-left corner', () => {
    const r = { ...makeRect(10, 20, 100, 50, st), rotation: 25 };
    const tl = rotatePoint({ x: 10, y: 20 }, getRotationOrigin(r), 25);
    const n = setShapeSize(r, 200, null);
    expect(getLocalBounds(n).width).toBeCloseTo(200, 6);
    expect(getLocalBounds(n).height).toBeCloseTo(50, 6);
    const tl2 = rotatePoint({ x: getLocalBounds(n).x, y: getLocalBounds(n).y }, getRotationOrigin(n), 25);
    expect(tl2.x).toBeCloseTo(tl.x, 6); expect(tl2.y).toBeCloseTo(tl.y, 6);
  });
  it('text: height drives the font size', () => {
    const t = makeText(0, 20, 'Hi', DEFAULT_TEXT_PROPS, st);
    const n = setShapeSize(t, null, getLocalBounds(t).height * 2);
    if (n.type !== 'text') throw 0;
    expect(n.fontSize).toBeCloseTo(32, 0);
  });
});

describe('text content on rotated shapes', () => {
  it('keeps the anchor fixed on screen', () => {
    const s = { ...makeText(100, 100, 'Hi', DEFAULT_TEXT_PROPS, st), rotation: 33 };
    const before = rotatePoint({ x: s.x, y: s.y }, getRotationOrigin(s), 33);
    const n = setTextContent(s, 'a much longer line of text');
    const after = rotatePoint({ x: n.x, y: n.y }, getRotationOrigin(n), 33);
    expect(after.x).toBeCloseTo(before.x, 6); expect(after.y).toBeCloseTo(before.y, 6);
    expect(getWorldBounds(n).width).toBeGreaterThan(0);
  });
});
