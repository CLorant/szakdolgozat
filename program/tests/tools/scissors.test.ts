// @vitest-environment jsdom
// Scissors: cutting at a point, knife, lasso, which shapes are cut.
import { describe, it, expect, beforeEach } from 'vitest';
import { cutPathAt } from '../../src/lib/utils/scissors';
import { paintBlob, mergeable } from '../../src/lib/utils/blob';
import { makePath, makeRect, makeLine, makeText, makeImage, mirrorShape, getWorldBounds, toPathShape, shapeTransform, makeEllipse } from '../../src/lib/utils/shapes';
import { corner, contours, pathBounds, freehandToNodes } from '../../src/lib/utils/path';
import { buildSvgDocument } from '../../src/lib/utils/serializer';
import { parseProject, serializeProject } from '../../src/lib/utils/project';
import { emptyDocument, documentStore } from '../../src/lib/stores/document';
import { editor } from '../../src/lib/stores/editor';
import { ui } from '../../src/lib/stores/ui';
import { DEFAULT_TEXT_PROPS, normWeight, decorationLines, toggleDecoration, textBounds, svgFontFamily, cssFontFamily } from '../../src/lib/utils/text';
import { placeImage } from '../../src/lib/utils/imageImport';
import { viewport, CANVAS_PADDING } from '../../src/lib/stores/viewport';
import { panBy, anchoredScroll } from '../../src/lib/utils/zoom';
import { nearestWeight, hasRealBold, weightLabel, fontsourceId, fontStyles, UNKNOWN_STYLES } from '../../src/lib/fonts/styles';
import { bundledFamily, bundledStyles } from '../../src/lib/fonts/bundled';
import { outlineText } from '../../src/lib/utils/textOutline';
import { ensureGoogleCatalog } from '../../src/lib/fonts/state';
import type { PathShape, ImageShape, TextShape } from '../../src/lib/utils/types';
import { booleanShapes, cutShape, isLasso, straightKnife } from '../../src/lib/utils/boolean';

const st = { fill: '#336699', stroke: '#000000', strokeWidth: 2 };
const square = () => makePath([corner(0, 0), corner(100, 0), corner(100, 100), corner(0, 100)], true, st);
const T = (extra: Record<string, unknown> = {}) => makeText(100, 200, 'Hi there', { ...DEFAULT_TEXT_PROPS, fontSize: 40, ...extra } as any, st);
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';


const red = { fill: '#ff0000', stroke: '#000000', strokeWidth: 2 };
const blue = { fill: '#0000ff', stroke: 'none', strokeWidth: 0 };
const area = (s: PathShape) => {                 // polygon area of the flattened contours (signed sum, nonzero-ish for simple cases)
  let a = 0;
  for (const c of contours(s.nodes)) { let k = 0; for (let i = 0; i < c.length; i++) { const p = c[i], q = c[(i + 1) % c.length]; k += p.x * q.y - q.x * p.y; } a += k / 2; }
  return Math.abs(a);
};

describe('scissors', () => {
  it('a closed path cut on an edge becomes one open path that starts and ends at the cut', () => {
    const r = cutPathAt(square(), { x: 50, y: 1 }, 5)!;
    expect(r).toHaveLength(1);
    expect(r[0].closed).toBe(false);
    expect(r[0].nodes[0]).toMatchObject({ x: 50, y: 0 });
    expect(r[0].nodes.at(-1)).toMatchObject({ x: 50, y: 0 });
    expect(r[0].nodes).toHaveLength(6);                                  // 4 corners + the cut twice
  });
  it('an open path cut in the middle gives two paths; at its end nothing happens; too far is no cut', () => {
    const line = toPathShape(makeLine({ x: 0, y: 0 }, { x: 100, y: 0 }, st))!;
    const r = cutPathAt(line, { x: 30, y: 2 }, 5)!;
    expect(r).toHaveLength(2);
    expect(r[0].nodes.map(n => n.x)).toEqual([0, 30]);
    expect(r[1].nodes.map(n => n.x)).toEqual([30, 100]);
    expect(r[0].id).toBe(line.id); expect(r[1].id).not.toBe(line.id);
    expect(cutPathAt(line, { x: 0, y: 0 }, 5)).toBeNull();
    expect(cutPathAt(line, { x: 50, y: 30 }, 5)).toBeNull();
  });
  it('a curve is cut without changing its shape; a rotated path is cut where it is drawn', () => {
    const curve = makePath([corner(0, 0), { x: 100, y: 0, hin: { x: 100, y: -60 }, hout: null, smooth: false }], false, st);
    curve.nodes[0] = { ...curve.nodes[0], hout: { x: 0, y: -60 } };
    const before = pathBounds(curve.nodes, false);
    const r = cutPathAt(curve, { x: 50, y: -45 }, 5)!;
    const after = pathBounds([...r[0].nodes, ...r[1].nodes], false);
    expect(after.y).toBeCloseTo(before.y, 3); expect(after.width).toBeCloseTo(before.width, 3);
    const rotated = { ...square(), rotation: 90 } as PathShape;               // a 90° turn about (50, 50): same square
    const c = cutPathAt(rotated, { x: 99, y: 50 }, 5)!;
    expect(c[0].rotation).toBe(0);
    expect(c[0].nodes[0].x).toBeCloseTo(100, 6); expect(c[0].nodes[0].y).toBeCloseTo(50, 6);
  });
  it('in a compound path only the cut contour comes out', () => {
    const donut = makePath([corner(0, 0), corner(100, 0), corner(100, 100), corner(0, 100),
      { ...corner(25, 25), sub: true }, corner(25, 75), corner(75, 75), corner(75, 25)], true, st);
    const r = cutPathAt(donut, { x: 50, y: 25 }, 3)!;
    expect(r).toHaveLength(2);
    expect(r[0].closed).toBe(true); expect(contours(r[0].nodes)).toHaveLength(1);
    expect(r[1].closed).toBe(false); expect(r[1].nodes).toHaveLength(6);
  });
  it('through the editor: the pieces take the place of the shape and are selected', () => {
    editor.newDocument(400, 300);
    const a = makeRect(0, 0, 10, 10, st), b = square(), c = makeRect(200, 0, 10, 10, st);
    editor.addShapes([a, b, c]);
    editor.replaceWithPieces(b.id, cutPathAt(b, { x: 50, y: 0 }, 2)!, 'Cut path');
    expect(documentStore.get().shapes.map(s => s.id)).toEqual([a.id, b.id, c.id]);
    expect(ui.get().selectedIds).toEqual([b.id]);
  });
});

describe('scissors: cutting areas', () => {
  it('a straight cut through a rectangle gives two closed pieces with the stroke all round', async () => {
    const r = makeRect(0, 0, 100, 60, red);
    const parts = (await cutShape(r, straightKnife({ x: 50, y: -10 }, { x: 50, y: 70 }), false))!;
    expect(parts).toHaveLength(2);
    expect(parts.every(p => p.closed && p.stroke === '#000000')).toBe(true);
    expect(parts.map(p => Math.round(area(p)))).toEqual([3000, 3000]);
    expect(parts[0].id).toBe(r.id);
  });
  it('a knife that ends inside the shape still cuts along its line; a knife beside it does nothing', async () => {
    const r = makeRect(0, 0, 100, 60, red);
    expect((await cutShape(r, straightKnife({ x: 50, y: 20 }, { x: 50, y: 40 }), false))!).toHaveLength(2);
    expect(await cutShape(r, straightKnife({ x: 200, y: -10 }, { x: 200, y: 70 }), false)).toBeNull();
  });
  it('a freehand knife keeps its curve; a cut through a ring gives two C shapes', async () => {
    const ring = { ...toPathShape(makeEllipse(50, 50, 50, 50, red))! };
    const hole = toPathShape(makeEllipse(50, 50, 25, 25, red))!;
    ring.nodes = [...ring.nodes, ...hole.nodes.map((n, i) => (i === 0 ? { ...n, sub: true as const } : n))];
    ring.fillRule = 'evenodd';
    const knife = freehandToNodes([{ x: 50, y: -20 }, { x: 55, y: 20 }, { x: 45, y: 80 }, { x: 50, y: 120 }]);
    const parts = (await cutShape(ring, knife, false))!;
    expect(parts).toHaveLength(2);
    expect(parts.every(p => contours(p.nodes).length === 1)).toBe(true);
  });
  it('a lasso cuts out the area inside it', async () => {
    const r = makeRect(0, 0, 100, 100, blue);
    const loop = [{ x: 20, y: 20 }, { x: 60, y: 20 }, { x: 60, y: 60 }, { x: 20, y: 60 }, { x: 20, y: 20 }];
    expect(isLasso(loop, 8)).toBe(true);
    expect(isLasso([{ x: 0, y: 0 }, { x: 50, y: 5 }, { x: 100, y: 0 }, { x: 150, y: 5 }], 8)).toBe(false);      // ends apart
    expect(isLasso([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 2, y: 1 }], 8)).toBe(false);       // back and forth, no area
    const parts = (await cutShape(r, loop.map(p => corner(p.x, p.y)), true))!;
    expect(parts.map(p => Math.round(area(p))).sort((x, y) => x - y)).toEqual([1600, 8400]);
  });
  it('an open path (a line) is split where the knife crosses it', async () => {
    const line = makeLine({ x: 0, y: 0 }, { x: 100, y: 0 }, red);
    const parts = (await cutShape(line, straightKnife({ x: 30, y: -10 }, { x: 30, y: 10 }), false))!;
    expect(parts).toHaveLength(2);
    expect(parts.map(p => p.nodes.map(n => Math.round(n.x)))).toEqual([[0, 30], [30, 100]]);
    expect(parts.every(p => !p.closed)).toBe(true);
  });
});

describe('scissors: which shapes are cut', () => {
  it('with mustTouch, a knife that stops short of a shape leaves it alone', async () => {
    const r = makeRect(0, 0, 100, 60, red);
    expect(await cutShape(r, straightKnife({ x: 50, y: -40 }, { x: 50, y: -10 }), false, true)).toBeNull();
    expect((await cutShape(r, straightKnife({ x: 50, y: -40 }, { x: 50, y: -10 }), false, false))!).toHaveLength(2);   // selected: extended
    expect((await cutShape(r, straightKnife({ x: 50, y: -40 }, { x: 50, y: 10 }), false, true))!).toHaveLength(2);    // reaches in: cut
  });
});
