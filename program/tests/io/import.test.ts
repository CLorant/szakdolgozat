// @vitest-environment jsdom
// SVG import.
import { describe, it, expect } from 'vitest';
import { importSvg, normalizeColor } from '../../src/lib/utils/svgImport';
import { getLocalBounds, getRotationOrigin } from '../../src/lib/utils/shapes';
import { leaves } from '../../src/lib/utils/tree';

const wrap = (inner: string, attrs = '') => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ${attrs}>${inner}</svg>`;

describe('svg import', () => {
  it('rejects non-SVG input', () => {
    expect(() => importSvg('hello')).toThrow();
    expect(() => importSvg('<html></html>')).toThrow();
  });
  it('uses SVG defaults (black fill, no stroke) and inherits through groups', () => {
    const r = importSvg(wrap('<g fill="red" stroke="blue" stroke-width="4"><rect width="10" height="10"/><circle r="5" fill="green" style="stroke:#000"/></g><rect width="1" height="1"/>'));
    expect(r.shapes).toHaveLength(2);                          // <g> + the loose rect
    expect(r.shapes[0].type).toBe('group');
    const l = leaves(r.shapes);
    expect(l).toHaveLength(3);
    expect(l[0]).toMatchObject({ fill: '#ff0000', stroke: '#0000ff', strokeWidth: 4 });
    expect(l[1]).toMatchObject({ fill: '#008000', stroke: '#000000' });
    expect(l[2]).toMatchObject({ fill: '#000000', stroke: 'none' });
  });
  it('applies group translate/scale and keeps shape types', () => {
    const r = importSvg(wrap('<g transform="translate(10 20) scale(2)"><rect x="1" y="2" width="5" height="5" stroke="#000" stroke-width="1"/></g>'));
    const s: any = leaves(r.shapes)[0];
    expect(s).toMatchObject({ type: 'rectangle', x: 12, y: 24, width: 10, height: 10, strokeWidth: 2 });
  });
  it('turns a rotated rect into a rotated rect (not a path)', () => {
    const r = importSvg(wrap('<rect x="0" y="0" width="100" height="50" transform="rotate(30 50 25)"/>'));
    const s: any = r.shapes[0];
    expect(s.type).toBe('rectangle'); expect(s.rotation).toBeCloseTo(30, 3);
    expect(s.x).toBeCloseTo(0, 3); expect(s.y).toBeCloseTo(0, 3);
  });
  it('converts skewed rects to paths', () => {
    const r = importSvg(wrap('<rect width="10" height="10" transform="skewX(20)"/>'));
    expect(r.shapes[0].type).toBe('path');
  });
  it('handles paths: relative commands, arcs, implicit subpaths', () => {
    const r = importSvg(wrap('<path d="M0 0h10v10H0z M20 20a5 5 0 0 1 10 0" fill="none" stroke="#000"/>'));
    expect(r.shapes).toHaveLength(2);
    expect(r.shapes[0]).toMatchObject({ type: 'path', closed: true });
    expect(getLocalBounds(r.shapes[0]).width).toBe(10);
    expect(r.warnings.join()).toMatch(/sub-paths/);
  });
  it('resolves <use> of defs, with x/y offset', () => {
    const r = importSvg(wrap('<defs><circle id="c" r="5"/></defs><use href="#c" x="30" y="40"/><use xlink:href="#c"/>'));
    expect(r.shapes).toHaveLength(2);
    expect(r.shapes[0]).toMatchObject({ type: 'ellipse', cx: 30, cy: 40 });
  });
  it('applies viewBox scaling and reports the document size', () => {
    const r = importSvg(wrap('<rect width="50" height="50"/>', 'width="200" height="200" viewBox="0 0 100 100"'));
    expect(r.width).toBe(200);
    expect(r.shapes[0]).toMatchObject({ width: 100, height: 100 });
  });
  it('keeps group opacity on the group (not multiplied into children), folds fill-opacity into the color', () => {
    const r = importSvg(wrap('<g opacity="0.5"><rect width="1" height="1" opacity="0.5" fill="#ff0000" fill-opacity="0.5"/></g>'));
    const g: any = r.shapes[0];
    expect(g.type).toBe('group'); expect(g.opacity).toBe(0.5);
    expect(g.children[0].opacity).toBe(0.5); expect(g.children[0].fill).toBe('#ff000080');
  });
  it('imports nested <g> as nested groups, drops empty ones, keeps non-generic ids as names', () => {
    const r = importSvg(wrap('<g id="outer"><g id="g1"><rect width="2" height="2"/></g><g id="empty"></g><circle r="3"/></g>'));
    expect(r.shapes).toHaveLength(1);
    const outer: any = r.shapes[0];
    expect(outer.name).toBe('outer');
    expect(outer.children.map((c: any) => c.type)).toEqual(['group', 'ellipse']);
    expect(outer.children[0].children).toHaveLength(1);
  });
  it('keeps a pure rotation about the content centre as the group rotation, bakes any other transform', () => {
    const rot = importSvg(wrap('<g transform="rotate(30 50 25)"><rect width="100" height="50"/></g>'));
    const g: any = rot.shapes[0];
    expect(g.type).toBe('group'); expect(g.rotation).toBeCloseTo(30, 6);
    expect(g.children[0]).toMatchObject({ type: 'rectangle', x: 0, y: 0, width: 100, height: 50, rotation: 0 });
    const other = importSvg(wrap('<g transform="rotate(30 0 0)"><rect width="100" height="50"/></g>'));
    const g2: any = other.shapes[0];
    expect(g2.rotation).toBe(0);                                  // pivot is not the content centre → baked
    expect(g2.children[0].rotation).toBeCloseTo(30, 6);
  });
  it('skips display:none, imports polyline/polygon, warns on gradients and stylesheets', () => {
    const r = importSvg(wrap('<style>.a{fill:red}</style><rect width="1" height="1" display="none"/><polyline points="0,0 10,0 10,10" fill="none" stroke="#000"/><polygon points="0,0 5,0 5,5"/><rect width="2" height="2" fill="url(#g)"/>'));
    expect(r.shapes.map(s => s.type)).toEqual(['path', 'path', 'rectangle']);
    expect((r.shapes[0] as any).closed).toBe(false);
    expect((r.shapes[1] as any).closed).toBe(true);
    expect(r.warnings.join()).toMatch(/gradient or pattern/); expect(r.warnings.join()).toMatch(/stylesheets/);   // url(#g) points at nothing
  });
  it('imports text with tspans as lines, and rotated text around its anchor', () => {
    const r = importSvg(wrap('<text x="10" y="30" font-size="20" font-family="Arial, sans-serif" font-weight="bold"><tspan x="10">one</tspan><tspan x="10" dy="24">two</tspan></text>'));
    expect(r.shapes[0]).toMatchObject({ type: 'text', content: 'one\ntwo', fontSize: 20, fontFamily: 'Arial', fontWeight: 700 });
    const rot = importSvg(wrap('<text x="100" y="100" transform="rotate(90 100 100)">Hi</text>')).shapes[0];
    expect(rot.rotation).toBeCloseTo(90, 3);
    // the anchor point (100,100) must be a fixed point of the rotation
    const b = getLocalBounds(rot), c = getRotationOrigin(rot);
    const anchorLocal = { x: (rot as any).x, y: (rot as any).y };
    const dx = anchorLocal.x - c.x, dy = anchorLocal.y - c.y;
    const w = { x: c.x - dy, y: c.y + dx };            // rotate +90° about centre
    expect(w.x).toBeCloseTo(100, 3); expect(w.y).toBeCloseTo(100, 3);
    expect(b.width).toBeGreaterThan(0);
  });
  it('caps the shape count', () => {
    const many = Array.from({ length: 30 }, () => '<rect width="1" height="1"/>').join('');
    const r = importSvg(wrap(many), { maxShapes: 10 });
    expect(r.shapes).toHaveLength(10); expect(r.warnings.join()).toMatch(/stopped/);
  });
});

describe('colors', () => {
  const n = (v: string) => normalizeColor(v, '#123456', () => {});
  it('normalises', () => {
    expect(n('#f00')).toBe('#ff0000'); expect(n('#f008')).toBe('#ff000088');
    expect(n('rgb(255, 0, 128)')).toBe('#ff0080'); expect(n('rgba(0,0,0,0.5)')).toBe('#00000080');
    expect(n('none')).toBe('none'); expect(n('currentColor')).toBe('#123456'); expect(n('navy')).toBe('#000080');
  });

  it('warns about filters, clipping paths, masks, markers and blend modes it leaves out (but not about "none")', () => {
    const r = importSvg(wrap(
      '<rect width="5" height="5" filter="url(#f)"/><rect width="5" height="5" clip-path="url(#c)"/>' +
      '<rect width="5" height="5" style="mask:url(#m)"/><path d="M0 0 L5 5" stroke="#000" style="marker-end:url(#a)"/>' +
      '<rect width="5" height="5" style="mix-blend-mode:multiply"/><rect width="5" height="5" style="filter:none;marker:none"/>'));
    const w = r.warnings.join('\n');
    expect(w).toMatch(/Filters/); expect(w).toMatch(/Clipping/); expect(w).toMatch(/Masks/);
    expect(w).toMatch(/Markers/); expect(w).toMatch(/Blend modes/);
    expect(r.shapes).toHaveLength(6);
    expect(importSvg(wrap('<rect width="5" height="5" style="filter:none;clip-path:none;marker-start:none"/>')).warnings).toEqual([]);
  });
  it('<switch> shows only the first child whose conditions hold', () => {
    const r = importSvg(wrap('<switch><text systemLanguage="xx-unknown" x="0" y="10">nope</text><text x="0" y="10">fallback</text><text x="0" y="10">third</text></switch>'));
    expect(r.shapes).toHaveLength(1);
    expect((r.shapes[0] as any).content).toBe('fallback');
  });
  it('warns about text on a path, <tref> and SVG fonts', () => {
    const r = importSvg(wrap('<defs><path id="p" d="M0 0 L100 0"/><font id="f"></font></defs><text><textPath href="#p">along</textPath></text>'));
    expect(r.warnings.join('\n')).toMatch(/Text on a path/);
    expect(r.warnings.join('\n')).toMatch(/SVG fonts/);
  });
  it('warns about animations and keeps the shape as it looks before the animation', () => {
    const r = importSvg(wrap('<rect width="5" height="5" fill="red"><animate attributeName="fill" to="blue" dur="1s"/></rect>'));
    expect(r.shapes).toHaveLength(1);
    expect(r.warnings.join('\n')).toMatch(/Animations are not supported/);
    expect(importSvg(wrap('<rect width="5" height="5"/>')).warnings).toEqual([]);
  });
  it('without a stroke, open and closed sub-paths stay ONE compound path (the holes survive)', () => {
    const d = 'M0 0 L10 0 L10 10 L0 10 Z M2 2 L8 2 L8 8 L2 8';      // the inner square is not closed with Z
    const filled = importSvg(wrap(`<path d="${d}" fill="#000" fill-rule="evenodd"/>`));
    expect(filled.shapes).toHaveLength(1);
    expect(filled.shapes[0]).toMatchObject({ type: 'path', closed: true, fillRule: 'evenodd' });
    expect(filled.warnings).toEqual([]);
    const stroked = importSvg(wrap(`<path d="${d}" fill="none" stroke="#000"/>`));
    expect(stroked.shapes).toHaveLength(2);
    expect(stroked.warnings.join()).toMatch(/split/);
  });
  it('a group that reaches the shape limit is kept (partly) and the limit is reported', () => {
    const many = Array.from({ length: 30 }, (_, i) => `<rect x="${i}" width="1" height="1"/>`).join('');
    const r = importSvg(wrap(`<g id="layer">${many}</g>`), { maxShapes: 10 });
    expect(r.shapes).toHaveLength(1);
    expect(r.shapes[0].type).toBe('group');
    expect((r.shapes[0] as any).children.length).toBe(10);
    expect(r.warnings.join()).toMatch(/stopped at 10/);
  });
});
