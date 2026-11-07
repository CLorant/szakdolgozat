// @vitest-environment jsdom
// Image shapes.
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

describe('images', () => {
  it('are stretched to their box, move, scale, flip with a transform and survive save / export / import', async () => {
    const img = makeImage(10, 20, 300, 200, PNG, 'photo');
    expect(getWorldBounds(img)).toEqual({ x: 10, y: 20, width: 300, height: 200 });
    const m = mirrorShape(img, 'h') as ImageShape;
    expect(m.flipX).toBe(true);
    expect(shapeTransform(m)).toContain('scale(-1 1)');
    const doc = { ...emptyDocument(), shapes: [m] };
    const back = parseProject(serializeProject(doc)).shapes[0] as ImageShape;
    expect(back).toMatchObject({ type: 'image', href: PNG, width: 300, height: 200, flipX: true });
    const svg = buildSvgDocument(doc, {});
    expect(svg).toContain('<image x="10" y="20" width="300" height="200" preserveAspectRatio="none" href="data:image/png;base64,');
    const { importSvg } = await import('../../src/lib/utils/svgImport');
    const r = importSvg(svg);
    expect(r.warnings).toEqual([]);
    expect(r.shapes.find(s => s.type === 'image')).toMatchObject({ type: 'image', x: 10, y: 20, width: 300, height: 200, flipX: true });
  });
  it('project files with unsafe or broken images drop just that image', () => {
    const bad = (o: object) => parseProject(JSON.stringify({ format: 'svg-editor-project', version: 1, doc: { ...emptyDocument(), shapes: [{ type: 'image', x: 0, y: 0, width: 10, height: 10, ...o }] } })).shapes;
    expect(bad({ href: 'javascript:alert(1)' })).toEqual([]);
    expect(bad({ href: PNG, width: 0 })).toEqual([]);
    expect(bad({ href: PNG })).toHaveLength(1);
  });
  it('a big image is scaled down to fit 80 % of the page, centred where it was dropped', () => {
    expect(placeImage(4000, 2000, { width: 800, height: 600 })).toEqual({ x: 80, y: 140, width: 640, height: 320 });
    expect(placeImage(100, 50, { width: 800, height: 600 }, { x: 10, y: 10 })).toEqual({ x: -40, y: -15, width: 100, height: 50 });
  });
  it('style changes leave an image alone except its opacity', () => {
    editor.newDocument(400, 300);
    const img = makeImage(0, 0, 10, 10, PNG);
    editor.addShape(img);
    editor.setStyle({ fill: '#ff0000', stroke: '#00ff00', opacity: 0.5 });
    expect(documentStore.get().shapes[0]).toMatchObject({ fill: 'none', stroke: 'none', opacity: 0.5 });
  });
});
