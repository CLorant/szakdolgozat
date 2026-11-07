// Stroke to path.
import { describe, it, expect } from 'vitest';
import { strokeToPath, strokeOutline, hasStroke } from '../../src/lib/utils/strokeToPath';
import { makeLine, makeRect, makeEllipse, makeText } from '../../src/lib/utils/shapes';
import { pathBounds, contours } from '../../src/lib/utils/path';
import { DEFAULT_TEXT_PROPS } from '../../src/lib/utils/text';
import type { PathShape, GroupShape } from '../../src/lib/utils/types';

const st = (extra = {}) => ({ fill: 'none', stroke: '#112233', strokeWidth: 10, strokeLinecap: 'butt' as const, strokeLinejoin: 'miter' as const, ...extra });
const area = (nodes: { x: number; y: number }[]) => nodes.reduce((a, p, i) => { const q = nodes[(i + 1) % nodes.length]; return a + (p.x * q.y - q.x * p.y) / 2; }, 0);
const netArea = (p: PathShape) => contours(p.nodes).reduce((a, c) => a + area(c), 0);
const withStyle = (s: any, extra: Record<string, unknown>) => ({ ...s, ...extra });

describe('stroke to path', () => {
  it('a butt-capped line becomes a w × length rectangle, painted with the stroke color', () => {
    const line = withStyle(makeLine({ x: 10, y: 20 }, { x: 110, y: 20 }, st()), { strokeLinecap: 'butt' });
    const p = strokeToPath(line) as PathShape;
    expect(p.type).toBe('path');
    expect(p.id).toBe(line.id);
    expect(p).toMatchObject({ fill: '#112233', stroke: 'none', strokeWidth: 0, closed: true });
    const b = pathBounds(p.nodes, true);
    expect([b.x, b.y, b.width, b.height].map(Math.round)).toEqual([10, 15, 100, 10]);
    expect(Math.abs(netArea(p))).toBeCloseTo(1000, 0);
  });
  it('caps: square adds w/2 at each end, round does too (with rounded ends)', () => {
    const mk = (cap: string) => strokeToPath(withStyle(makeLine({ x: 0, y: 0 }, { x: 100, y: 0 }, st()), { strokeLinecap: cap })) as PathShape;
    expect(pathBounds(mk('square').nodes, true).width).toBeCloseTo(110, 1);
    expect(pathBounds(mk('round').nodes, true).width).toBeCloseTo(110, 1);
    expect(Math.abs(netArea(mk('square')))).toBeCloseTo(1100, 0);
    expect(Math.abs(netArea(mk('round')))).toBeCloseTo(1000 + Math.PI * 25, 0);
  });
  it('a stroked rectangle without fill is a ring: outer minus inner', () => {
    const r = withStyle(makeRect(0, 0, 100, 60, st()), { strokeLinejoin: 'miter' });
    const p = strokeToPath(r) as PathShape;
    expect(contours(p.nodes)).toHaveLength(2);
    expect(Math.abs(netArea(p))).toBeCloseTo(110 * 70 - 90 * 50, 0);                // holes have opposite winding
  });
  it('round joins round the outer corners of a rectangle ring', () => {
    const p = strokeToPath(withStyle(makeRect(0, 0, 100, 60, st()), { strokeLinejoin: 'round' })) as PathShape;
    // outer corners rounded (radius w/2), inner corners stay sharp
    expect(Math.abs(Math.abs(netArea(p)) - (110 * 70 - (4 - Math.PI) * 25 - 90 * 50))).toBeLessThan(2);
  });
  it('a shape with fill and stroke becomes a group [fill, stroke path] with the opacity on the group', () => {
    const r = withStyle(makeRect(0, 0, 50, 50, st({ fill: '#ff0000' })), { opacity: 0.5 });
    const g = strokeToPath(r) as GroupShape;
    expect(g.type).toBe('group');
    expect(g.id).toBe(r.id);
    expect(g.opacity).toBe(0.5);
    expect(g.children).toHaveLength(2);
    expect(g.children[0]).toMatchObject({ type: 'rectangle', fill: '#ff0000', stroke: 'none', strokeWidth: 0, opacity: 1 });
    expect(g.children[1]).toMatchObject({ type: 'path', fill: '#112233' });
  });
  it('dashes: one piece per dash', () => {
    const l = withStyle(makeLine({ x: 0, y: 0 }, { x: 100, y: 0 }, st({ strokeWidth: 4 })), { strokeDasharray: '10 10' });
    const p = strokeToPath(l) as PathShape;
    expect(contours(p.nodes)).toHaveLength(5);                                         // 0-10, 20-30, … 80-90 
    expect(Math.abs(netArea(p))).toBeCloseTo(5 * 10 * 4, 0);
  });
  it('rotation is baked in: the stroke of a rotated line keeps its place', () => {
    const l = withStyle(makeLine({ x: 0, y: 0 }, { x: 100, y: 0 }, st({ strokeWidth: 2 })), { rotation: 90 });
    const p = strokeToPath(l) as PathShape;
    expect(p.rotation).toBe(0);
    const b = pathBounds(p.nodes, true);
    expect(b.width).toBeCloseTo(2, 1);                                                 // now vertical, about its old centre (50, 0)
    expect(b.height).toBeCloseTo(100, 1);
    expect(b.x + b.width / 2).toBeCloseTo(50, 1);
  });
  it('nothing to do for: no stroke, text, empty groups', () => {
    expect(strokeToPath(makeRect(0, 0, 10, 10, st({ stroke: 'none' })))).toBeNull();
    expect(strokeToPath(withStyle(makeRect(0, 0, 10, 10, st()), { strokeWidth: 0 }))).toBeNull();
    expect(hasStroke(makeText(0, 0, 'a', DEFAULT_TEXT_PROPS, { fill: '#000', stroke: '#000', strokeWidth: 3 }))).toBe(false);
    expect(strokeToPath(makeText(0, 0, 'a', DEFAULT_TEXT_PROPS, { fill: '#000', stroke: 'none', strokeWidth: 0 }))).toBeNull();
  });
  it('an ellipse outline is a ring with the expected area', () => {
    const p = strokeToPath(makeEllipse(50, 50, 40, 40, st({ strokeWidth: 10 }))) as PathShape;
    expect(Math.abs(netArea(p))).toBeCloseTo(Math.PI * (45 * 45 - 35 * 35), -1);
  });
  it('outline of a polyline with a sharp miter stays bounded (miter limit)', () => {
    const polys = strokeOutline([{ x: 0, y: 0, hin: null, hout: null, smooth: false }, { x: 100, y: 0, hin: null, hout: null, smooth: false }, { x: 0, y: 2, hin: null, hout: null, smooth: false }], false, 4, 'butt', 'miter');
    const xs = polys.flat().map(p => p.x);
    expect(Math.max(...xs)).toBeLessThan(100 + 4 * 4);
  });
});
