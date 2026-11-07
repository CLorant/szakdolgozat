// @vitest-environment jsdom
// Export: settings, area, background, raster size, font handling, canvas fitting.
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { sanitizeSettings, DEFAULT_SETTINGS, svgSettingsOf } from '../../src/lib/utils/exportSettings';
import { exportArea, contentBounds } from '../../src/lib/utils/exportArea';
import { exportSize, buildSvgFromSettings, buildSvgFile, MAX_RASTER_SIDE } from '../../src/lib/utils/exportDoc';
import { buildSvgDocument, backgroundColor } from '../../src/lib/utils/serializer';
import { embedFontCss } from '../../src/lib/fonts/embed';
import { emptyDocument, documentStore, historyPast } from '../../src/lib/stores/document';
import { editor } from '../../src/lib/stores/editor';
import { ui } from '../../src/lib/stores/ui';
import { createTools } from '../../src/lib/tools';
import type { PointerInfo } from '../../src/lib/tools';
import { serializeProject, parseProject } from '../../src/lib/utils/project';
import { makeRect, makeEllipse, makeText, resizeMany, rotateMany, getWorldBounds, unionBounds } from '../../src/lib/utils/shapes';
import { DEFAULT_TEXT_PROPS } from '../../src/lib/utils/text';
import type { DocumentState, Shape, GroupShape } from '../../src/lib/utils/types';
import { net } from '../helpers/fakeGoogle';
import { mount, unmount, flushSync } from 'svelte';
import Canvas from '../../src/lib/layouts/Canvas.svelte';
import { viewport } from '../../src/lib/stores/viewport';
import { findShape, leaves, pathTo, maxDepth, resolveHit, MAX_GROUP_DEPTH } from '../../src/lib/utils/tree';
import { importSvg } from '../../src/lib/utils/svgImport';
import { rotatePoint } from '../../src/lib/utils/math';

const st = { fill: '#336699', stroke: '#000000', strokeWidth: 2 };
const doc = (o: Partial<DocumentState> = {}): DocumentState => ({ ...emptyDocument(), ...o });
const T = (family: string, text: string, extra: Record<string, unknown> = {}) =>
  makeText(0, 50, text, { ...DEFAULT_TEXT_PROPS, fontFamily: family, fontSize: 40, ...extra } as any, { fill: '#000', stroke: 'none', strokeWidth: 0 });

import { makeGroup, ungroupShape, getRotationOrigin, getLocalBounds, centerOf } from '../../src/lib/utils/shapes';

const shapes = () => documentStore.get().shapes;
const hist = () => get(historyPast).length;
const grp = (s: Shape) => s as GroupShape;

beforeEach(() => { editor.newDocument(800, 600); ui.set({ tool: 'transform', snapEnabled: false }); });

function twoRects() {
  const a = makeRect(0, 0, 100, 50, st), b = makeRect(200, 100, 40, 40, st);
  editor.addShapes([a, b]);
  return [a, b];
}

describe('export settings', () => {
  it('any stored value becomes complete, valid settings', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings('junk')).toEqual(DEFAULT_SETTINGS);
    const s = sanitizeSettings({ svg: { area: 'nope', padding: -5, google: { include: 'linked', coverage: 'x' }, local: { include: 'embedded' } }, raster: { size: 'width', width: 1e9, quality: 0, scale: 'a' } });
    expect(s.general.area).toBe('canvas');                                      // old layout: area lived in svg
    expect(s.general.padding).toBe(0);
    expect(s.svg.google).toEqual({ include: 'linked', coverage: 'used' });
    expect(s.svg.local.include).toBe('embedded');
    expect(s.raster).toMatchObject({ size: 'width', width: 16384, quality: 1, scale: DEFAULT_SETTINGS.raster.scale });
    // older files: area / background in svg, local fonts under `system`
    const old = sanitizeSettings({ svg: { area: 'content', padding: 12, background: false, system: { include: 'embedded' } } });
    expect(old.general).toEqual({ area: 'content', padding: 12, background: false });
    expect(old.svg.local.include).toBe('embedded');
  });
});

describe('export area ("fit around objects")', () => {
  it('content box includes half the stroke; padding grows it; no content = the page', () => {
    const d = doc({ shapes: [makeRect(100, 50, 40, 20, { ...st, strokeWidth: 10 })] });
    expect(contentBounds(d.shapes)).toEqual({ x: 95, y: 45, width: 50, height: 30 });
    expect(exportArea(d, 'content', 5)).toEqual({ x: 90, y: 40, width: 60, height: 40 });
    expect(exportArea(d, 'canvas', 5)).toEqual({ x: 0, y: 0, width: 800, height: 600 });
    expect(exportArea(doc(), 'content', 5)).toEqual({ x: 0, y: 0, width: 800, height: 600 });
    expect(exportArea(doc({ shapes: [{ ...makeRect(0, 0, 9, 9, st), visible: false }] }), 'content', 0)).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  });
  it('the SVG gets that box as its viewBox and size; background covers it', () => {
    const d = doc({ shapes: [makeRect(100, 50, 40, 20, { ...st, strokeWidth: 0 })] });
    const svg = buildSvgDocument(d, { viewBox: exportArea(d, 'content', 10) });
    expect(svg).toContain('width="60" height="40" viewBox="90 40 60 40"');
    expect(svg).toContain('<rect x="90" y="40" width="60" height="40" fill="#ffffff"/>');
  });
});

describe('raster size wishes', () => {
  it('scale / width / default', () => {
    expect(exportSize(800, 600, { scale: 2 })).toMatchObject({ width: 1600, height: 1200, limited: false });
    expect(exportSize(800, 600, { width: 1000 })).toMatchObject({ width: 1000, height: 750 });
    expect(exportSize(800, 600)).toMatchObject({ width: 4000, height: 3000 });
    const big = exportSize(8000, 8000, { scale: 16 });
    expect(big.limited).toBe(true);
    expect(big.width * big.height).toBeLessThanOrEqual(268_000_000);
    expect(() => exportSize(0, 5, { scale: 2 })).toThrow();
  });
});

describe('background', () => {
  it('custom color, transparent, JPG fill, and the include-background switch', () => {
    const d = doc({ background: 'custom', bgColor: '#12ab34' });
    expect(backgroundColor(d)).toBe('#12ab34');
    expect(buildSvgDocument(d)).toContain('fill="#12ab34"');
    expect(backgroundColor(doc({ background: 'transparent-light' }))).toBeNull();
    expect(backgroundColor(doc({ background: 'transparent-light' }), true)).toBe('#ffffff');
    expect(buildSvgDocument(d, { background: false })).not.toContain('<rect');
    expect(buildSvgDocument(d, { background: false, opaque: true })).toContain('fill="#ffffff"');       // JPEG: never transparent
  });
  it('the image fit becomes preserveAspectRatio', () => {
    const img = 'data:image/png;base64,AAAA';
    expect(buildSvgDocument(doc({ bgImage: img }))).toContain('preserveAspectRatio="xMidYMid slice"');
    expect(buildSvgDocument(doc({ bgImage: img, bgFit: 'contain' }))).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(buildSvgDocument(doc({ bgImage: img, bgFit: 'stretch' }))).toContain('preserveAspectRatio="none"');
    expect(buildSvgDocument(doc({ bgImage: img }), { background: false })).not.toContain('<image');
  });
  it('survives save / load; hostile values are ignored', () => {
    const d = doc({ background: 'custom', bgColor: '#AA00BB', bgFit: 'contain' });
    const back = parseProject(serializeProject(d));
    expect(back).toMatchObject({ background: 'custom', bgColor: '#aa00bb', bgFit: 'contain' });
    const evil = JSON.parse(serializeProject(d)); evil.doc.bgColor = 'url(javascript:1)'; evil.doc.bgFit = 'x';
    const b2 = parseProject(JSON.stringify(evil));
    expect(b2.bgColor).toBeUndefined(); expect(b2.bgFit).toBeUndefined();
  });
  it('scalable SVG has a viewBox and no fixed size', () => {
    const svg = buildSvgDocument(doc(), { scalable: true });
    expect(svg).toContain('viewBox="0 0 800 600"');
    expect(svg).not.toMatch(/<svg[^>]* width=/);
  });
});

describe('fit canvas to content', () => {
  beforeEach(() => editor.newDocument(800, 600));
  it('shrinks the canvas around the objects, moves them inside, one undo step', () => {
    editor.addShape(makeRect(300, 200, 100, 50, { ...st, strokeWidth: 0 }));
    editor.fitCanvasToContent(20);
    const d = documentStore.get();
    expect([d.width, d.height]).toEqual([140, 90]);
    expect(getWorldBounds(d.shapes[0])).toMatchObject({ x: 20, y: 20, width: 100, height: 50 });
    editor.undo();
    expect(documentStore.get()).toMatchObject({ width: 800, height: 600 });
    expect(getWorldBounds(documentStore.get().shapes[0]).x).toBe(300);
  });
  it('does nothing without content', () => {
    editor.fitCanvasToContent(20);
    expect(documentStore.get()).toMatchObject({ width: 800, height: 600 });
  });
});

describe('font export per source', () => {
  it('Google linked: an @import with the styles that exist and the used characters; nothing embedded', async () => {
    const r = await embedFontCss([T('Roboto', 'Hello'), T('Roboto', 'Hi', { fontWeight: 700 })], { google: { include: 'linked', coverage: 'used' }, local: { include: 'reference' } });
    expect(r.css).toBe("@import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;700&text=Heilo&display=swap');");
    expect(r.css).not.toContain('base64');
    expect(r.warnings).toEqual([]);                                              // the dialog explains linking; no toast
  });
  it('Google linked, full subset: no text= parameter', async () => {
    const r = await embedFontCss([T('Roboto', 'Hello')], { google: { include: 'linked', coverage: 'full' }, local: { include: 'reference' } });
    expect(r.css).toBe("@import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400&display=swap');");
  });
  it('Google embedded, full subset = the old "subset" strategy', async () => {
    const r = await embedFontCss([T('Roboto', 'Hello')], { google: { include: 'embedded', coverage: 'full' }, local: { include: 'reference' } });
    expect(r.css).toContain('unicode-range');
    expect(r.css).toContain('base64,');
  });
  it('text to paths ignores the font options entirely', async () => {
    const d = doc({ shapes: [T('Roboto', 'Hello')] });
    const a = await buildSvgFromSettings(d, { ...svgSettingsOf(DEFAULT_SETTINGS), textToPaths: true });
    expect(a.svg).toContain('<path');
    expect(a.svg).not.toContain('<text');
    expect(a.svg).not.toContain('@font-face');
    const b = await buildSvgFromSettings(d, svgSettingsOf(DEFAULT_SETTINGS));
    expect(b.svg).toContain('<text');
    expect(b.svg).toContain('@font-face');
  });
  it('fit-around-objects through the whole pipeline', async () => {
    const d = doc({ shapes: [makeEllipse(300, 300, 50, 50, { ...st, strokeWidth: 0 })] });
    const { svg } = await buildSvgFromSettings(d, { ...svgSettingsOf(DEFAULT_SETTINGS), area: 'content', padding: 10, scalable: true });
    expect(svg).toContain('viewBox="240 240 120 120"');
    expect(svg).not.toMatch(/<svg[^>]* width=/);
  });
});

describe('PNG / JPG export size', () => {
  it('scales up to 4000 px wide, keeps the aspect ratio', () => {
    expect(exportSize(800, 600)).toMatchObject({ width: 4000, height: 3000, scale: 5, limited: false });
    expect(exportSize(1, 1)).toMatchObject({ width: 4000, height: 4000 });
    expect(exportSize(3999, 1000)).toMatchObject({ width: 4000, height: 1000 });
    expect(exportSize(1234, 777)).toMatchObject({ width: 4000, height: Math.round(777 * 4000 / 1234) });
  });
  it('wide documents are exported as they are', () => {
    expect(exportSize(4000, 100)).toMatchObject({ width: 4000, height: 100, scale: 1, limited: false });
    expect(exportSize(6000, 4000)).toMatchObject({ width: 6000, height: 4000, scale: 1 });
  });
  it('very tall / huge documents are scaled down to the canvas limits (with `limited`); nonsense sizes are refused', () => {
    const r = exportSize(100, 1000);
    expect(r.limited).toBe(true); expect(r.height).toBeLessThanOrEqual(MAX_RASTER_SIDE); expect(r.width).toBeGreaterThanOrEqual(100);
    const huge = exportSize(20000, 20000);
    expect(huge.limited).toBe(true); expect(huge.width * huge.height).toBeLessThanOrEqual(268_000_000);
    expect(() => exportSize(0, 5)).toThrow();
  });
});

describe('SVG export variants', () => {
  const doc = () => ({ ...documentStore.get(), shapes: [makeText(10, 50, 'Hi ő', { ...DEFAULT_TEXT_PROPS, fontFamily: 'Roboto', fontSize: 40 }, st)] });
  it('"embed" keeps <text> and inlines the font files; "outline" has no text and no font at all', async () => {
    const e = await buildSvgFile(doc(), { text: 'embed' });
    expect(e.svg).toContain('<text'); expect(e.svg).toContain('@font-face'); expect(e.svg).not.toMatch(/url\(\s*['"]?https?:/); expect(e.svg).not.toContain('@import');
    const o = await buildSvgFile(doc(), { text: 'outline' });
    expect(o.svg).not.toContain('<text'); expect(o.svg).not.toContain('@font-face'); expect(o.svg).toContain('<path');
    expect(new DOMParser().parseFromString(o.svg, 'image/svg+xml').querySelector('parsererror')).toBeNull();
  });
  it('outlining a font that is not available keeps the text and says why (no look-alike)', async () => {
    const d = { ...doc(), shapes: [makeText(0, 30, 'x', { ...DEFAULT_TEXT_PROPS, fontFamily: 'Georgia' }, st)] };
    const o = await buildSvgFile(d, { text: 'outline' });
    expect(o.svg).toContain('<text');
    expect(o.warnings.join(' ')).toMatch(/Georgia.*not a Google font/);
  });
});
