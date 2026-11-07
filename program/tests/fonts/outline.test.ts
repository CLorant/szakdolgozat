// Font files for text → path.
import { describe, it, expect, beforeEach } from 'vitest';
import { outlineText, mixesDirections, textToPathShape } from '../../src/lib/utils/textOutline';
import { outlineTexts } from '../../src/lib/utils/exportDoc';
import { getOutlineFont, prefetchOutlineFonts, clearOutlineCache, FontUnavailable } from '../../src/lib/fonts/outlineFont';
import { makeText } from '../../src/lib/utils/shapes';
import { DEFAULT_TEXT_PROPS } from '../../src/lib/utils/text';
import { pathBounds, contours } from '../../src/lib/utils/path';
import { net } from '../helpers/fakeGoogle';

const T = (family: string, text: string, extra: Record<string, unknown> = {}) =>
  makeText(0, 100, text, { ...DEFAULT_TEXT_PROPS, fontFamily: family, fontSize: 100, ...extra } as any, { fill: '#000', stroke: 'none', strokeWidth: 0 });
const css = () => net.log.filter(u => u.includes('fonts.googleapis.com'));
const files = () => net.log.filter(u => u.includes('fonts.gstatic.com'));

beforeEach(() => clearOutlineCache());

describe('outlines from Google Fonts', () => {
  it('asks for exactly the characters used (text=) and gets one font file', async () => {
    net.log.length = 0;
    const r = (await outlineText(T('Roboto', 'Hello')))!;
    expect(r.font).toMatchObject({ family: 'Roboto', source: 'google', approximated: false });
    expect(css()).toEqual(['https://fonts.googleapis.com/css2?family=Roboto:wght@400&text=Helo&display=swap']);
    expect(files()).toHaveLength(1);
  });

  it('the same text twice costs no second request; a text with fewer characters reuses the font', async () => {
    await outlineText(T('Roboto', 'Hello'));
    net.log.length = 0;
    await outlineText(T('Roboto', 'Hello'));
    await outlineText(T('Roboto', 'oll'));
    expect(css()).toEqual([]);
  });

  it('a whole document costs ONE download per font style (union of the characters)', async () => {
    const shapes = [T('Roboto', 'abc'), T('Roboto', 'xyz', { fontSize: 30 }), T('Roboto', 'bold!', { fontWeight: 700 })];
    net.log.length = 0;
    const r = await outlineTexts(shapes);
    expect(r.shapes.every(s => s.type === 'path')).toBe(true);
    expect(css()).toEqual([
      'https://fonts.googleapis.com/css2?family=Roboto:wght@400&text=abcxyz&display=swap',
      'https://fonts.googleapis.com/css2?family=Roboto:wght@700&text=!bdlo&display=swap',
    ]);
  });

  it('prefetch never throws (errors show up per text)', async () => {
    await expect(prefetchOutlineFonts([T('No Such Font', 'a') as any])).resolves.toBeUndefined();
  });

  it('draws Hungarian ő ű from the font Google cut for them', async () => {
    const r = (await outlineText(T('Roboto', 'őű')))!;
    expect(r.missing).toBe(0);
    expect(contours(r.nodes).length).toBeGreaterThanOrEqual(2);
  });

  it('variable fonts: the weight axis is applied to outlines AND advances', async () => {
    const reg = (await outlineText(T('Inter', 'HHHH')))!;
    const bold = (await outlineText(T('Inter', 'HHHH', { fontWeight: 700 })))!;
    expect(reg.font.approximated).toBe(false);
    expect(bold.font.approximated).toBe(false);
    const wr = pathBounds(reg.nodes, true).width, wb = pathBounds(bold.nodes, true).width;
    expect(wb).toBeGreaterThan(wr + 3);                                           // heavier stems, wider advances
    // a single glyph gets heavier too (stem width), not only moved apart
    const h1 = pathBounds((await outlineText(T('Inter', 'H', { fontWeight: 700 })))!.nodes, true).width;
    const h0 = pathBounds((await outlineText(T('Inter', 'H')))!.nodes, true).width;
    expect(h1).toBeGreaterThan(h0 + 3);
  });

  it('a slant the family lacks is synthesized (slanted like a browser does), without a warning', async () => {
    const r = (await outlineText(T('Inter', 'H', { fontStyle: 'italic' })))!;
    expect(r.font.approximated).toBe(true);
    expect(r.font.italic).toBe(false);
    const upright = pathBounds((await outlineText(T('Inter', 'H')))!.nodes, true);
    const slanted = pathBounds(r.nodes, true);
    expect(slanted.width).toBeGreaterThan(upright.width + slanted.height * 0.2);    // the top leans right by ¼ of the height
    const shape = (await textToPathShape(T('Inter', 'H', { fontStyle: 'italic' })))!;
    expect(shape.warnings).toEqual([]);
  });

  it('characters in no font are left out and reported (a fallback font is tried first); mixed-direction text is flagged', async () => {
    const r = (await outlineText(T('Roboto', 'a日b')))!;
    expect(r.missing).toBe(1);
    expect(mixesDirections('abc')).toBe(false);
    expect(mixesDirections('مرحبا')).toBe(false);
    expect(mixesDirections('שלום\nabc')).toBe(false);                        // different lines
    expect(mixesDirections('abc مرحبا')).toBe(true);
    expect(mixesDirections('Árvíztűrő tükörfúrógép ЖЩ 日本')).toBe(false);
    const w = (await textToPathShape(T('Roboto', 'a\u0645b')))!;
    expect(w.warnings.join(' ')).toMatch(/neither Roboto nor any fallback/);
    expect(w.warnings.join(' ')).toMatch(/mixes right-to-left/);
  });

  it('too many distinct characters for one request → a clear refusal, not a broken URL', async () => {
    const huge = Array.from({ length: 900 }, (_, i) => String.fromCodePoint(0x4e00 + i)).join('');
    await expect(outlineText(T('Roboto', huge))).rejects.toThrow(/too many different characters/);
  });
});

describe('fonts that cannot be outlined', () => {
  it('generic families use the bundled fonts (the ones the editor draws them with); emoji has none', async () => {
    const r = await getOutlineFont(T('sans-serif', 'a') as any);
    expect([r.family, r.source]).toEqual(['Noto Sans', 'bundled']);
    expect((await getOutlineFont(T('ui-serif', 'a') as any)).family).toBe('Noto Serif');
    await expect(getOutlineFont(T('emoji', 'a') as any)).rejects.toThrow(/generic family without a bundled font/);
  });
  it('unknown names: neither Google nor installed — and the picker is mentioned only where it could help', async () => {
    const e = await getOutlineFont(T('Georgia', 'a') as any).catch(x => x);
    expect(e).toBeInstanceOf(FontUnavailable);
    expect(e.message).toMatch(/"Georgia" is not a Google font and was not found among your local fonts/);
  });
  it('listed by Google but not served → FontUnavailable with the not-found message', async () => {
    await expect(getOutlineFont(T('Aaa Missing', 'a') as any)).rejects.toThrow(/not found on Google Fonts/);
  });
  it('offline → says so, and a later retry works', async () => {
    await outlineText(T('Roboto', 'a'));                                          // catalog is now known
    net.offline = true;
    await expect(getOutlineFont(T('Inter', 'zq') as any)).rejects.toThrow(/could not be reached/);
    net.offline = false;
    expect((await getOutlineFont(T('Inter', 'zq') as any)).family).toBe('Inter');
  });
});

describe('Google rejects a style: browsers see that as a network error (no CORS header on the 400)', () => {
  it('the style fallback chain still works', async () => {
    net.corsHides400 = true;
    const r = await getOutlineFont(T('Abril Fatface', 'H', { fontWeight: 700, fontStyle: 'italic' }) as any);
    expect(r.family).toBe('Abril Fatface');
    expect(r.approximated).toBe(true);
  });
  it('really offline is still reported as offline', async () => {
    net.corsHides400 = true; net.offline = true;
    await expect(getOutlineFont(T('Abril Fatface', 'Qx', { fontStyle: 'italic' }) as any)).rejects.toThrow(/could not be reached/);
  });
});
