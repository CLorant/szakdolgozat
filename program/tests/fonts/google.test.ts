// @vitest-environment jsdom
// Google Fonts: CSS2 requests, responses, catalog, style fallback.
import { describe, it, expect, beforeEach } from 'vitest';
import { axisSpec, cssUrl, textParam, parseFontFaces, rangeMatches, codePointsOf } from '../../src/lib/fonts/googleCss';
import { parseCatalog, loadCatalog, CATALOG_URL, CATALOG_TTL_MS, clearCatalogCache } from '../../src/lib/fonts/catalog';
import { fallbackChain, fetchStyle, FontNotFound } from '../../src/lib/fonts/google';
import { setFontFetch } from '../../src/lib/fonts/net';
import { net, FAKE_CATALOG } from '../helpers/fakeGoogle';

describe('CSS2 URL builder', () => {
  it('writes axes the way the API wants them (alphabetical tags, numerically sorted tuples)', () => {
    expect(axisSpec(undefined)).toBe('');
    expect(axisSpec([{ weight: 700, italic: false }, { weight: 400, italic: false }])).toBe(':wght@400;700');
    expect(axisSpec([{ weight: 700, italic: true }, { weight: 400, italic: false }])).toBe(':ital,wght@0,400;1,700');
    expect(axisSpec([{ weight: 400, italic: true }])).toBe(':ital,wght@1,400');
  });
  it('encodes names with + for spaces, sorts several families, adds text and display', () => {
    const u = cssUrl([{ family: 'Open Sans', styles: [{ weight: 700, italic: false }] }, { family: 'ABeeZee' }], { text: 'Hé &' });
    expect(u).toBe('https://fonts.googleapis.com/css2?family=ABeeZee&family=Open+Sans:wght@700&text=H%C3%A9%20%26&display=swap');
  });
  it('text= is unique, sorted, free of line breaks; null when empty or too long for a URL', () => {
    expect(textParam('Hello\nWorld')).toBe('HWdelor');
    expect(textParam('b a\nb')).toBe(' ab');
    expect(textParam([0x151, 0x41])).toBe('Aő');
    expect(textParam('\n\t')).toBeNull();
    const cjk = Array.from({ length: 900 }, (_, i) => 0x4e00 + i);
    expect(textParam(cjk)).toBeNull();
    expect(textParam(Array.from({ length: 900 }, (_, i) => 0x20 + (i % 90)))).not.toBeNull();   // ASCII is cheap to encode
  });
});

describe('CSS2 response parser', () => {
  const css = `/* latin-ext */
@font-face {
  font-family: 'Roboto';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/roboto/v30/ext.woff2) format('woff2');
  unicode-range: U+0100-02BA, U+1E00-1EFF;
}
/* latin */
@font-face {
  font-family: 'Roboto';
  font-style: italic;
  font-weight: 100 900;
  src: url("https://fonts.gstatic.com/s/roboto/v30/latin.woff2") format('woff2');
  unicode-range: U+0000-00FF;
}
@font-face { font-family: 'Evil'; src: url(https://evil.example/x.woff2) format('woff2'); }
@font-face { font-family: 'Plain'; src: url(http://fonts.gstatic.com/s/x.ttf) format('truetype'); }`;
  it('reads family, style, weight, range, subset label, url and format; ignores files from other hosts / plain http', () => {
    const r = parseFontFaces(css);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ family: 'Roboto', style: 'normal', weight: '400', subset: 'latin-ext', format: 'woff2', unicodeRange: 'U+0100-02BA, U+1E00-1EFF' });
    expect(r[1]).toMatchObject({ style: 'italic', weight: '100 900', subset: 'latin', url: 'https://fonts.gstatic.com/s/roboto/v30/latin.woff2' });
  });
  it('matches unicode ranges (Hungarian ő is latin-ext)', () => {
    const o = new Set(['ő'.codePointAt(0)!]);
    expect(rangeMatches('U+0100-02BA, U+1E00-1EFF', o)).toBe(true);
    expect(rangeMatches('U+0000-00FF, U+0131', o)).toBe(false);
    expect(rangeMatches('U+0000-00FF, U+0131', codePointsOf('a'))).toBe(true);
    expect(rangeMatches('U+4??', new Set([0x4ff]))).toBe(true);
    expect(rangeMatches(null, new Set())).toBe(true);
  });
});

describe('catalog', () => {
  beforeEach(() => clearCatalogCache());
  it('understands the dev mirror, a plain array and the official API shape', () => {
    expect(parseCatalog({ fonts: ['B', 'A', 'A'] })).toEqual(['A', 'B']);
    expect(parseCatalog(['x'])).toEqual(['x']);
    expect(parseCatalog({ kind: 'webfonts#webfontList', items: [{ family: 'Zed', variants: ['regular'] }, { family: 'Abc' }] })).toEqual(['Abc', 'Zed']);
    expect(() => parseCatalog({ nope: 1 })).toThrow(/format/);
    expect(() => parseCatalog({ fonts: [] })).toThrow(/empty/);
  });
  it('is fetched once, then served from the cache', async () => {
    const a = await loadCatalog();
    expect(a).toEqual({ names: FAKE_CATALOG, stale: false });
    net.log.length = 0;
    const b = await loadCatalog();
    expect(b.names).toEqual(FAKE_CATALOG);
    expect(net.log).toEqual([]);                                                       // no second request
  });
  it('an expired cache is refreshed; if the network is down it is still used (stale)', async () => {
    localStorage.setItem('svge.googleFontCatalog.v1', JSON.stringify({ at: Date.now() - CATALOG_TTL_MS - 1000, names: ['Old Font'] }));
    net.failCatalog = true;
    expect(await loadCatalog()).toEqual({ names: ['Old Font'], stale: true });
    net.failCatalog = false;
    expect((await loadCatalog()).names).toEqual(FAKE_CATALOG);
    expect(JSON.parse(localStorage.getItem('svge.googleFontCatalog.v1')!).names).toEqual(FAKE_CATALOG);
  });
  it('without cache and without network it fails', async () => {
    net.offline = true;
    await expect(loadCatalog()).rejects.toThrow();
    expect(net.log).toContain(CATALOG_URL);
  });
});

describe('style requests', () => {
  it('walks the fallback chain', () => {
    const k = (c: ReturnType<typeof fallbackChain>) => c.map(s => (s ? `${s.weight}${s.italic ? 'i' : ''}` : 'default'));
    expect(k(fallbackChain({ weight: 700, italic: true }))).toEqual(['700i', '700', '400i', '400', 'default']);
    expect(k(fallbackChain({ weight: 400, italic: false }))).toEqual(['400', 'default']);
  });
  it('returns the exact style when the family has it', async () => {
    const r = await fetchStyle('Roboto', { weight: 700, italic: false });
    expect(r).toMatchObject({ actual: { weight: 700, italic: false }, approximated: false });
    expect(r.rules).toHaveLength(1);
  });
  it('a missing style is an HTTP 400 for the request: fall back and report it', async () => {
    const abril = await fetchStyle('Abril Fatface', { weight: 700, italic: true });
    expect(abril).toMatchObject({ actual: { weight: 400, italic: false }, approximated: true });
    const roboto = await fetchStyle('Roboto', { weight: 700, italic: true });
    expect(roboto).toMatchObject({ actual: { weight: 700, italic: false }, approximated: true });
  });
  it('unknown family → FontNotFound; no network → the network error (not "not found")', async () => {
    await expect(fetchStyle('Aaa Missing', { weight: 400, italic: false })).rejects.toBeInstanceOf(FontNotFound);
    net.offline = true;
    const e = await fetchStyle('Roboto', { weight: 400, italic: true }).catch(x => x);
    expect(e).toBeInstanceOf(TypeError);
    expect(e).not.toBeInstanceOf(FontNotFound);
  });
  it('the request for text= carries the text', async () => {
    net.log.length = 0;
    await fetchStyle('Roboto', { weight: 400, italic: false }, 'Hej');
    expect(net.log[0]).toBe('https://fonts.googleapis.com/css2?family=Roboto:wght@400&text=Hej&display=swap');
  });
});
