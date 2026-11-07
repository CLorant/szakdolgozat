// Dash patterns: presets that follow the stroke, typed patterns, offset.
import { describe, it, expect, beforeEach } from 'vitest';
import { dashFor, inferDash, reflowDash, parseDashInput, DASH_KINDS, type DashKind } from '../../src/lib/utils/dash';
import { editor } from '../../src/lib/stores/editor';
import { documentStore } from '../../src/lib/stores/document';
import { ui } from '../../src/lib/stores/ui';
import { makeRect, makeLine, makeGroup } from '../../src/lib/utils/shapes';
import { corner } from '../../src/lib/utils/path';
import { leaves } from '../../src/lib/utils/tree';
import type { LineCap } from '../../src/lib/utils/types';

const st = { fill: 'none', stroke: '#000000', strokeWidth: 2 };
const shapes = () => documentStore.get().shapes;
const nums = (d: string) => d.split(' ').map(Number);
/** What you SEE: caps lengthen every dash by w and shorten every gap by w. */
const visible = (d: string, w: number, cap: LineCap) =>
  nums(d).map((v, i) => (cap === 'butt' ? v : i % 2 === 0 ? v + w : v - w));

beforeEach(() => { editor.newDocument(); ui.set({ strokeWidth: 2, strokeLinecap: 'round', dashKind: 'solid' }); });

describe('dash presets', () => {
  it('lengths scale with the stroke width', () => {
    expect(dashFor('dashed', 2, 'butt')).toBe('6 4');
    expect(dashFor('dashed', 10, 'butt')).toBe('30 20');
    expect(dashFor('solid', 5, 'round')).toBe('');
  });
  it('the VISIBLE dash and gap are the same for every cap (caps are compensated)', () => {
    for (const w of [1, 2, 6, 20]) for (const cap of ['butt', 'round', 'square'] as LineCap[]) {
      const same = (got: number[], want: number[]) => got.forEach((v, i) => expect(v).toBeCloseTo(want[i], 1));   // dots are 0.01 long, not 0
      same(visible(dashFor('dashed', w, cap), w, cap), [3 * w, 2 * w]);
      same(visible(dashFor('dotted', w, cap), w, cap), [w, 1.5 * w]);
      same(visible(dashFor('dash-dot', w, cap), w, cap), [3 * w, 1.5 * w, w, 1.5 * w]);
    }
  });
  it('a round-capped dotted line never has a gap that closes up, even on thick strokes', () => {
    const d = nums(dashFor('dotted', 30, 'round'));
    expect(d[1]).toBeGreaterThan(30);                        // the gap grows by w to make room for the caps
    expect(d.every(v => v > 0)).toBe(true);
  });
  it('hairlines are not turned into dust', () => {
    expect(nums(dashFor('dashed', 0.1, 'butt')).every(v => v >= 0.5)).toBe(true);
  });
  it('infers the preset back at any width / cap, and says "custom" otherwise', () => {
    for (const k of DASH_KINDS) for (const w of [0.5, 1, 2.5, 8, 40]) for (const cap of ['butt', 'round', 'square'] as LineCap[])
      expect(inferDash(dashFor(k, w, cap), w, cap)).toBe(k);
    expect(inferDash('7 3 1 9', 2, 'butt')).toBe('custom');
    expect(inferDash('', 2, 'butt')).toBe('solid');
    expect(inferDash('garbage', 2, 'butt')).toBe('custom');
  });
  it('reflow regenerates presets; custom patterns stay absolute', () => {
    expect(reflowDash(dashFor('dashed', 2, 'butt'), { width: 2, cap: 'butt' }, { width: 6, cap: 'round' })).toBe(dashFor('dashed', 6, 'round'));
    expect(reflowDash('7 3', { width: 2, cap: 'butt' }, { width: 4, cap: 'butt' })).toBe('7 3');
    expect(reflowDash('', { width: 2, cap: 'butt' }, { width: 4, cap: 'butt' })).toBe('');
  });
});

describe('dash in the editor', () => {
  const add = (w: number, cap: LineCap = 'butt') => {
    const r = { ...makeRect(0, 0, 50, 50, { ...st, strokeWidth: w }), strokeLinecap: cap };
    editor.addShape(r); return r.id;
  };
  it('changing the width re-generates the pattern (the "gap scales with the stroke" rule)', () => {
    const id = add(2); editor.select([id]); editor.setDashKind('dashed');
    expect((shapes()[0] as any).strokeDasharray).toBe('6 4');
    editor.setStyle({ strokeWidth: 8 });
    expect((shapes()[0] as any).strokeDasharray).toBe('24 16');
  });
  it('changing the cap re-generates the pattern', () => {
    const id = add(4); editor.select([id]); editor.setDashKind('dotted');
    const before = (shapes()[0] as any).strokeDasharray;
    editor.setStyle({ strokeLinecap: 'round' });
    const after = (shapes()[0] as any).strokeDasharray;
    expect(after).toBe(dashFor('dotted', 4, 'round')); expect(after).not.toBe(before);
  });
  it('solid stays solid; custom patterns do not follow the width', () => {
    const id = add(2); editor.select([id]);
    editor.setStyle({ strokeWidth: 6 });
    expect((shapes()[0] as any).strokeDasharray).toBe('');
    editor.updateShape(id, { strokeDasharray: '7 3' });
    editor.setStyle({ strokeWidth: 12 });
    expect((shapes()[0] as any).strokeDasharray).toBe('7 3');
  });
  it('a preset applied to several shapes fits each one’s own width and cap', () => {
    const a = add(2, 'butt'), b = add(10, 'round');
    editor.select([a, b]); editor.setDashKind('dashed');
    expect((shapes()[0] as any).strokeDasharray).toBe(dashFor('dashed', 2, 'butt'));
    expect((shapes()[1] as any).strokeDasharray).toBe(dashFor('dashed', 10, 'round'));
  });
  it('works on groups (all children) and one slider drag is one undo step', () => {
    const a = add(2), b = add(4); editor.select([a, b]); editor.group();
    editor.setDashKind('dash-dot');
    expect(leaves(shapes()).map(s => s.strokeDasharray)).toEqual([dashFor('dash-dot', 2, 'butt'), dashFor('dash-dot', 4, 'butt')]);
    for (const w of [3, 4, 5, 6, 7]) editor.setStyle({ strokeWidth: w });
    expect(leaves(shapes()).every(s => s.strokeWidth === 7 && s.strokeDasharray === dashFor('dash-dot', 7, 'butt'))).toBe(true);
    editor.undo();                                            // the whole drag in one step
    expect(leaves(shapes()).map(s => s.strokeWidth)).toEqual([2, 4]);
  });
  it('new shapes get the remembered preset for the CURRENT width and cap', async () => {
    const { createTools } = await import('../../src/lib/tools');
    ui.set({ strokeWidth: 5, strokeLinecap: 'square' }); editor.setDashKind('dashed');
    const tools = createTools({ zoom: () => 1, openText: () => {} });
    const I = (x: number, y: number) => ({ p: { x, y }, raw: { x, y }, shift: false, alt: false, ctrl: false, target: null });
    tools.line.down(I(0, 0)); tools.line.move(I(60, 0)); tools.line.up(I(60, 0));
    expect((shapes()[0] as any).strokeDasharray).toBe(dashFor('dashed', 5, 'square'));
  });
  it('line shapes dash too (not just closed shapes)', () => {
    const l = makeLine({ x: 0, y: 0 }, { x: 50, y: 0 }, st); editor.addShape(l);
    editor.setDashKind('dashed');
    expect((shapes()[0] as any).strokeDasharray).toBe(dashFor('dashed', 2, 'round'));
    void makeGroup; void ({} as DashKind);
  });
});

describe('dash offset and typed patterns', () => {
  it('parseDashInput accepts lists and rejects nonsense', () => {
    expect(parseDashInput('')).toEqual([]);
    expect(parseDashInput('6, 3  1 3')).toEqual([6, 3, 1, 3]);
    expect(parseDashInput('0 4')).toEqual([0, 4]);
    expect(parseDashInput('-1 2')).toBeNull();
    expect(parseDashInput('a b')).toBeNull();
    expect(parseDashInput('0 0')).toBeNull();
    expect(parseDashInput('1 1 1 1 1 1 1 1 1')).toBeNull();
  });
  it('setDash stores a pattern and an offset; the offset is exported and imported', async () => {
    const r = makeRect(0, 0, 50, 50, { ...st, strokeWidth: 2 });
    editor.addShape(r); editor.select([r.id]);
    editor.setDash({ dasharray: '8 4' }); editor.setDash({ offset: 3 });
    const s: any = shapes()[0];
    expect([s.strokeDasharray, s.strokeDashoffset]).toEqual(['8 4', 3]);
    const { buildSvgDocument } = await import('../../src/lib/utils/serializer');
    const svg = buildSvgDocument(documentStore.get(), {});
    expect(svg).toContain('stroke-dasharray="8 4"');
    expect(svg).toContain('stroke-dashoffset="3"');
  });
  it('the offset moves where the dashes start (stroke to path)', async () => {
    const { strokeOutline } = await import('../../src/lib/utils/strokeToPath');
    const nodes = [corner(0, 0), corner(100, 0)];
    const area = (o: number) => strokeOutline(nodes, false, 2, 'butt', 'miter', '10 10', o)
      .reduce((a, poly) => a + Math.abs(poly.reduce((s, p, i) => { const q = poly[(i + 1) % poly.length]; return s + p.x * q.y - q.x * p.y; }, 0) / 2), 0);
    expect(area(0)).toBeCloseTo(100, 0);          // 5 dashes × 10 × 2
    const pieces = strokeOutline(nodes, false, 2, 'butt', 'miter', '10 10', 5);
    const xs = pieces.flat().map(p => p.x);
    expect(Math.min(...xs)).toBeCloseTo(0, 1);    // starts inside a dash: first piece is 5 long
    expect(pieces.length).toBe(6);
  });
});
