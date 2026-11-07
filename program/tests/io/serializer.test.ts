// @vitest-environment jsdom
// SVG output.
import { describe, it, expect } from 'vitest';
import { buildSvgDocument } from '../../src/lib/utils/serializer';
import { importSvg } from '../../src/lib/utils/svgImport';
import { emptyDocument } from '../../src/lib/stores/document';
import { makeRect, makeLine, makeEllipse, makePath, makeText, getLocalBounds } from '../../src/lib/utils/shapes';
import { corner } from '../../src/lib/utils/path';
import { DEFAULT_TEXT_PROPS } from '../../src/lib/utils/text';
import type { DocumentState } from '../../src/lib/utils/types';

const st = { fill: '#336699', stroke: '#000000', strokeWidth: 3 };
const doc = (shapes: any[], extra: Partial<DocumentState> = {}): DocumentState => ({ ...emptyDocument(), shapes, ...extra });

describe('serializer', () => {
  it('writes linecap/linejoin explicitly (SVG defaults differ from the editor defaults)', () => {
    const svg = buildSvgDocument(doc([makeRect(0, 0, 10, 10, st)]));
    expect(svg).toContain('stroke-linecap="round"');
    expect(svg).toContain('stroke-linejoin="round"');
  });
  it('draws the background color, none for transparent', () => {
    expect(buildSvgDocument(doc([], { background: 'black' }))).toContain('fill="#000000"');
    expect(buildSvgDocument(doc([], { background: 'transparent-light' }))).not.toContain('<rect');
    expect(buildSvgDocument(doc([], { background: 'transparent-light' }), { opaque: true })).toContain('#ffffff');
  });
  it('splits #rrggbbaa into color + opacity', () => {
    const svg = buildSvgDocument(doc([makeRect(0, 0, 10, 10, { ...st, fill: '#ff000080' })]));
    expect(svg).toContain('fill="#ff0000" fill-opacity="0.502"');
  });
  it('quotes web font families, preserves spaces, escapes text', () => {
    const t = makeText(5, 20, 'a < b  &  c\nline2', { ...DEFAULT_TEXT_PROPS, fontFamily: 'Source Sans 3' }, st);
    const svg = buildSvgDocument(doc([t]));
    expect(svg).toContain(`font-family="'Source Sans 3', sans-serif"`);
    expect(svg).toContain('a &lt; b  &amp;  c');
    expect(svg).toContain('xml:space="preserve"');
    expect(svg).not.toContain('@import');                          // no external font dependency any more
    expect(buildSvgDocument(doc([t]), { fontCss: '@font-face{font-family:X}' })).toContain('<style><![CDATA[');
  });
  it('skips hidden shapes and rotates around the shared origin', () => {
    const r = { ...makeRect(0, 0, 100, 50, st), rotation: 45 };
    const h = { ...makeRect(0, 0, 1, 1, st), visible: false };
    const svg = buildSvgDocument(doc([r, h]));
    expect(svg).toContain('rotate(45 50 25)');
    expect((svg.match(/<rect/g) ?? []).length).toBe(1 + 1);   // background + one rect
  });
});

describe('export → import round trip', () => {
  it('preserves every shape type, geometry and style', () => {
    const curve = makePath([{ ...corner(0, 0), hout: { x: 0, y: 40 } }, { ...corner(60, 0), hin: { x: 60, y: 40 } }, corner(30, 80)], true, st);
    const original = [
      { ...makeRect(10, 20, 100, 50, st), rx: 6, ry: 6, rotation: 30, opacity: 0.5 },
      makeLine({ x: 0, y: 0 }, { x: 50, y: 70 }, st),
      makeEllipse(80, 90, 30, 20, st),
      curve,
      makeText(20, 40, 'Hello\nWorld', DEFAULT_TEXT_PROPS, st),
    ];
    const r = importSvg(buildSvgDocument(doc(original, { width: 640, height: 480 })));
    expect(r.width).toBe(640); expect(r.height).toBe(480);
    // first imported element is the background rect
    const shapes = r.shapes.slice(1);
    expect(shapes.map(s => s.type)).toEqual(['rectangle', 'line', 'ellipse', 'path', 'text']);
    const rect: any = shapes[0];
    expect(rect.rotation).toBeCloseTo(30, 3);
    expect(rect.x).toBeCloseTo(10, 2); expect(rect.width).toBeCloseTo(100, 2);
    expect(rect.opacity).toBe(0.5);
    expect(rect.strokeLinejoin).toBe('round');
    expect(rect.fill).toBe('#336699');
    const path: any = shapes[3];
    expect(path.closed).toBe(true);
    expect(getLocalBounds(path).height).toBeCloseTo(getLocalBounds(curve).height, 2);
    const text: any = shapes[4];
    expect(text.content).toBe('Hello\nWorld');
    expect(text.x).toBeCloseTo(20, 3);
  });
});
