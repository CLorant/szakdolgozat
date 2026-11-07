// Path data: parsing, arcs, bounds, simplification.
import { describe, it, expect } from 'vitest';
import { parsePathData, pathToD, pathBounds, simplifyRDP, freehandToNodes, splitSegment, nearestOnPath, corner } from '../../src/lib/utils/path';

describe('path', () => {
  it('parses a closed polygon and drops the duplicate end node', () => {
    const sp = parsePathData('M0 0 L10 0 L10 10 L0 0 Z');
    expect(sp).toHaveLength(1);
    expect(sp[0].closed).toBe(true);
    expect(sp[0].nodes).toHaveLength(3);
  });
  it('splits subpaths and handles implicit lineto + relative commands', () => {
    const sp = parsePathData('M0 0 10 0 10 10 m 20 20 l 5 0 5 5');
    expect(sp).toHaveLength(2);
    expect(sp[0].nodes).toHaveLength(3);
    expect(sp[1].nodes[0]).toMatchObject({ x: 10 + 20, y: 10 + 20 });
    expect(sp[1].nodes).toHaveLength(3);
  });
  it('converts an arc to cubics with correct bounds', () => {
    const [sp] = parsePathData('M10 10 A5 5 0 0 1 20 10');
    const b = pathBounds(sp.nodes, false);
    expect(b.x).toBeCloseTo(10, 3); expect(b.width).toBeCloseTo(10, 3);
    expect(b.y).toBeCloseTo(5, 2);  expect(b.height).toBeCloseTo(5, 2);
  });
  it('handles compact arc flags', () => {
    const [sp] = parsePathData('M0 0a5 5 0 1010 0');
    expect(sp.nodes.length).toBeGreaterThan(2);
  });
  it('bounds use the curve, not the control polygon', () => {
    const nodes = [{ ...corner(0, 0), hout: { x: 0, y: 100 } }, { ...corner(100, 0), hin: { x: 100, y: 100 } }];
    expect(pathBounds(nodes, false).height).toBeCloseTo(75, 5);
  });
  it('round-trips through pathToD', () => {
    const d = 'M 0,0 C 0,10 10,10 10,0 L 20,0 Z';
    const [sp] = parsePathData(d);
    expect(pathToD(sp.nodes, sp.closed)).toBe(d);
  });
  it('RDP removes collinear points', () => {
    const pts = Array.from({ length: 50 }, (_, i) => ({ x: i, y: 0 }));
    expect(simplifyRDP(pts, 0.5)).toHaveLength(2);
  });
  it('freehand yields smooth nodes', () => {
    const pts = Array.from({ length: 100 }, (_, i) => ({ x: i * 3, y: Math.sin(i / 8) * 40 }));
    const n = freehandToNodes(pts, 1.5);
    expect(n.length).toBeLessThan(60);
    expect(n[1].smooth).toBe(true);
  });
  it('splitSegment keeps the curve shape (bounds unchanged)', () => {
    const nodes = [{ ...corner(0, 0), hout: { x: 0, y: 100 } }, { ...corner(100, 0), hin: { x: 100, y: 100 } }];
    const r = splitSegment(nodes, false, 0, 0.3);
    expect(r.nodes).toHaveLength(3);
    const b = pathBounds(r.nodes, false);
    expect(b.height).toBeCloseTo(75, 3);
    expect(nearestOnPath(r.nodes, false, { x: r.nodes[1].x, y: r.nodes[1].y })!.dist).toBeLessThan(0.01);
  });
});
