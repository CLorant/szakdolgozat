// @vitest-environment jsdom
// Blob tool.
import { describe, it, expect, beforeEach } from 'vitest';
import { cutPathAt } from '../../src/lib/utils/scissors';
import { paintBlob, mergeable } from '../../src/lib/utils/blob';
import { makePath, makeRect, makeLine, makeText, makeImage, mirrorShape, getWorldBounds, toPathShape, shapeTransform } from '../../src/lib/utils/shapes';
import { corner, contours, pathBounds } from '../../src/lib/utils/path';
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

const st = { fill: '#336699', stroke: '#000000', strokeWidth: 2 };
const square = () => makePath([corner(0, 0), corner(100, 0), corner(100, 100), corner(0, 100)], true, st);
const T = (extra: Record<string, unknown> = {}) => makeText(100, 200, 'Hi there', { ...DEFAULT_TEXT_PROPS, fontSize: 40, ...extra } as any, st);
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';

describe('blob', () => {
  const base = () => makePath([], true, { fill: '#ff0000', stroke: 'none', strokeWidth: 0 });
  it('a stroke becomes a filled closed shape as wide as the brush', () => {
    const r = paintBlob([{ x: 0, y: 0 }, { x: 100, y: 0 }], 20, base(), [])!;
    const b = pathBounds(r.shape.nodes, true);
    expect(r.shape.closed).toBe(true);
    expect(b.width).toBeGreaterThan(115); expect(b.width).toBeLessThan(125);
    expect(b.height).toBeGreaterThan(18); expect(b.height).toBeLessThan(23);
    expect(r.merged).toEqual([]);
  });
  it('merges with touching shapes of the same fill and no stroke, never with others', () => {
    const same = makeRect(90, -20, 40, 40, { fill: '#ff0000', stroke: 'none', strokeWidth: 0 });
    const stroked = makeRect(90, -20, 40, 40, { fill: '#ff0000', stroke: '#000', strokeWidth: 2 });
    const other = makeRect(90, -20, 40, 40, { fill: '#00ff00', stroke: 'none', strokeWidth: 0 });
    const far = makeRect(400, 400, 40, 40, { fill: '#ff0000', stroke: 'none', strokeWidth: 0 });
    const nearBox = makeRect(112, 12, 5, 5, { fill: '#ff0000', stroke: 'none', strokeWidth: 0 });   // bounding boxes meet, shapes do not
    expect(mergeable(stroked, { fill: '#ff0000', stroke: 'none', strokeWidth: 0, strokeDasharray: '' })).toBe(false);
    expect(mergeable(stroked, { fill: '#ff0000', stroke: '#000', strokeWidth: 2, strokeDasharray: '' })).toBe(true);
    const r = paintBlob([{ x: 0, y: 0 }, { x: 100, y: 0 }], 20, base(), [same, stroked, other, far])!;
    expect(r.merged).toEqual([same.id]);
    expect(pathBounds(r.shape.nodes, true).width).toBeGreaterThan(135);
    const r2 = paintBlob([{ x: 0, y: 0 }, { x: 100, y: 0 }], 20, base(), [nearBox])!;
    expect(r2.merged).toEqual([]);
  });
  it('the blob gets the current stroke (default: solid black 2 px) and merges only with the same stroke', () => {
    const styled = makePath([], true, { fill: '#ff0000', stroke: '#000000', strokeWidth: 2 });
    const twin = makeRect(90, -20, 40, 40, { fill: '#ff0000', stroke: '#000000', strokeWidth: 2 });
    const bare = makeRect(90, -20, 40, 40, { fill: '#ff0000', stroke: 'none', strokeWidth: 0 });
    const r = paintBlob([{ x: 0, y: 0 }, { x: 100, y: 0 }], 20, styled, [bare, twin])!;
    expect([r.shape.stroke, r.shape.strokeWidth]).toEqual(['#000000', 2]);
    expect(r.merged).toEqual([twin.id]);
  });
  it('through the editor: absorbed shapes are removed and the blob takes the place of the topmost one', () => {
    editor.newDocument(400, 300);
    const under = makeRect(90, -20, 40, 40, { fill: '#ff0000', stroke: 'none', strokeWidth: 0 });
    const top = makeRect(300, 200, 10, 10, st);
    editor.addShapes([under, top]);
    const r = paintBlob([{ x: 0, y: 0 }, { x: 100, y: 0 }], 20, base(), documentStore.get().shapes)!;
    editor.addBlob(r.shape, r.merged);
    expect(documentStore.get().shapes.map(s => s.id)).toEqual([r.shape.id, top.id]);
  });
});
