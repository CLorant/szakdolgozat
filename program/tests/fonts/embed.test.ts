// Embedding fonts in exported SVG.
import { describe, it, expect } from 'vitest';
import { embedFontCss } from '../../src/lib/fonts/embed';
import { buildSvgFile } from '../../src/lib/utils/exportDoc';
import { emptyDocument } from '../../src/lib/stores/document';
import { makeText } from '../../src/lib/utils/shapes';
import { DEFAULT_TEXT_PROPS } from '../../src/lib/utils/text';
import { net } from '../helpers/fakeGoogle';

const T = (family: string, text: string, extra: Record<string, unknown> = {}) =>
  makeText(0, 50, text, { ...DEFAULT_TEXT_PROPS, fontFamily: family, fontSize: 40, ...extra } as any, { fill: '#000', stroke: 'none', strokeWidth: 0 });
const css = () => net.log.filter(u => u.includes('fonts.googleapis.com'));

describe('embedding Google fonts', () => {
  it("'text': one tiny block per style, as a data: URI, no network reference in the output", async () => {
    net.log.length = 0;
    const r = await embedFontCss([T('Roboto', 'Hello ő'), T('Roboto', 'Bye', { fontWeight: 700 })], 'text');
    expect(r.warnings).toEqual([]);
    expect(r.css.match(/@font-face/g)).toHaveLength(2);
    expect(r.css).toContain("font-family: 'Roboto'");
    expect(r.css).toContain('font-weight: 700');
    expect(r.css).toContain('data:font/woff2;base64,');
    expect(r.css).not.toMatch(/https?:/);
    expect(r.css).not.toContain('unicode-range');                                // the file already holds only these characters
    expect(css()).toEqual([
      'https://fonts.googleapis.com/css2?family=Roboto:wght@400&text=%20Helo%C5%91&display=swap',
      'https://fonts.googleapis.com/css2?family=Roboto:wght@700&text=Bey&display=swap',
    ]);
  });

  it("'subset': whole script subsets, only the ones the text needs, with their unicode-range", async () => {
    const latin = await embedFontCss([T('Roboto', 'Hello')], 'subset');
    expect(latin.css.match(/@font-face/g)).toHaveLength(1);
    expect(latin.css).toContain('unicode-range: U+0000-00FF');
    const hu = await embedFontCss([T('Roboto', 'Hello ő')], 'subset');
    expect(hu.css.match(/@font-face/g)).toHaveLength(2);                         // latin + latin-ext
    expect(hu.css).toContain('U+0100-02BA');
    const onlyExt = await embedFontCss([T('Roboto', 'őű')], 'subset');           // no space → the latin block is not needed
    expect(onlyExt.css.match(/@font-face/g)).toHaveLength(1);
    expect(onlyExt.css).toContain('U+0100-02BA');
  });

  it('a style Google does not have embeds the nearest one and says so', async () => {
    const r = await embedFontCss([T('Abril Fatface', 'Hi', { fontWeight: 700 })], 'text');
    expect(r.css.match(/@font-face/g)).toHaveLength(1);
    expect(r.css).toContain('font-weight: 400');
    expect(r.warnings.join()).toMatch(/Abril Fatface has no bold style/);
  });

  it('same style used by several texts → one block', async () => {
    const r = await embedFontCss([T('Roboto', 'a'), T('Roboto', 'b'), T('roboto', 'c')], 'subset');
    expect(r.css.match(/@font-face/g)).toHaveLength(1);
  });

  it('hidden texts are not embedded', async () => {
    const r = await embedFontCss([{ ...T('Roboto', 'a'), visible: false }], 'text');
    expect(r.css).toBe('');
  });

  it('local / unknown fonts are not embedded (licences) and the user is told; generic families need nothing', async () => {
    const r = await embedFontCss([T('Georgia', 'x'), T('sans-serif', 'y'), T('Nope', 'z')], 'text');
    expect(r.css).toBe('');
    expect(r.warnings).toHaveLength(2);
    expect(r.warnings.join(' ')).toMatch(/"Georgia" is not a Google font/);
    expect(r.warnings.join(' ')).not.toMatch(/sans-serif/);
  });

  it('offline: no embedding, one warning per family, export still produced', async () => {
    await embedFontCss([T('Roboto', 'warm')], 'text');                           // catalog cached
    net.offline = true;
    const r = await embedFontCss([T('Inter', 'abc')], 'text');
    expect(r.css).toBe('');
    expect(r.warnings.join()).toMatch(/Inter.*could not be embedded/);
    net.offline = false;
  });

  it('an exported SVG contains the style block and stays valid XML text', async () => {
    const doc = { ...emptyDocument(), shapes: [T('Roboto', 'a < b & c')] };
    const { svg, warnings } = await buildSvgFile(doc, { text: 'embed', embed: 'text' });
    expect(warnings).toEqual([]);
    expect(svg).toContain('<style><![CDATA[');
    expect(svg).toContain('data:font/woff2;base64,');
    expect(svg).toContain('a &lt; b &amp; c');
  });
});
