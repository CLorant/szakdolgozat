// Boolean operations (Unite, Subtract, Intersect, Exclude, Divide) and the fill rule.
import { describe, it, expect } from 'vitest';
import { booleanShapes, cutShape, isLasso, straightKnife } from '../../src/lib/utils/boolean';
import { makeRect, makeEllipse, makeLine, toPathShape } from '../../src/lib/utils/shapes';
import { contours, pathBounds, corner, freehandToNodes } from '../../src/lib/utils/path';
import type { PathShape } from '../../src/lib/utils/types';

const red = { fill: '#ff0000', stroke: '#000000', strokeWidth: 2 };
const blue = { fill: '#0000ff', stroke: 'none', strokeWidth: 0 };
const area = (s: PathShape) => {                 // polygon area of the flattened contours (signed sum, nonzero-ish for simple cases)
  let a = 0;
  for (const c of contours(s.nodes)) { let k = 0; for (let i = 0; i < c.length; i++) { const p = c[i], q = c[(i + 1) % c.length]; k += p.x * q.y - q.x * p.y; } a += k / 2; }
  return Math.abs(a);
};

describe('boolean operations', () => {
  const a = () => makeRect(0, 0, 100, 100, red), b = () => makeRect(50, 50, 100, 100, blue);
  it('unite / intersect / exclude / subtract give the right areas and styles', async () => {
    const [u] = await booleanShapes('unite', [a(), b()]);
    expect(area(u)).toBeCloseTo(17500, 0);
    expect(u.fill).toBe('#0000ff');                                        // the top shape's style
    const [i] = await booleanShapes('intersect', [a(), b()]);
    expect(area(i)).toBeCloseTo(2500, 0);
    const [x] = await booleanShapes('exclude', [a(), b()]);
    expect(contours(x.nodes).length).toBeGreaterThanOrEqual(2);
    const [s] = await booleanShapes('subtract', [a(), b()]);
    expect(area(s)).toBeCloseTo(7500, 0);
    expect([s.fill, s.stroke]).toEqual(['#ff0000', '#000000']);           // the bottom shape's style
  });
  it('curves stay curves: two united circles have a handful of nodes, not a polygon', async () => {
    const [u] = await booleanShapes('unite', [makeEllipse(50, 50, 50, 50, red), makeEllipse(110, 50, 50, 50, red)]);
    expect(u.nodes.length).toBeLessThan(12);
    expect(u.nodes.some(n => n.hin || n.hout)).toBe(true);
    expect(pathBounds(u.nodes, true).width).toBeCloseTo(160, 1);
  });
  it('divide cuts overlapping shapes into their pieces, each styled by the shape on top', async () => {
    const parts = await booleanShapes('divide', [a(), b()]);
    expect(parts).toHaveLength(3);
    expect(parts.map(p => Math.round(area(p))).sort((x, y) => x - y)).toEqual([2500, 7500, 7500]);
    expect(parts.find(p => Math.round(area(p)) === 2500)!.fill).toBe('#0000ff');
  });
  it('disjoint shapes: intersect leaves nothing', async () => {
    expect(await booleanShapes('intersect', [makeRect(0, 0, 10, 10, red), makeRect(50, 50, 10, 10, red)])).toEqual([]);
  });
  it('a rotated shape takes part where it is drawn', async () => {
    const rot = { ...makeRect(0, 0, 100, 20, red), rotation: 90 };             // a vertical bar 40..60 × −40..60
    const [i] = await booleanShapes('intersect', [rot, makeRect(0, 0, 100, 100, red)]);
    const bb = pathBounds(i.nodes, true);
    expect(bb.x).toBeCloseTo(40, 3); expect(bb.width).toBeCloseTo(20, 3); expect(bb.height).toBeCloseTo(60, 3);
  });
});

describe('through the editor', () => {
  it('booleanOp replaces the selection at the topmost position and selects the result; images are refused', async () => {
    const { editor } = await import('../../src/lib/stores/editor');
    const { documentStore } = await import('../../src/lib/stores/document');
    const { ui } = await import('../../src/lib/stores/ui');
    const { makeImage } = await import('../../src/lib/utils/shapes');
    editor.newDocument(400, 300);
    const a = makeRect(0, 0, 100, 100, red), mid = makeRect(300, 0, 10, 10, blue), b = makeRect(50, 50, 100, 100, blue);
    editor.addShapes([a, mid, b]);
    editor.select([a.id, b.id]);
    await editor.booleanOp('unite');
    const list = documentStore.get().shapes;
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe(mid.id);
    expect(ui.get().selectedIds).toEqual([list[1].id]);
    expect(editor.canBoolean([a, makeImage(0, 0, 5, 5, 'data:image/png;base64,AAAA')])).toBe(false);
  });
  it('setFillRule changes only paths', async () => {
    const { editor } = await import('../../src/lib/stores/editor');
    const { documentStore } = await import('../../src/lib/stores/document');
    editor.newDocument(400, 300);
    const p = toPathShape(makeRect(0, 0, 10, 10, red))!, r = makeRect(20, 0, 10, 10, red);
    editor.addShapes([p, r]); editor.select([p.id, r.id]);
    editor.setFillRule('evenodd');
    expect((documentStore.get().shapes[0] as PathShape).fillRule).toBe('evenodd');
    expect('fillRule' in documentStore.get().shapes[1]).toBe(false);
    editor.setFillRule('nonzero');
    expect('fillRule' in documentStore.get().shapes[0]).toBe(false);
  });
});
