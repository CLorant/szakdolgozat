// @vitest-environment jsdom
// The text model and the styles a family really has.
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

describe('text model', () => {
  it('weights are numbers; old projects with bold / normal still open', () => {
    expect([normWeight('bold'), normWeight('normal'), normWeight('350'), normWeight(2000), normWeight('x', 500)]).toEqual([700, 400, 350, 1000, 500]);
    const old = parseProject(JSON.stringify({ format: 'svg-editor-project', version: 1, doc: { ...emptyDocument(),
      shapes: [{ type: 'text', x: 0, y: 10, content: 'a', fontWeight: 'bold', textDecoration: 'underline' }] } })).shapes[0] as TextShape;
    expect(old).toMatchObject({ fontWeight: 700, textDecoration: 'underline', wordSpacing: 0, lineHeight: 1.25 });
  });
  it('decoration lines combine and are written as one text-decoration value', () => {
    expect(decorationLines('underline wavy red overline')).toEqual(['underline', 'overline']);
    expect(toggleDecoration('', 'line-through')).toBe('line-through');
    expect(toggleDecoration('line-through', 'underline')).toBe('underline line-through');
    expect(toggleDecoration('underline line-through', 'underline')).toBe('line-through');
    const svg = buildSvgDocument({ ...emptyDocument(), shapes: [T({ textDecoration: 'underline overline', wordSpacing: 6, lineHeight: 2, fontWeight: 650 })] }, {});
    expect(svg).toContain('text-decoration="underline overline"');
    expect(svg).toContain('word-spacing="6"');
    expect(svg).toContain('font-weight="650"');
  });
  it('line height spaces the lines; word spacing widens the box', () => {
    const one = textBounds({ ...T(), content: 'a\nb' } as TextShape), two = textBounds({ ...T({ lineHeight: 2.5 }), content: 'a\nb' } as TextShape);
    expect(two.height - one.height).toBeCloseTo(40 * (2.5 - 1.25), 6);
    expect(textBounds(T({ wordSpacing: 30 })).width - textBounds(T()).width).toBeCloseTo(30, 6);
  });
  it('flipping text sets flipX / flipY (the letters are mirrored by a transform); twice = back to normal', () => {
    const t = T();
    const once = mirrorShape(t, 'h') as TextShape;
    expect(once.flipX).toBe(true);
    expect(getWorldBounds(once)).toEqual(getWorldBounds(t));
    expect((mirrorShape(once, 'h') as TextShape).flipX).toBeUndefined();
    expect(buildSvgDocument({ ...emptyDocument(), shapes: [once] }, {})).toMatch(/transform="translate\([^)]+\) scale\(-1 1\)/);
  });
  it('flipped text imported from an SVG keeps its place', async () => {
    const { importSvg } = await import('../../src/lib/utils/svgImport');
    const r = importSvg('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><text x="-200" y="100" font-size="40" transform="scale(-1 1)">Hi</text></svg>');
    const s = r.shapes[0] as TextShape;
    expect(s.flipX).toBe(true);
    const w = textBounds({ ...s, flipX: undefined } as TextShape).width;
    const b = getWorldBounds(s);
    expect(b.x).toBeCloseTo(200 - w, 6);                                     // the original box mirrored about x = 0
    expect(b.x + b.width).toBeCloseTo(200, 6);
  });
  it('generic families: the editor draws them with the bundled font, an exported SVG keeps the generic name', () => {
    expect(cssFontFamily('serif')).toBe("'SVGE serif', serif");
    expect(cssFontFamily('cursive')).toBe("'SVGE cursive', 'SVGE sans-serif', cursive");
    expect(svgFontFamily('serif')).toBe('serif');
    expect(buildSvgDocument({ ...emptyDocument(), shapes: [T({ fontFamily: 'monospace' })] }, {})).toContain('font-family="monospace"');
  });
});

describe('font styles (weights the family really has)', () => {
  beforeEach(async () => { await ensureGoogleCatalog(true); });
  it('Google families come from the Fontsource metadata; variable families get their range', async () => {
    expect(fontsourceId('Open Sans')).toBe('open-sans');
    expect(await fontStyles('Roboto')).toEqual({ weights: [400, 700], variable: null, italic: true, known: true });
    expect(await fontStyles('Inter')).toEqual({ weights: [100, 900], variable: { min: 100, max: 900 }, italic: false, known: true });
    expect(await fontStyles('Abril Fatface')).toMatchObject({ weights: [400], italic: false });
    expect(await fontStyles('No Such Font')).toEqual(UNKNOWN_STYLES);
  });
  it('bundled generic families describe their files', () => {
    expect(bundledStyles(bundledFamily('serif')!)).toEqual({ weights: [100, 900], variable: { min: 100, max: 900 }, italic: true, known: true });
    expect(bundledStyles(bundledFamily('cursive')!)).toMatchObject({ weights: [300, 400, 700], variable: null, italic: true });
    expect(bundledStyles(bundledFamily('fantasy')!)).toMatchObject({ weights: [400], italic: false });
    expect(bundledFamily('ui-monospace')!.name).toBe('Noto Sans Mono');
  });
  it('helpers: nearest weight, real bold, labels', () => {
    const fixed = { weights: [300, 400, 700], variable: null, italic: true, known: true };
    expect(nearestWeight(fixed, 650)).toBe(700);
    expect(nearestWeight({ ...fixed, variable: { min: 200, max: 800 } }, 950)).toBe(800);
    expect(hasRealBold({ ...fixed, weights: [400, 500] })).toBe(false);
    expect(hasRealBold(fixed)).toBe(true);
    expect(weightLabel(600)).toBe('600 Semi Bold'); expect(weightLabel(450)).toBe('450');
  });
  it('text to path of a generic family uses the bundled font at the wanted weight (variable)', async () => {
    const thin = pathBounds((await outlineText(T({ fontFamily: 'sans-serif', fontWeight: 100 })))!.nodes, true);
    const black = pathBounds((await outlineText(T({ fontFamily: 'sans-serif', fontWeight: 900 })))!.nodes, true);
    expect(black.width).toBeGreaterThan(thin.width + 10);
    const r = (await outlineText({ ...T({ fontFamily: 'cursive' }), content: 'ő' } as TextShape))!;
    expect(r.missing).toBe(0);                                           // Comic Neue has no ő: the bundled sans fills in
  });
  it('a space after a fallback character keeps the chosen font\'s width, as in the browser', async () => {
    const w = async (content: string) => pathBounds((await outlineText({ ...T({ fontFamily: 'cursive' }), content } as TextShape))!.nodes, true).width;
    const afterFallback = (await w('ő H')) - (await w('őH'));           // ő comes from the bundled sans
    const afterOwn = (await w('o H')) - (await w('oH'));                 // o is Comic Neue's own
    expect(afterFallback).toBeCloseTo(afterOwn, 1);
  });
  it('word spacing, line height, decorations and flips reach the outline', async () => {
    const plain = pathBounds((await outlineText(T({ fontFamily: 'sans-serif' })))!.nodes, true);
    const spaced = pathBounds((await outlineText(T({ fontFamily: 'sans-serif', wordSpacing: 50 })))!.nodes, true);
    expect(spaced.width - plain.width).toBeCloseTo(50, 0);
    const under = (await outlineText(T({ fontFamily: 'sans-serif', textDecoration: 'underline' })))!;
    const both = (await outlineText(T({ fontFamily: 'sans-serif', textDecoration: 'underline overline line-through' })))!;
    expect(contours(both.nodes).length - contours(under.nodes).length).toBe(2);
    const two = pathBounds((await outlineText({ ...T({ fontFamily: 'sans-serif', lineHeight: 3 }), content: 'H\nH' } as TextShape))!.nodes, true);
    expect(two.height).toBeGreaterThan(40 * 3);
    const flipped = pathBounds((await outlineText({ ...T({ fontFamily: 'sans-serif' }), flipX: true } as TextShape))!.nodes, true);
    const box = textBounds(T({ fontFamily: 'sans-serif' }));
    // mirrored about the centre of the text box
    expect(flipped.x + flipped.width - (box.x + box.width / 2)).toBeCloseTo(box.x + box.width / 2 - plain.x, 0);
  });
});
