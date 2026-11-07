// @vitest-environment jsdom
// Groups: grouping, editing inside, conversion, files, drag and drop in the Objects panel.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import { get } from 'svelte/store';
import Canvas from '../../src/lib/layouts/Canvas.svelte';
import { createTools } from '../../src/lib/tools';
import type { PointerInfo } from '../../src/lib/tools';
import { editor } from '../../src/lib/stores/editor';
import { documentStore, historyPast } from '../../src/lib/stores/document';
import { ui } from '../../src/lib/stores/ui';
import { viewport } from '../../src/lib/stores/viewport';
import {
  makeRect, makeEllipse, makeText, makeGroup, getWorldBounds, ungroupShape, getRotationOrigin, getLocalBounds, centerOf,
} from '../../src/lib/utils/shapes';
import { findShape, leaves, pathTo, maxDepth, resolveHit, MAX_GROUP_DEPTH } from '../../src/lib/utils/tree';
import { buildSvgDocument } from '../../src/lib/utils/serializer';
import { importSvg } from '../../src/lib/utils/svgImport';
import { serializeProject, parseProject } from '../../src/lib/utils/project';
import { exportSize, buildSvgFile, MAX_RASTER_SIDE } from '../../src/lib/utils/exportDoc';
import { DEFAULT_TEXT_PROPS } from '../../src/lib/utils/text';
import { rotatePoint } from '../../src/lib/utils/math';
import type { Shape, GroupShape } from '../../src/lib/utils/types';

const st = { fill: '#336699', stroke: '#000000', strokeWidth: 2 };
const shapes = () => documentStore.get().shapes;
const hist = () => get(historyPast).length;
const grp = (s: Shape) => s as GroupShape;

beforeEach(() => { editor.newDocument(800, 600); ui.set({ tool: 'transform', snapEnabled: false }); });

function twoRects() {
  const a = makeRect(0, 0, 100, 50, st), b = makeRect(200, 100, 40, 40, st);
  editor.addShapes([a, b]);
  return [a, b];
}

describe('group / ungroup', () => {
  it('groups the selection at the top-most slot as ONE history entry and selects the group', () => {
    const c = makeEllipse(5, 5, 5, 5, st);
    const [a, b] = twoRects(); editor.addShape(c);
    editor.select([a.id, b.id]);
    const n = hist();
    editor.group();
    expect(hist()).toBe(n + 1);
    expect(shapes().map(s => s.type)).toEqual(['group', 'ellipse']);
    expect(grp(shapes()[0]).children.map(s => s.id)).toEqual([a.id, b.id]);
    expect(ui.get().selectedIds).toEqual([shapes()[0].id]);
    editor.undo();
    expect(shapes().map(s => s.id)).toEqual([a.id, b.id, c.id]);
  });
  it('needs at least two shapes', () => {
    const [a] = twoRects(); editor.select([a.id]);
    const n = hist(); editor.group(); expect(hist()).toBe(n);
  });
  it('ungroup keeps the picture: rotation, opacity and visibility are baked into the children', () => {
    const [a, b] = twoRects();
    editor.select([a.id, b.id]); editor.group();
    const g = shapes()[0].id;
    editor.updateShape(g, { rotation: 37, opacity: 0.5 });
    const o = getRotationOrigin(shapes()[0]);
    const centres = grp(shapes()[0]).children.map(c => rotatePoint(centerOf(getLocalBounds(c)), o, 37));
    editor.select([g]); editor.ungroup();
    expect(shapes()).toHaveLength(2);
    expect(shapes().every(s => s.type === 'rectangle' && s.opacity === 0.5 && s.rotation === 37)).toBe(true);
    shapes().forEach((s, i) => {                                   // every child sits exactly where the rotated group drew it
      const c = centerOf(getLocalBounds(s));
      expect(c.x).toBeCloseTo(centres[i].x, 6); expect(c.y).toBeCloseTo(centres[i].y, 6);
    });
    expect(ui.get().selectedIds.sort()).toEqual([a.id, b.id].sort());
  });
  it('deleting the last child removes the group; the entered path is repaired', () => {
    const [a, b] = twoRects(); editor.select([a.id, b.id]); editor.group();
    const g = shapes()[0].id;
    editor.enterGroup(g, a.id);
    expect(ui.get().groupPath).toEqual([g]);
    editor.deleteShapes([a.id]); expect(shapes()).toHaveLength(1);
    editor.deleteShapes([b.id]); expect(shapes()).toHaveLength(0);
    expect(ui.get().groupPath).toEqual([]); expect(ui.get().selectedIds).toEqual([]);
  });
  it('refuses to nest deeper than MAX_GROUP_DEPTH', () => {
    let s: Shape = makeRect(0, 0, 5, 5, st);
    for (let i = 0; i < MAX_GROUP_DEPTH - 2; i++) s = makeGroup([s]);
    const other = makeRect(9, 9, 5, 5, st);
    editor.addShapes([s, other]); editor.select([s.id, other.id]);
    const n = hist(); editor.group(); editor.select([shapes()[0].id, shapes()[1]?.id].filter(Boolean) as string[]);
    expect(maxDepth(shapes())).toBeLessThanOrEqual(MAX_GROUP_DEPTH);
    expect(hist()).toBeGreaterThanOrEqual(n);
  });
});

describe('group editing semantics', () => {
  it('style changes go to every descendant, opacity to the group itself', () => {
    const [a, b] = twoRects(); editor.select([a.id, b.id]); editor.group();
    editor.setStyle({ fill: '#ff0000' });
    expect(leaves(shapes()).every(s => s.fill === '#ff0000')).toBe(true);
    editor.setStyle({ opacity: 0.4 });
    expect(shapes()[0].opacity).toBe(0.4);
    expect(leaves(shapes()).every(s => s.opacity === 1)).toBe(true);
  });
  it('text properties reach text inside a group', () => {
    const t = makeText(0, 20, 'hi', DEFAULT_TEXT_PROPS, st), r = makeRect(0, 0, 5, 5, st);
    editor.addShapes([t, r]); editor.select([t.id, r.id]); editor.group();
    editor.setTextProp('fontSize', 40);
    expect((leaves(shapes()).find(s => s.type === 'text') as any).fontSize).toBe(40);
  });
  it('duplicate / paste give every descendant a fresh id', () => {
    const [a, b] = twoRects(); editor.select([a.id, b.id]); editor.group();
    editor.duplicate();
    const ids = [...leaves(shapes()), ...shapes()].map(s => s.id);
    expect(shapes()).toHaveLength(2);
    expect(new Set(ids).size).toBe(ids.length);
    expect(leaves(shapes())).toHaveLength(4);
  });
  it('z-order moves only within the shape’s own group', () => {
    const [a, b] = twoRects(); const c = makeEllipse(1, 1, 1, 1, st); editor.addShape(c);
    editor.select([a.id, b.id]); editor.group();
    const g = shapes().find(s => s.type === 'group')!.id;
    editor.moveUp([a.id]);
    expect(grp(findShape(shapes(), g)!).children.map(s => s.id)).toEqual([b.id, a.id]);
    expect(shapes().map(s => s.id)).toEqual([g, c.id]);
  });
  it('selectDeep enters the groups; undo that removes the group leaves them', () => {
    const [a, b] = twoRects(); editor.select([a.id, b.id]); editor.group();
    editor.selectDeep(a.id);
    expect(ui.get().groupPath).toEqual([shapes()[0].id]); expect(ui.get().selectedIds).toEqual([a.id]);
    editor.undo();                                            // group is gone, the rectangle is top-level again
    expect(ui.get().groupPath).toEqual([]);
    expect(ui.get().selectedIds).toEqual([a.id]);
  });
  it('flip / align / nudge work inside an entered group', () => {
    const [a, b] = twoRects(); editor.select([a.id, b.id]); editor.group();
    editor.enterGroup(shapes()[0].id); editor.select([a.id, b.id]);
    editor.align('left');
    expect(leaves(shapes()).map(s => (s as any).x)).toEqual([0, 0]);
    editor.nudge(5, 0);
    expect(leaves(shapes()).map(s => (s as any).x)).toEqual([5, 5]);
  });
  it('resolveHit: selects the top group; inside an entered group the child; outside leaves it', () => {
    const [a, b] = twoRects(); editor.select([a.id, b.id]); editor.group();
    const g = shapes()[0].id, o = makeRect(500, 500, 5, 5, st); editor.addShape(o);
    expect(resolveHit(shapes(), [], a.id)).toEqual({ id: g, groupPath: [] });
    expect(resolveHit(shapes(), [g], a.id)).toEqual({ id: a.id, groupPath: [g] });
    expect(resolveHit(shapes(), [g], o.id)).toEqual({ id: o.id, groupPath: [] });
    expect(pathTo(shapes(), a.id)).toEqual([g, a.id]);
  });
});

describe('select tool with groups', () => {
  const ctx = { zoom: () => 1, openText: vi.fn() };
  const tools = createTools(ctx);
  const tgt = (id: string) => ({ closest: (sel: string) => sel === '[data-shape-id]' ? { getAttribute: () => id } : null }) as unknown as Element;
  const I = (x: number, y: number, target: Element | null = null): PointerInfo =>
    ({ p: { x, y }, raw: { x, y }, shift: false, alt: false, ctrl: false, target });

  it('click selects the group, double-click enters it and selects the clicked child, click outside leaves', () => {
    const [a, b] = twoRects(); editor.select([a.id, b.id]); editor.group();
    const g = shapes()[0].id, o = makeRect(500, 500, 5, 5, st); editor.addShape(o); editor.deselectAll();
    const t = tools.transform;
    t.down(I(10, 10, tgt(a.id))); t.up(I(10, 10));
    expect(ui.get().selectedIds).toEqual([g]);
    t.dblclick!(I(10, 10, tgt(a.id)));
    expect(ui.get()).toMatchObject({ groupPath: [g], selectedIds: [a.id] });
    t.down(I(210, 110, tgt(b.id))); t.up(I(210, 110));
    expect(ui.get()).toMatchObject({ groupPath: [g], selectedIds: [b.id] });
    t.down(I(500, 500, tgt(o.id))); t.up(I(500, 500));
    expect(ui.get()).toMatchObject({ groupPath: [], selectedIds: [o.id] });
  });
  it('dragging a group moves every child in ONE history entry', () => {
    const [a, b] = twoRects(); editor.select([a.id, b.id]); editor.group(); editor.deselectAll();
    const n = hist(), t = tools.transform;
    t.down(I(10, 10, tgt(a.id))); t.move(I(40, 30)); t.up(I(40, 30));
    expect(hist()).toBe(n + 1);
    expect(leaves(shapes()).map(s => [(s as any).x, (s as any).y])).toEqual([[30, 20], [230, 120]]);
  });
});

describe('convert to path', () => {
  it('converts rectangles and text (inside groups too) as ONE undo step; the group stays a group', async () => {
    const t = makeText(10, 50, 'Ag', { ...DEFAULT_TEXT_PROPS, fontFamily: 'Roboto', fontSize: 40 }, st);
    const r = makeRect(0, 0, 20, 20, st);
    editor.addShapes([t, r]); editor.select([t.id, r.id]); editor.group();
    const n = hist();
    await editor.convertToPath();
    expect(hist()).toBe(n + 1);
    expect(shapes()[0].type).toBe('group');
    expect(leaves(shapes()).map(s => s.type)).toEqual(['path', 'path']);
    editor.undo();
    expect(leaves(shapes()).map(s => s.type)).toEqual(['text', 'rectangle']);
  });
  it('plain text becomes one compound path with the same id', async () => {
    const t = makeText(10, 50, 'AB', { ...DEFAULT_TEXT_PROPS, fontFamily: 'Roboto', fontSize: 40 }, st);
    editor.addShape(t);
    await editor.convertToPath();
    const p: any = shapes()[0];
    expect(p.id).toBe(t.id); expect(p.type).toBe('path'); expect(p.closed).toBe(true);
    expect(p.nodes.some((n: any) => n.sub)).toBe(true);      // two glyphs → two+ contours
  });
});

describe('SVG, project, export', () => {
  const make = () => {
    const a = makeRect(0, 0, 100, 50, st), b = makeEllipse(200, 100, 20, 20, st);
    const g = { ...makeGroup([a, b], 'pair'), rotation: 30, opacity: 0.6 };
    return [g, makeRect(300, 300, 5, 5, st)];
  };
  it('serializer writes nested <g> with opacity and rotation about the content centre', () => {
    const svg = buildSvgDocument({ ...documentStore.get(), shapes: make() });
    expect(svg).toMatch(/<g opacity="0.6" transform="rotate\(30 /);
    expect(svg.match(/<g /g)).toHaveLength(1);
    expect(new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector('parsererror')).toBeNull();
  });
  it('hidden and empty groups are not written', () => {
    const g = { ...makeGroup([makeRect(0, 0, 5, 5, st)]), visible: false };
    const svg = buildSvgDocument({ ...documentStore.get(), shapes: [g] });
    expect(svg).not.toContain('<g');
  });
  it('export → import round trip keeps the group, its rotation and opacity', () => {
    const doc = { ...documentStore.get(), shapes: make() };
    const back = importSvg(buildSvgDocument(doc));
    back.shapes.shift();                                           // the background <rect>
    expect(back.shapes.map(s => s.type)).toEqual(['group', 'rectangle']);
    const g = grp(back.shapes[0]);
    expect(g.rotation).toBeCloseTo(30, 3); expect(g.opacity).toBe(0.6);
    expect(g.children.map(c => c.type)).toEqual(['rectangle', 'ellipse']);
    const b0 = getWorldBounds(doc.shapes[0]), b1 = getWorldBounds(g);
    for (const k of ['x', 'y', 'width', 'height'] as const) expect(b1[k]).toBeCloseTo(b0[k], 2);
  });
  it('project files keep groups; hostile nesting and empty groups are cut off', () => {
    const doc = { ...documentStore.get(), shapes: make() };
    expect(parseProject(serializeProject(doc))).toEqual(doc);
    let deep: any = { type: 'rectangle', id: 'leaf', width: 1, height: 1 };
    for (let i = 0; i < 200; i++) deep = { type: 'group', id: 'g' + i, children: [deep, { type: 'rectangle', id: 'r' + i, width: 1, height: 1 }] };
    const text = JSON.stringify({ format: 'svg-editor-project', version: 1, doc: { shapes: [deep, { type: 'group', id: 'e', children: [] }] } });
    const d = parseProject(text);
    expect(maxDepth(d.shapes)).toBeLessThanOrEqual(MAX_GROUP_DEPTH);
    expect(d.shapes.some(s => s.id === 'e')).toBe(false);
  });
  it('ungroupShape is the exact inverse of grouping for a plain group', () => {
    const [g] = make();
    const plain = { ...g, rotation: 0, opacity: 1 } as GroupShape;
    expect(ungroupShape(plain)).toEqual(plain.children);
  });
});

describe('Canvas inside a rotated group', () => {
  let app: any, svg: SVGSVGElement;
  const fire = (el: EventTarget, type: string, x = 0, y = 0) => {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
    flushSync();
  };
  beforeEach(() => {
    viewport.setZoom(1);
    app = mount(Canvas, { target: document.body, props: {} });
    flushSync();
    svg = document.querySelector('svg.svge-canvas')!;
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0 } as any);
  });
  afterEach(() => { unmount(app); document.body.innerHTML = ''; });

  it('renders nested <g data-shape-id> with the group rotation', () => {
    const [a, b] = twoRects(); editor.select([a.id, b.id]); editor.group();
    const g = shapes()[0]; editor.updateShape(g.id, { rotation: 90 }); flushSync();
    const gEl = svg.querySelector(`g[data-shape-id="${g.id}"]`)!;
    expect(gEl.getAttribute('transform')).toMatch(/^rotate\(90 /);
    expect(gEl.querySelector(`[data-shape-id="${a.id}"]`)).not.toBeNull();
  });
  it('pointer movement is converted into the group’s frame while editing inside it', () => {
    const [a, b] = twoRects(); editor.select([a.id, b.id]); editor.group();
    const g = shapes()[0]; editor.updateShape(g.id, { rotation: 90 });
    editor.enterGroup(g.id, a.id); flushSync();
    const el = svg.querySelector(`[data-shape-id="${a.id}"]`)!;
    fire(el, 'pointerdown', 100, 100);
    fire(window, 'pointermove', 130, 100);          // 30 px to the right on screen …
    fire(window, 'pointerup', 130, 100);
    const moved: any = findShape(shapes(), a.id);
    expect(moved.x).toBeCloseTo(0, 3);              // … is "up" (−y) in a group rotated by 90°
    expect(moved.y).toBeCloseTo(-30, 3);
  });
  it('Esc with nothing selected leaves the group', () => {
    const [a, b] = twoRects(); editor.select([a.id, b.id]); editor.group();
    editor.enterGroup(shapes()[0].id); flushSync();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); flushSync();
    expect(ui.get().groupPath).toEqual([]);
  });
  it('Ctrl+G / Ctrl+Shift+G group and ungroup', () => {
    const [a, b] = twoRects(); editor.select([a.id, b.id]);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', ctrlKey: true, bubbles: true, cancelable: true })); flushSync();
    expect(shapes()).toHaveLength(1); expect(shapes()[0].type).toBe('group');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'G', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })); flushSync();
    expect(shapes()).toHaveLength(2);
  });
});

import { moveInTree, dropProblem } from '../../src/lib/utils/tree';

describe('layer drag & drop (moveInTree)', () => {
  const mk = (id: string, extra: Record<string, unknown> = {}) => ({ ...makeRect(0, 0, 10, 10, { fill: '#000', stroke: 'none', strokeWidth: 0 }), id, ...extra }) as any;
  const grp = (id: string, kids: any[], extra: Record<string, unknown> = {}) => ({ ...makeGroup(kids), id, ...extra }) as any;
  const ids = (l: any[]): any => l.map(s => s.type === 'group' ? [s.id, ids(s.children)] : s.id);

  it('above = later in z-order, below = earlier; into a group = on top of its children', () => {
    const t = [mk('a'), mk('b'), mk('c')];
    expect(ids(moveInTree(t, 'a', 'c', 'above')!)).toEqual(['b', 'c', 'a']);
    expect(ids(moveInTree(t, 'c', 'a', 'below')!)).toEqual(['c', 'a', 'b']);
    const g = [mk('a'), grp('g', [mk('x'), mk('y')])];
    expect(ids(moveInTree(g, 'a', 'g', 'inside')!)).toEqual([['g', ['x', 'y', 'a']]]);
    expect(ids(moveInTree(g, 'x', 'a', 'below')!)).toEqual(['x', 'a', ['g', ['y']]]);   // out of the group
  });
  it('refuses nonsense: onto itself, a group into itself, into a non-group, unchanged order', () => {
    const t = [mk('a'), grp('g', [mk('x'), grp('h', [mk('z')])])];
    expect(moveInTree(t, 'a', 'a', 'above')).toBeNull();
    expect(moveInTree(t, 'g', 'z', 'below')).toBeNull();
    expect(moveInTree(t, 'g', 'h', 'inside')).toBeNull();
    expect(dropProblem(t, 'g', 'a', 'inside')).toBe('not a group');
    expect(moveInTree(t, 'a', 'g', 'below')).toBeNull();                              // it is already just below g
  });
  it('does not move shapes between differently rotated frames', () => {
    const t = [mk('a'), grp('g', [mk('x')], { rotation: 30 })];
    expect(moveInTree(t, 'a', 'g', 'inside')).toBeNull();
    expect(moveInTree(t, 'x', 'a', 'above')).toBeNull();
    const u = [grp('g', [mk('x'), mk('y')], { rotation: 30 })];
    expect(ids(moveInTree(u, 'x', 'y', 'above')!)).toEqual([['g', ['y', 'x']]]);       // reordering inside is fine
  });
});
