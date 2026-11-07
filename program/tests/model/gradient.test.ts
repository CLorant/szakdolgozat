// @vitest-environment jsdom
// Gradient paints: the string format, import and output.
import { describe, it, expect } from 'vitest';
import {
  parseGradient, formatGradient, isValidPaint, gradientFrom, convertGradient, colorAt, linearCoords, gradientSvg, solidOf, reverseStops,
} from '../../src/lib/utils/gradient';

describe('gradient paint strings', () => {
  it('round-trips and sorts stops', () => {
    const g = parseGradient('lg:90;#0000ff@100,#ff0000@0')!;
    expect(g).toMatchObject({ type: 'linear', angle: 90 });
    expect(g.stops.map(s => s.offset)).toEqual([0, 100]);
    expect(formatGradient(g)).toBe('lg:90;#ff0000@0,#0000ff@100');
    expect(formatGradient(parseGradient('rg:50,50,60;#ffffff@0,#00000080@100')!)).toBe('rg:50,50,60;#ffffff@0,#00000080@100');
  });
  it('rejects malformed values (this is what a project file or an import may contain)', () => {
    for (const bad of ['lg:90', 'lg:x;#ff0000@0,#00ff00@100', 'lg:90;#ff0000@0', 'lg:90;red@0,blue@100', 'rg:1,2;#ff0000@0,#00ff00@100', 'lg:90;#ff0000@a,#00ff00@100', '#ff0000'])
      expect(parseGradient(bad), bad).toBeNull();
    expect(isValidPaint('none')).toBe(true);
    expect(isValidPaint('#abcdef80')).toBe(true);
    expect(isValidPaint('lg:0;#000000@0,#ffffff@100')).toBe(true);
    expect(isValidPaint('lg:0;<script>')).toBe(false);
    expect(isValidPaint(5)).toBe(false);
  });
  it('a gradient starts from the current color; converting keeps the stops', () => {
    const g = gradientFrom('#336699', 'linear');
    expect(g.stops).toEqual([{ offset: 0, color: '#336699' }, { offset: 100, color: '#33669900' }]);
    const r = convertGradient(g, 'radial');
    expect(r).toMatchObject({ type: 'radial', cx: 50, cy: 50, r: 50 });
    expect(r.stops).toBe(g.stops);
    expect(solidOf('lg:0;#112233@0,#ffffff@100')).toBe('#112233');
    expect(solidOf('#445566')).toBe('#445566');
    expect(reverseStops(g.stops).map(s => s.offset)).toEqual([0, 100]);
    expect(reverseStops(g.stops)[0].color).toBe('#33669900');
  });
  it('interpolates a new stop between its neighbours (alpha too)', () => {
    expect(colorAt([{ offset: 0, color: '#000000' }, { offset: 100, color: '#ffffff' }], 50)).toBe('#808080');
    expect(colorAt([{ offset: 0, color: '#ff0000' }, { offset: 100, color: '#ff000000' }], 50)).toBe('#ff000080');
  });
  it('angle 0 runs left → right, 90 top → bottom, 45 corner to corner', () => {
    expect(linearCoords(0)).toEqual({ x1: 0, y1: 0.5, x2: 1, y2: 0.5 });
    expect(linearCoords(90)).toMatchObject({ x1: 0.5, y1: 0, x2: 0.5, y2: 1 });
    expect(linearCoords(45)).toEqual({ x1: 0, y1: 0, x2: 1, y2: 1 });
  });
  it('writes standard SVG with stop-opacity', () => {
    const svg = gradientSvg(parseGradient('lg:0;#ff0000@0,#0000ff80@100')!, 'g1');
    expect(svg).toContain('<linearGradient id="g1" x1="0" y1="0.5" x2="1" y2="0.5">');
    expect(svg).toContain('<stop offset="0" stop-color="#ff0000"/>');
    expect(svg).toMatch(/stop-color="#0000ff" stop-opacity="0\.502"/);
    expect(gradientSvg(parseGradient('rg:30,40,50;#ff0000@0,#0000ff@100')!, 'g2')).toContain('<radialGradient id="g2" cx="0.3" cy="0.4" r="0.5">');
  });
});

import { importSvg } from '../../src/lib/utils/svgImport';
import { buildSvgDocument, shapeToSvgElement } from '../../src/lib/utils/serializer';
import { makeRect, makeLine } from '../../src/lib/utils/shapes';
import { parseProject, serializeProject } from '../../src/lib/utils/project';

const imp = (svg: string) => importSvg(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="200" height="100">${svg}</svg>`);

describe('importing gradients', () => {
  it('bounding-box units: angle and stops carry over', () => {
    const r = imp(`<defs><linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff" stop-opacity="0.5"/></linearGradient></defs><rect width="100" height="50" fill="url(#a)"/>`);
    expect((r.shapes[0] as any).fill).toBe('lg:90;#ff0000@0,#0000ff80@100');
  });
  it('user-space units are converted to the shape box (and a short gradient is re-expressed over the whole box)', () => {
    // box x 100..200; the gradient only spans x 125..175 → colors outside are the end colors
    const r = imp(`<defs><linearGradient id="a" gradientUnits="userSpaceOnUse" x1="125" y1="0" x2="175" y2="0"><stop offset="0" stop-color="#000000"/><stop offset="1" stop-color="#ffffff"/></linearGradient></defs><rect x="100" y="0" width="100" height="50" fill="url(#a)"/>`);
    const g = parseGradient((r.shapes[0] as any).fill)!;
    expect(g.type).toBe('linear');
    expect((g as any).angle).toBeCloseTo(0);
    expect(g.stops.map(s => [s.offset, s.color])).toEqual([[0, '#000000'], [25, '#000000'], [75, '#ffffff'], [100, '#ffffff']]);   // shorter than the box: flat ends
  });
  it('radial, href inheritance, fill-opacity and stroke gradients', () => {
    const r = imp(`<defs><linearGradient id="s"><stop offset="0" stop-color="#00ff00"/><stop offset="100%" stop-color="#ffff00"/></linearGradient><radialGradient id="a" xlink:href="#s" cx="0.25" cy="0.75" r="0.4"/></defs><ellipse cx="50" cy="50" rx="40" ry="40" fill="url(#a)" fill-opacity="0.5" stroke="url(#s)" stroke-width="4"/>`);
    const e = r.shapes[0] as any;
    expect(e.fill).toBe('rg:25,75,40;#00ff0080@0,#ffff0080@100');
    expect(e.stroke).toMatch(/^lg:0;#00ff00@0,#ffff00@100$/);
  });
  it('unknown references become grey with a warning', () => {
    const r = imp(`<rect width="10" height="10" fill="url(#nope)"/>`);
    expect((r.shapes[0] as any).fill).toBe('#808080');
    expect(r.warnings.join()).toMatch(/gradient or pattern/);
  });
});

describe('gradients in files', () => {
  const doc = (shapes: any[]) => ({ shapes, width: 200, height: 100, background: 'white' }) as any;
  it('the SVG gets one <defs> with a gradient per paint, referenced by url(#…)', () => {
    const rect = { ...makeRect(0, 0, 100, 50, { fill: 'lg:0;#ff0000@0,#0000ff@100', stroke: 'rg:50,50,50;#000000@0,#ffffff@100', strokeWidth: 3 }), id: 'r1' };
    const svg = buildSvgDocument(doc([rect]));
    expect(svg.match(/<defs>/g)).toHaveLength(1);
    expect(svg).toContain('<linearGradient id="g-r1-f"');
    expect(svg).toContain('<radialGradient id="g-r1-s"');
    expect(svg).toContain('fill="url(#g-r1-f)"');
    expect(svg).toContain('stroke="url(#g-r1-s)"');
    expect(shapeToSvgElement(rect)).toMatch(/^ {2}<defs>[\s\S]*<\/defs>\n {2}<rect/);          // standalone: defs right before the shape
  });
  it('a project file keeps valid gradients and replaces broken ones', () => {
    const good = { ...makeRect(0, 0, 10, 10, { fill: 'lg:90;#ff0000@0,#0000ff@100', stroke: 'none', strokeWidth: 0 }), id: 'a' };
    const bad = { ...makeRect(0, 0, 10, 10, { fill: 'lg:90;<b>', stroke: 'none', strokeWidth: 0 }), id: 'b' };
    const back = parseProject(serializeProject(doc([good, bad])));
    expect((back.shapes[0] as any).fill).toBe('lg:90;#ff0000@0,#0000ff@100');
    expect((back.shapes[1] as any).fill).toBe('#aaaaaa');
  });
});
