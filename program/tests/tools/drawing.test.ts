// Drawing tools: rectangle, line, ellipse, polygon, pen, freehand, text.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { createTools } from '../../src/lib/tools';
import type { PointerInfo } from '../../src/lib/tools';
import { editor } from '../../src/lib/stores/editor';
import { documentStore, historyPast } from '../../src/lib/stores/document';
import { ui } from '../../src/lib/stores/ui';
import { tempShape, guides, activeNode } from '../../src/lib/stores/interaction';
import { makeRect, makePath, getWorldBounds, getRotationOrigin, setTextContent, makeText } from '../../src/lib/utils/shapes';
import { corner } from '../../src/lib/utils/path';
import { rotatePoint } from '../../src/lib/utils/math';
import { DEFAULT_TEXT_PROPS } from '../../src/lib/utils/text';

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

describe('creation tools', () => {
  it('rectangle: draws, shift = square, alt = from centre, tiny drag discarded', () => {
    const t = tools.rectangle;
    t.down(I(10, 10)); t.move(I(60, 40)); expect(get(tempShape)).not.toBeNull(); t.up(I(60, 40));
    expect(shapes()[0]).toMatchObject({ type: 'rectangle', x: 10, y: 10, width: 50, height: 30 });
    expect(get(tempShape)).toBeNull();
    t.down(I(10, 10)); t.up(I(10, 10));
    expect(shapes()).toHaveLength(1);
    t.down(I(100, 100)); t.move(I(130, 110, { shift: true })); t.up(I(130, 110, { shift: true }));
    expect(shapes()[1]).toMatchObject({ width: 30, height: 30 });
    t.down(I(200, 200)); t.move(I(210, 220, { alt: true })); t.up(I(210, 220, { alt: true }));
    expect(shapes()[2]).toMatchObject({ x: 190, y: 180, width: 20, height: 40 });
  });
  it('line: shift snaps to 45°; ellipse from box', () => {
    tools.line.down(I(0, 0)); tools.line.move(I(100, 10, { shift: true })); tools.line.up(I(100, 10, { shift: true }));
    const l: any = shapes()[0]; expect(l.y2).toBeCloseTo(0, 5); expect(l.x2).toBeGreaterThan(90);
    tools.ellipse.down(I(0, 0)); tools.ellipse.move(I(40, 20)); tools.ellipse.up(I(40, 20));
    expect(shapes()[1]).toMatchObject({ type: 'ellipse', cx: 20, cy: 10, rx: 20, ry: 10 });
  });
  it('polygon: closes on the first vertex; double-click does not duplicate the last vertex', () => {
    const t = tools.polygon;
    [[0, 0], [100, 0], [100, 100]].forEach(([x, y]) => { t.down(I(x, y)); t.up(I(x, y)); });
    t.down(I(2, 2)); t.up(I(2, 2));                                    // near start → close
    expect(shapes()[0]).toMatchObject({ type: 'path', closed: true }); expect((shapes()[0] as any).nodes).toHaveLength(3);

    [[300, 300], [400, 300], [400, 400]].forEach(([x, y]) => { t.down(I(x, y)); t.up(I(x, y)); });
    t.down(I(400, 400)); t.up(I(400, 400)); t.dblclick!(I(400, 400));  // double-click: 2nd click is ignored
    expect((shapes()[1] as any).nodes).toHaveLength(3);
  });
  it('polygon: Esc keeps an open polyline; Backspace removes a vertex; <2 points → nothing', () => {
    const t = tools.polygon;
    t.down(I(0, 0)); t.down(I(50, 0)); t.down(I(50, 50));
    expect(t.key!({ key: 'Backspace', shiftKey: false, ctrlKey: false, metaKey: false })).toBe(true);
    expect(t.escape()).toBe(true);
    expect(shapes()[0]).toMatchObject({ closed: false, fill: 'none' }); expect((shapes()[0] as any).nodes).toHaveLength(2);
    t.down(I(0, 0)); t.escape(); expect(shapes()).toHaveLength(1);
  });
  it('pen: click-drag makes a smooth node with symmetric handles; click first node closes', () => {
    const t = tools.pen;
    t.down(I(0, 0)); t.move(I(0, 0)); t.up(I(0, 0));
    t.down(I(100, 0)); t.move(I(130, 40)); t.up(I(130, 40));
    t.down(I(100, 100)); t.up(I(100, 100));
    t.down(I(3, 3));
    const s: any = shapes()[0];
    expect(s).toMatchObject({ type: 'path', closed: true });
    expect(s.nodes).toHaveLength(3);
    expect(s.nodes[1]).toMatchObject({ smooth: true, hout: { x: 130, y: 40 }, hin: { x: 70, y: -40 } });
    expect(s.nodes[0].smooth).toBe(false);
  });
  it('pen: double-click finishes an open path without a duplicate node; Enter finishes', () => {
    const t = tools.pen;
    t.down(I(0, 0)); t.up(I(0, 0)); t.down(I(50, 50)); t.up(I(50, 50));
    t.down(I(80, 20)); t.up(I(80, 20)); t.down(I(80, 20)); t.up(I(80, 20)); t.dblclick!(I(80, 20));
    expect((shapes()[0] as any).nodes).toHaveLength(3);
    t.down(I(200, 0)); t.up(I(200, 0)); t.down(I(209, 9)); t.up(I(209, 9));    // away from the first path's ends
    expect(t.key!({ key: 'Enter', shiftKey: false, ctrlKey: false, metaKey: false })).toBe(true);
    expect(shapes()).toHaveLength(2);
  });
  it('switching tools finishes a pending pen path', () => {
    tools.pen.down(I(0, 0)); tools.pen.up(I(0, 0)); tools.pen.down(I(30, 30)); tools.pen.up(I(30, 30));
    tools.pen.deactivate();
    expect(shapes()).toHaveLength(1); expect(tools.pen.busy()).toBe(false);
  });
  it('freehand: thousands of samples become a handful of smooth nodes', () => {
    const t = tools.freehand;
    t.down(I(0, 0));
    for (let k = 1; k < 3000; k++) t.move(I(k * 0.2, Math.sin(k / 100) * 50));
    t.up(I(600, 0));
    const s: any = shapes()[0];
    expect(s.type).toBe('path'); expect(s.closed).toBe(false); expect(s.fill).toBe('none');
    expect(s.nodes.length).toBeGreaterThan(5); expect(s.nodes.length).toBeLessThan(80);
  });
  it('text tool: new text opens an editor session without touching the document', () => {
    tools.text.down(I(30, 40));
    expect(ctx.openText).toHaveBeenCalledWith(expect.objectContaining({ x: 30, y: 40, content: '' }), true);
    expect(shapes()).toHaveLength(0); expect(hist()).toBe(0);
  });
});

const ENTER = { key: 'Enter', shiftKey: false, ctrlKey: false, metaKey: false };

describe('arc tool', () => {
  const t = tools.arc;
  const arcOf = async () => (await import('../../src/lib/utils/arc'));
  it('drag for the ends, move to bend, click: a half circle through the pointer, never filled; Enter finishes', () => {
    t.down(I(0, 100)); t.move(I(100, 100)); t.up(I(200, 100));                     // a drag sets both ends
    t.move(I(100, 0));
    t.down(I(100, 0)); t.up(I(100, 0));
    expect(shapes()).toHaveLength(0);                                              // the path goes on …
    expect(t.key!(ENTER)).toBe(true);                                              // … until it is finished
    const p = shapes()[0] as any;
    expect(p.type).toBe('path');
    expect(p.closed).toBe(false);
    expect(p.fill).toBe('none');
    expect(p.nodes.map((n: any) => [Math.round(n.x), Math.round(n.y)])).toEqual([[0, 100], [100, 0], [200, 100]]);
    const b = getWorldBounds(p);                                                   // a real circle, not a polygon
    expect(b.y).toBeCloseTo(0); expect(b.width).toBeCloseTo(200); expect(b.height).toBeCloseTo(100);
  });
  it('arcs chain: each next arc starts where the last one ended; the first point as an end closes the path', () => {
    t.down(I(0, 0)); t.up(I(0, 0)); t.down(I(100, 0)); t.up(I(100, 0)); t.down(I(50, -50)); t.up(I(50, -50));
    t.down(I(100, 100)); t.up(I(100, 100)); t.down(I(150, 50)); t.up(I(150, 50));   // second arc: end, bend
    t.down(I(0, 0)); t.up(I(0, 0)); t.down(I(-30, 50)); t.up(I(-30, 50));            // third arc ends on the start
    const p = shapes()[0] as any;
    expect(p.closed).toBe(true);
    expect(p.fill).toBe('#336699');                                                 // closed: the current fill
    expect(new Set(p.nodes.map((n: any) => `${Math.round(n.x)},${Math.round(n.y)}`)).has('100,100')).toBe(true);
  });
  it('double-click on the bend finishes; Backspace removes the whole last arc; Esc ends the path', () => {
    t.down(I(0, 0)); t.up(I(0, 0)); t.down(I(100, 0)); t.up(I(100, 0));
    t.down(I(50, 40)); t.up(I(50, 40)); t.down(I(50, 40)); t.up(I(50, 40)); t.dblclick!(I(50, 40));
    expect(shapes()).toHaveLength(1);
    expect((shapes()[0] as any).nodes).toHaveLength(3);
    editor.deselectAll();
    t.down(I(300, 0)); t.up(I(300, 0)); t.down(I(400, 0)); t.up(I(400, 0)); t.down(I(350, 50)); t.up(I(350, 50));
    t.down(I(500, 0)); t.up(I(500, 0)); t.down(I(450, 30)); t.up(I(450, 30));
    t.key!({ key: 'Backspace', shiftKey: false, ctrlKey: false, metaKey: false });
    expect(t.escape()).toBe(true);
    expect((shapes()[1] as any).nodes.map((n: any) => Math.round(n.x))).toEqual([300, 350, 400]);
  });
  it('Shift rounds the sweep to 15°; points on one line give a straight segment', async () => {
    const { arcThrough } = await arcOf();
    const a = arcThrough({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 20 }, 15)!;
    expect(Math.round(Math.abs(a.sweep) * 180 / Math.PI) % 15).toBe(0);
    expect(arcThrough({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 0 })).toBeNull();
  });
  it('arcNodes: at most 90° per segment, the ends are corners, the inner nodes smooth', async () => {
    const { arcThrough, arcNodes } = await arcOf();
    const nodes = arcNodes(arcThrough({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 10, y: 0.5 })!);   // nearly a full circle
    expect(nodes.length).toBe(5);
    expect(nodes[0].hin).toBeNull(); expect(nodes.at(-1)!.hout).toBeNull();
    expect(nodes.slice(1, -1).every(n => n.smooth)).toBe(true);
  });
});

describe('pen and arc share one path; open paths can be continued', () => {
  const B = (k: 'pen' | 'arc') => { const prev = ui.get().tool; ui.set({ tool: k }); tools[prev].deactivate(); };
  it('switching Pen → Arc → Pen keeps drawing the same path', () => {
    B('pen');
    tools.pen.down(I(0, 0)); tools.pen.up(I(0, 0)); tools.pen.down(I(100, 0)); tools.pen.up(I(100, 0));
    B('arc');
    tools.arc.down(I(100, 100)); tools.arc.up(I(100, 100)); tools.arc.down(I(150, 50)); tools.arc.up(I(150, 50));
    B('pen');
    tools.pen.down(I(0, 100)); tools.pen.up(I(0, 100));
    expect(shapes()).toHaveLength(0);
    tools.pen.key!(ENTER);
    const p = shapes()[0] as any;
    expect(p.nodes[0]).toMatchObject({ x: 0, y: 0 });
    expect(p.nodes.at(-1)).toMatchObject({ x: 0, y: 100 });
    expect(p.nodes.some((n: any) => n.hin)).toBe(true);                             // the arc is in it
    B('pen'); ui.set({ tool: 'transform' }); tools.pen.deactivate();
  });
  it('clicking an end of the selected open path continues it (same id, one undo step); its other end closes it', () => {
    const t = tools.pen;
    const p = makePath([corner(0, 0), corner(100, 0)], false, st); editor.addShape(p);     // selected
    const n = hist();
    t.down(I(101, 1)); t.up(I(101, 1));                                             // the end: no new node
    t.down(I(100, 100)); t.up(I(100, 100));
    t.down(I(0, 0)); t.up(I(0, 0));                                                 // the start closes it
    expect(shapes()).toHaveLength(1);
    expect(shapes()[0]).toMatchObject({ id: p.id, closed: true });
    expect((shapes()[0] as any).nodes).toHaveLength(3);
    expect(hist()).toBe(n + 1);
  });
  it('starting on the start of a path continues it from there; unselected paths are never continued', () => {
    const t = tools.pen;
    const p = makePath([corner(0, 0), corner(100, 0)], false, st); editor.addShape(p);
    t.down(I(0, 0)); t.up(I(0, 0)); t.down(I(0, 80)); t.up(I(0, 80)); t.key!(ENTER);
    expect((shapes()[0] as any).nodes.map((q: any) => [q.x, q.y])).toEqual([[100, 0], [0, 0], [0, 80]]);
    editor.deselectAll();
    t.down(I(0, 80)); t.up(I(0, 80)); t.down(I(50, 80)); t.up(I(50, 80)); t.key!(ENTER);
    expect(shapes()).toHaveLength(2);
  });
  it('a rotated path is continued where it is drawn; a line becomes a path', () => {
    const t = tools.pen;
    const p = { ...makePath([corner(0, 0), corner(100, 0)], false, st), rotation: 90 }; editor.addShape(p);
    const ends = [rotatePoint({ x: 0, y: 0 }, { x: 50, y: 0 }, 90), rotatePoint({ x: 100, y: 0 }, { x: 50, y: 0 }, 90)];
    t.down(I(ends[1].x, ends[1].y)); t.up(I(ends[1].x, ends[1].y)); t.down(I(200, 200)); t.up(I(200, 200)); t.key!(ENTER);
    const q = shapes()[0] as any;
    expect(q.rotation).toBe(0);
    expect(q.nodes[0].x).toBeCloseTo(ends[0].x); expect(q.nodes[0].y).toBeCloseTo(ends[0].y);
    expect(q.nodes.at(-1)).toMatchObject({ x: 200, y: 200 });
  });
  it('freehand: a stroke from the end of the selected path continues it', () => {
    const p = makePath([corner(0, 0), corner(100, 0)], false, st); editor.addShape(p);
    const f = tools.freehand;
    f.down(I(100, 0));
    for (let k = 1; k <= 50; k++) f.move(I(100 + k * 2, Math.sin(k / 8) * 20));
    f.up(I(200, 0));
    expect(shapes()).toHaveLength(1);
    const q = shapes()[0] as any;
    expect(q.id).toBe(p.id);
    expect(q.nodes[0]).toMatchObject({ x: 0, y: 0 });
    expect(q.nodes.length).toBeGreaterThan(3);
  });
});
