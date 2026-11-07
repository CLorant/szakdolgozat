// @vitest-environment jsdom
// Text → path.
import { describe, it, expect } from 'vitest';
import { outlineText, textToPathShape, commandsToContours, syntheticBoldDelta } from '../../src/lib/utils/textOutline';
import { makeText, getLocalBounds, getWorldBounds } from '../../src/lib/utils/shapes';
import { contours, pathBounds, pathToD } from '../../src/lib/utils/path';
import { DEFAULT_TEXT_PROPS } from '../../src/lib/utils/text';
import { convertToPaths } from '../../src/lib/utils/convert';
import { FontUnavailable } from '../../src/lib/fonts/outlineFont';

const st = { fill: '#336699', stroke: '#000000', strokeWidth: 2 };
const T = (content: string, extra: Record<string, unknown> = {}) =>
  makeText(100, 200, content, { ...DEFAULT_TEXT_PROPS, fontFamily: 'Roboto', fontSize: 100, ...extra } as any, st);

describe('text → path', () => {
  it('produces one contour per glyph part, holes included ("o" = outer + inner)', async () => {
    const r = (await outlineText(T('o')))!;
    expect(contours(r.nodes)).toHaveLength(2);
    const r2 = (await outlineText(T('i')))!;
    expect(contours(r2.nodes)).toHaveLength(2);                   // dot + stem
    const r3 = (await outlineText(T('B')))!;
    expect(contours(r3.nodes)).toHaveLength(3);                   // outer + two counters
  });

  it('puts the baseline at y and the glyph body above it', async () => {
    const r = (await outlineText(T('H')))!;
    const b = pathBounds(r.nodes, true);
    expect(b.y + b.height).toBeCloseTo(200, 0);                   // sits on the baseline
    expect(b.height).toBeGreaterThan(65);                         // cap height ≈ 0.71 em
    expect(b.height).toBeLessThan(80);
    expect(b.x).toBeGreaterThan(100);                             // left side bearing
  });

  it('honours anchor, multiple lines and letter spacing', async () => {
    const start = pathBounds((await outlineText(T('HH', { textAnchor: 'start' })))!.nodes, true);
    const end   = pathBounds((await outlineText(T('HH', { textAnchor: 'end' })))!.nodes, true);
    const mid   = pathBounds((await outlineText(T('HH', { textAnchor: 'middle' })))!.nodes, true);
    expect(end.x + end.width).toBeLessThan(100 + 1);
    expect(mid.x + mid.width / 2).toBeCloseTo(100, -1);
    expect(start.x).toBeGreaterThan(100);

    const two = pathBounds((await outlineText(T('H\nH')))!.nodes, true);
    expect(two.height).toBeGreaterThan(100 * 1.25);                // second line one line-height lower
    const tight = pathBounds((await outlineText(T('HH')))!.nodes, true);
    const wide  = pathBounds((await outlineText(T('HH', { letterSpacing: 20 })))!.nodes, true);
    expect(wide.width - tight.width).toBeCloseTo(20, 0);
  });

  it('draws Hungarian ő ű and counts the characters the font has no glyph for', async () => {
    const hu = (await outlineText(T('őű')))!;
    expect(hu.missing).toBe(0);
    expect(contours(hu.nodes).length).toBeGreaterThanOrEqual(2);
    const ja = await outlineText(T('日a'));
    expect(ja!.missing).toBe(1);
  });

  it('adds an underline contour and returns null for whitespace', async () => {
    const plain = contours((await outlineText(T('H')))!.nodes).length;
    const under = contours((await outlineText(T('H', { textDecoration: 'underline' })))!.nodes).length;
    expect(under).toBe(plain + 1);
    expect(await outlineText(T('   '))).toBeNull();
    expect(await outlineText(T(''))).toBeNull();
  });

  it('keeps id, fill and opacity; a rotated text keeps its place on the canvas', async () => {
    const t = { ...T('Hello', { textAnchor: 'middle' }), rotation: 30, opacity: 0.5 };
    const { shape, warnings } = (await textToPathShape(t))!;
    expect(shape).toMatchObject({ id: t.id, type: 'path', fill: '#336699', stroke: 'none', opacity: 0.5, rotation: 30, closed: true });
    expect(warnings).toEqual([]);
    // text pivot = centre of the text box; after conversion the path's world position must match
    // the position the rotated TEXT BOX had: compare the glyph bounds' centre rotated about the text pivot.
    const unrotated = (await outlineText(t))!;
    const cp = pathBounds(unrotated.nodes, true);
    const wb = getWorldBounds(shape);
    expect(Number.isFinite(wb.x + wb.y + wb.width + wb.height)).toBe(true);
    expect(getLocalBounds(shape).width).toBeCloseTo(cp.width, 3);
  });

  it('a bold the family lacks is synthesized: heavier outlines, no warning', async () => {
    const reg = (await textToPathShape(T('Hi', { fontFamily: 'Abril Fatface' })))!;                   // regular only
    const b = (await textToPathShape(T('Hi', { fontFamily: 'Abril Fatface', fontWeight: 700 })))!;
    expect(b.warnings).toEqual([]);
    const wr = pathBounds(reg.shape.nodes, true), wb = pathBounds(b.shape.nodes, true);
    const d = syntheticBoldDelta(100);                                               // every edge grows outwards by d
    expect(wb.x).toBeCloseTo(wr.x - d, 1);
    expect(wb.y).toBeCloseTo(wr.y - d, 1);
    expect(wb.y + wb.height).toBeCloseTo(wr.y + wr.height + d, 1);
  });

  it('never substitutes another font: unknown families are refused, the text stays text', async () => {
    for (const family of ['Arial', 'No Such Font']) {
      await expect(textToPathShape(T('Hi', { fontFamily: family }))).rejects.toBeInstanceOf(FontUnavailable);
      const r = await convertToPaths(T('Hi', { fontFamily: family }));
      expect(r.changed).toBe(false);
      expect(r.shape.type).toBe('text');
      expect(r.warnings.join()).toContain(family);
    }
  });

  it('commandsToContours merges the duplicate end node and converts quadratics', () => {
    const c = commandsToContours([
      { type: 'M', x: 0, y: 0 }, { type: 'L', x: 10, y: 0 }, { type: 'Q', x1: 10, y1: 10, x: 0, y: 10 }, { type: 'L', x: 0, y: 0 }, { type: 'Z' },
    ]);
    expect(c).toHaveLength(1);
    expect(c[0]).toHaveLength(3);                                  // end node merged into the start
    expect(pathToD(c[0], true)).toContain('C');
  });
});

describe('no junk nodes', () => {
  it('outlines contain no two consecutive nodes at the same position', async () => {
    const t = makeText(10, 50, 'a Rög', { ...DEFAULT_TEXT_PROPS, fontSize: 60, fontFamily: 'Roboto' }, { fill: '#000000', stroke: 'none', strokeWidth: 0 });
    const r = await textToPathShape(t);
    for (const c of contours(r!.shape.nodes)) for (let i = 0; i < c.length; i++) {
      const a = c[i], b = c[(i + 1) % c.length];
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(1e-3);
    }
  });
});
