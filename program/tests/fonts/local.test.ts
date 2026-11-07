// @vitest-environment jsdom
// Local fonts (Local Font Access API).
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { Blob as NodeBlob } from 'node:buffer';
import { styleTraits, pickFace, type LocalFace, type FontDataLike } from '../../src/lib/fonts/local';
import { localFonts, enableLocalFonts, ensureGoogleCatalog } from '../../src/lib/fonts/state';
import { sourceOf, resolveSource } from '../../src/lib/fonts/sources';
import { getOutlineFont, FontUnavailable, clearOutlineCache } from '../../src/lib/fonts/outlineFont';
import { outlineText } from '../../src/lib/utils/textOutline';
import { makeText } from '../../src/lib/utils/shapes';
import { DEFAULT_TEXT_PROPS } from '../../src/lib/utils/text';
import { pathBounds } from '../../src/lib/utils/path';
import { fixture, net } from '../helpers/fakeGoogle';

const bytes = (name: string) => new NodeBlob([fixture(name)]) as unknown as Blob;
const data = (family: string, style: string, file: string, ps = `${family}-${style}`.replace(/\s/g, '')): FontDataLike =>
  ({ family, style, fullName: `${family} ${style}`, postscriptName: ps, blob: async () => bytes(file) });

const T = (family: string, extra: Record<string, unknown> = {}, text = 'HH') =>
  makeText(0, 100, text, { ...DEFAULT_TEXT_PROPS, fontFamily: family, fontSize: 100, ...extra } as any, { fill: '#000', stroke: 'none', strokeWidth: 0 });

describe('style names → weight / italic', () => {
  it('reads the usual words', () => {
    expect(styleTraits('Regular')).toEqual({ weight: 400, italic: false });
    expect(styleTraits('Bold Italic')).toEqual({ weight: 700, italic: true });
    expect(styleTraits('Semibold')).toEqual({ weight: 600, italic: false });
    expect(styleTraits('ExtraBold Oblique')).toEqual({ weight: 800, italic: true });
    expect(styleTraits('Light')).toEqual({ weight: 300, italic: false });
    expect(styleTraits('Black')).toEqual({ weight: 900, italic: false });
    expect(styleTraits('Whatever')).toEqual({ weight: 400, italic: false });
  });
  it('picks the face nearest to the wanted weight and slant, avoiding condensed cuts', () => {
    const f = (style: string): LocalFace => ({ family: 'X', style, fullName: style, postscriptName: style, ...styleTraits(style) });
    const faces = [f('Regular'), f('Italic'), f('Bold'), f('Condensed Bold'), f('Light')];
    expect(pickFace(faces, 700, false)!.face.style).toBe('Bold');
    expect(pickFace(faces, 400, true)!.face.style).toBe('Italic');
    expect(pickFace(faces, 700, true)!.exact).toBe(false);                      // no bold italic → some italic, flagged
    expect(pickFace([f('Light'), f('Medium')], 400, false)!.face.style).toBe('Medium');
    expect(pickFace([], 400, false)).toBeNull();
  });
});

describe('local fonts (Local Font Access)', () => {
  beforeAll(async () => {
    (window as any).queryLocalFonts = async () => [
      data('Fake Sans', 'Regular', 'roboto-400.ttf'),
      data('Fake Sans', 'Bold', 'roboto-700.ttf'),
      data('Roboto', 'Regular', 'roboto-400.ttf'),
      data('Collection', 'Regular', 'roboto-400.ttf', 'Collection-Regular'),
    ];
    await ensureGoogleCatalog(true);
  });
  beforeEach(() => clearOutlineCache());

  it('lists installed families once the user allows it', async () => {
    await enableLocalFonts();
    const s = get(localFonts);
    expect(s.status).toBe('ready');
    expect(s.hasFiles).toBe(true);
    expect(s.families).toEqual(['Collection', 'Fake Sans', 'Roboto']);
  });

  it('resolves the source of a name (Google wins when a family is both)', async () => {
    expect(sourceOf('Fake Sans')).toBe('local');
    expect(sourceOf('Roboto')).toBe('google');
    expect(sourceOf('sans-serif')).toBe('generic');
    expect(sourceOf('Nope Nope')).toBe('unknown');
    expect(await resolveSource('fake sans')).toBe('local');                    // case-insensitive
  });

  it('outlines a local font from its file; bold picks the bold face', async () => {
    net.log.length = 0;
    const reg = (await outlineText(T('Fake Sans')))!;
    const bold = (await outlineText(T('Fake Sans', { fontWeight: 700 })))!;
    expect(reg.font.source).toBe('local');
    expect(reg.font.approximated).toBe(false);
    expect(pathBounds(bold.nodes, true).width).toBeGreaterThan(pathBounds(reg.nodes, true).width);
    expect(net.log.filter(u => u.includes('googleapis'))).toEqual([]);          // never asked Google
    const italic = await getOutlineFont({ ...T('Fake Sans'), fontStyle: 'italic' } as any);
    expect(italic.approximated).toBe(true);                                     // no italic face installed
  });

  it('offline: a Google family that is also installed is outlined from the installed copy', async () => {
    net.offline = true;
    const r = (await outlineText(T('Roboto', {}, 'Zz')))!;
    expect(r.font.source).toBe('local');
    net.offline = false;
  });

  it('offline: a Google family that is NOT installed says Google was unreachable', async () => {
    net.offline = true;
    await expect(getOutlineFont(T('Inter') as any)).rejects.toThrow(/Google Fonts could not be reached/);
    net.offline = false;
  });

  it('a file that is not a font: clear message, no crash', async () => {
    (window as any).queryLocalFonts = async () => [{ ...data('Broken', 'Regular', 'roboto-400.ttf'), blob: async () => new NodeBlob([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])]) }];
    await enableLocalFonts();
    await expect(getOutlineFont(T('Broken') as any)).rejects.toThrow(/"Broken" could not be read/);
  });
});

describe('browsers without the API', () => {
  it('only detected family names exist: displayed fine, but converting says why it cannot', async () => {
    const { setLocalFamilies } = await import('../../src/lib/fonts/registry');
    setLocalFamilies(['Arial']);
    expect(sourceOf('Arial')).toBe('local');
    await expect(getOutlineFont(T('Arial') as any)).rejects.toThrow(/does not let web pages read font files/);
    await expect(getOutlineFont(T('Arial') as any)).rejects.toBeInstanceOf(FontUnavailable);
  });
});

describe('local fonts in an exported SVG', () => {
  it('reference (default): nothing is embedded; embedded: the whole file, with a licence note', async () => {
    (window as any).queryLocalFonts = async () => [data('Fake Sans', 'Regular', 'roboto-400.ttf'), data('Coll', 'Regular', 'roboto-400.ttf', 'Coll-Regular')];
    await enableLocalFonts();
    const { embedFontCss } = await import('../../src/lib/fonts/embed');
    const ref = await embedFontCss([T('Fake Sans', {}, 'Hi')], { google: { include: 'embedded', coverage: 'used' }, local: { include: 'reference' } });
    expect(ref).toEqual({ css: '', warnings: [] });
    const emb = await embedFontCss([T('Fake Sans', {}, 'Hi')], { google: { include: 'embedded', coverage: 'used' }, local: { include: 'embedded' } });
    expect(emb.css).toContain("font-family: 'Fake Sans'");
    expect(emb.css).toContain('data:font/ttf;base64,');
    expect(emb.css).toContain("format('truetype')");
    expect(emb.warnings).toEqual([]);                                             // the dialog already says it is the whole file
  });
  it('a browser that cannot read font files keeps it a reference, with a warning', async () => {
    const { setLocalFamilies } = await import('../../src/lib/fonts/registry');
    setLocalFamilies(['Arial']);
    const { embedFontCss } = await import('../../src/lib/fonts/embed');
    const r = await embedFontCss([T('Arial', {}, 'Hi')], { google: { include: 'embedded', coverage: 'used' }, local: { include: 'embedded' } });
    expect(r.css).toBe('');
    expect(r.warnings.join(' ')).toMatch(/does not let pages read font files/);
  });
});
