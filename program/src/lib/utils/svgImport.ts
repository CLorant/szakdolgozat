/**
 * @file SVG text → shapes: elements, transforms, styles, gradients and text, with warnings for what is not supported.
 *
 * Supported:
 *   ✔ svg / g / a / switch / use(+defs, symbol), nested transforms (any matrix)
 *   ✔ rect, circle, ellipse, line, polyline, polygon, path (all commands), text/tspan
 *   ✔ presentation attributes AND inline style="…", with correct inheritance and SVG defaults
 *   ✔ <g> → groups (opacity and a pure rotation about the content's centre are kept on the group;
 *     any other group transform is baked into the children), viewBox scaling, fill-/stroke-opacity
 *   ✔ closed multi-subpath paths become ONE compound path (holes kept), incl. fill-rule
 *   ✔ linear / radial gradients (bounding-box or user-space units, gradientTransform, href chains; focal points and
 *     spread methods are dropped)
 *   ✔ <image> with a data: or http(s) URL (a mirroring transform becomes flipX)
 *   ✘ patterns (→ grey), <style> stylesheets, clip/mask/filter;
 *     paths that mix open and closed sub-paths are split into one shape per subpath
 * Rects/ellipses/lines/text keep their type under translate/scale/uniform-rotate transforms;
 * under skew or flips they become paths. Warnings explain anything that was approximated.
 */

import type { Shape, GroupShape, PathNode, TextProps, Style, LineCap, LineJoin, ImageShape } from './types';
import { IDENTITY, multiply, applyMatrix, parseTransform, normDeg, round, rotatePoint, EPS, type Matrix } from './math';
import { parsePathData, transformNodes, corner, joinContours } from './path';
import { makeLine, makeRect, makeEllipse, makePath, makeText, makeImage, toPathShape, translateShape, getLocalBounds, centerOf, getRotationOrigin, uid } from './shapes';
import { MAX_GROUP_DEPTH } from './tree';
import { DEFAULT_TEXT_PROPS, LINE_HEIGHT, normWeight, decorationLines, textBounds } from './text';
import { formatGradient, colorAt, type Gradient, type Stop } from './gradient';

export interface ImportResult {
  shapes:   Shape[];
  /** Intrinsic size from width/height or viewBox; undefined if the file has neither. */
  width?:   number;
  height?:  number;
  warnings: string[];
}
export interface ImportOptions { maxShapes?: number; }

// ── colors ───────────────────────────────────────────────────────────────────

const NAMED: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00',
  orange: '#ffa500', purple: '#800080', gray: '#808080', grey: '#808080', silver: '#c0c0c0', maroon: '#800000',
  lime: '#00ff00', aqua: '#00ffff', cyan: '#00ffff', fuchsia: '#ff00ff', magenta: '#ff00ff', navy: '#000080',
  teal: '#008080', olive: '#808000', pink: '#ffc0cb', brown: '#a52a2a', gold: '#ffd700', transparent: 'none',
};

const h2 = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');

function canvasColor(name: string): string | null {
  if (typeof document === 'undefined') return null;
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#000'; ctx.fillStyle = name;
    const v = ctx.fillStyle as string;
    return v.startsWith('#') ? v : null;
  } catch { return null; }
}

/** → '#rrggbb' | '#rrggbbaa' | 'none'. */
export function normalizeColor(raw: string, current: string, warn: (m: string) => void): string {
  const v = raw.trim().toLowerCase();
  if (!v || v === 'none') return 'none';
  const ref = /^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/i.exec(raw.trim());
  if (ref) return `url(#${ref[1]})`;                      // resolved against the shape's box in Importer.finish
  if (v === 'currentcolor') return current;
  if (v.startsWith('#')) {
    const x = v.slice(1);
    if (/^[0-9a-f]{3,4}$/.test(x)) return '#' + [...x].map(c => c + c).join('');
    if (/^[0-9a-f]{6}$/.test(x) || /^[0-9a-f]{8}$/.test(x)) return v;
    return '#000000';
  }
  const fn = /^rgba?\(([^)]+)\)$/.exec(v);
  if (fn) {
    const p = fn[1].split(/[\s,/]+/).filter(Boolean);
    const ch = (s: string) => s.endsWith('%') ? parseFloat(s) * 2.55 : parseFloat(s);
    const a = p[3] !== undefined ? (p[3].endsWith('%') ? parseFloat(p[3]) / 100 : parseFloat(p[3])) : 1;
    return `#${h2(ch(p[0]))}${h2(ch(p[1]))}${h2(ch(p[2]))}${a < 1 ? h2(a * 255) : ''}`;
  }
  if (v.startsWith('url(')) { warn('Patterns are not supported — replaced by grey.'); return '#808080'; }
  return NAMED[v] ?? canvasColor(v) ?? '#000000';
}

/** Multiplies an extra alpha (0..1) into a color. */
function withAlpha(color: string, alpha: number): string {
  if (color.startsWith('url(')) return alpha >= 1 ? color : `${color}@${round(alpha, 3)}`;   // opacity travels with the reference
  if (color === 'none' || alpha >= 1) return color;
  const base = color.slice(0, 7);
  const existing = color.length === 9 ? parseInt(color.slice(7), 16) / 255 : 1;
  return base + h2(existing * Math.max(0, alpha) * 255);
}

// ── style resolution ──────────────────────────────────────────────────────────

interface Paint {
  color: string; fill: string; stroke: string; strokeWidth: number;
  fillOpacity: number; strokeOpacity: number;
  linecap: LineCap; linejoin: LineJoin; dasharray: string; dashoffset: number; fillRule: 'nonzero' | 'evenodd';
  fontFamily: string; fontSize: number; fontWeight: number; fontStyle: 'normal' | 'italic';
  textAnchor: 'start' | 'middle' | 'end'; letterSpacing: number; wordSpacing: number; textDecoration: string;
}

const DEFAULT_PAINT: Paint = {
  color: '#000000', fill: '#000000', stroke: 'none', strokeWidth: 1, fillOpacity: 1, strokeOpacity: 1,
  linecap: 'butt', linejoin: 'miter', dasharray: '', dashoffset: 0, fillRule: 'nonzero',
  fontFamily: DEFAULT_TEXT_PROPS.fontFamily, fontSize: 16, fontWeight: 400, fontStyle: 'normal',
  textAnchor: 'start', letterSpacing: 0, wordSpacing: 0, textDecoration: '',
};

function styleMap(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  const src = el.getAttribute('style');
  if (!src) return out;
  for (const decl of src.split(';')) {
    const i = decl.indexOf(':');
    if (i > 0) out[decl.slice(0, i).trim().toLowerCase()] = decl.slice(i + 1).trim().replace(/\s*!important$/, '');
  }
  return out;
}

const num = (v: string | null | undefined): number | null => {
  if (v == null) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

function fontSizePx(v: string): number | null {
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return null;
  if (/pt\s*$/.test(v)) return n * 4 / 3;
  if (/(em|%)\s*$/.test(v)) return null;
  return n;
}

function resolvePaint(el: Element, parent: Paint, warn: (m: string) => void): Paint {
  const st = styleMap(el);
  const get = (n: string): string | null => {
    const v = st[n] ?? el.getAttribute(n);
    return v == null || v.trim() === '' || v.trim() === 'inherit' ? null : v.trim();
  };
  const p = { ...parent };
  let v: string | null;
  if ((v = get('color'))) p.color = normalizeColor(v, parent.color, warn);
  if ((v = get('fill'))) p.fill = normalizeColor(v, p.color, warn);
  if ((v = get('stroke'))) p.stroke = normalizeColor(v, p.color, warn);
  if ((v = get('stroke-width')) && num(v) !== null) p.strokeWidth = Math.max(0, num(v)!);
  if ((v = get('fill-opacity')) && num(v) !== null) p.fillOpacity = num(v)!;
  if ((v = get('stroke-opacity')) && num(v) !== null) p.strokeOpacity = num(v)!;
  if ((v = get('stroke-linecap')) && ['butt', 'round', 'square'].includes(v)) p.linecap = v as LineCap;
  if ((v = get('stroke-linejoin')) && ['miter', 'round', 'bevel'].includes(v)) p.linejoin = v as LineJoin;
  if ((v = get('stroke-dasharray'))) p.dasharray = v === 'none' ? '' : v;
  if ((v = get('stroke-dashoffset')) && num(v) !== null) p.dashoffset = num(v)!;
  if ((v = get('fill-rule')) && (v === 'nonzero' || v === 'evenodd')) p.fillRule = v;
  if ((v = get('font-family'))) p.fontFamily = v.split(',')[0].trim().replace(/^['"]|['"]$/g, '') || p.fontFamily;
  if ((v = get('font-size')) && fontSizePx(v) !== null) p.fontSize = fontSizePx(v)!;
  if ((v = get('font-weight'))) p.fontWeight = normWeight(v, p.fontWeight);
  if ((v = get('font-style'))) p.fontStyle = v === 'italic' || v === 'oblique' ? 'italic' : 'normal';
  if ((v = get('text-anchor')) && ['start', 'middle', 'end'].includes(v)) p.textAnchor = v as Paint['textAnchor'];
  if ((v = get('letter-spacing'))) p.letterSpacing = num(v) ?? 0;
  if ((v = get('word-spacing'))) p.wordSpacing = num(v) ?? 0;
  if ((v = get('text-decoration') ?? get('text-decoration-line'))) p.textDecoration = decorationLines(v).join(' ');
  return p;
}

// ── matrices ──────────────────────────────────────────────────────────────────

type MatrixKind =
  | { kind: 'axis'; sx: number; sy: number }            // translate + (non-uniform) scale
  | { kind: 'sim'; s: number; theta: number }            // translate + rotate + uniform scale
  | { kind: 'general'; s: number; theta: number };       // skew / flip / singular

function classify(m: Matrix): MatrixKind {
  const [a, b, c, d] = m;
  if (Math.abs(b) < 1e-9 && Math.abs(c) < 1e-9 && a > EPS && d > EPS) return { kind: 'axis', sx: a, sy: d };
  const s = Math.hypot(a, b);
  const theta = Math.atan2(b, a) * 180 / Math.PI;
  if (s > EPS && Math.abs(a - d) < 1e-6 * s && Math.abs(b + c) < 1e-6 * s) return { kind: 'sim', s, theta: normDeg(theta) };
  return { kind: 'general', s: Math.sqrt(Math.abs(a * d - b * c)), theta: normDeg(theta) };
}

const det = (m: Matrix) => Math.abs(m[0] * m[3] - m[1] * m[2]);

/** Rotate `s` by `theta` around the point `p` (our shapes rotate around their own centre). */
function rotateAboutPoint<S extends Shape>(s: S, p: { x: number; y: number }, theta: number): S {
  if (!theta) return s;
  const c = centerOf(getLocalBounds(s));
  const q = rotatePoint(c, p, theta);                 // where the centre ends up
  const placed = { ...s, rotation: normDeg(theta) };  // rotates about its own centre c
  const cPlaced = centerOf(getLocalBounds(placed));
  return translateShape(placed, q.x - cPlaced.x, q.y - cPlaced.y);
}

/** If `m` is a pure rotation (no scale, skew or mirror): its angle in degrees and fixed point. */
function pureRotation(m: Matrix): { theta: number; cx: number; cy: number } | null {
  const [a, b, c, d, e, f] = m;
  if (Math.abs(a - d) > 1e-6 || Math.abs(b + c) > 1e-6 || Math.abs(Math.hypot(a, b) - 1) > 1e-6) return null;
  const theta = normDeg(Math.atan2(b, a) * 180 / Math.PI);
  if (!theta) return null;
  // fixed point p solves (I − R)·p = (e, f)
  const k = (1 - a) * (1 - a) + b * b;
  if (k < 1e-12) return null;
  return { theta, cx: ((1 - a) * e - b * f) / k, cy: (b * e + (1 - a) * f) / k };
}

// ── importer ──────────────────────────────────────────────────────────────────

const SKIP = new Set([
  'defs', 'clippath', 'mask', 'style', 'script', 'title', 'desc', 'metadata', 'lineargradient', 'radialgradient',
  'pattern', 'marker', 'symbol', 'filter', 'foreignobject', 'namedview', 'font', 'font-face',
]);
const GENERIC_NAME = /^(path|rect|circle|ellipse|line|polygon|polyline|text|g|svg|shape|layer)[-_]?\d*$/i;

interface Ctx { m: Matrix; paint: Paint; opacity: number; }

class Importer {
  shapes: Shape[] = [];
  warnings = new Set<string>();
  private ids = new Map<string, Element>();
  private warn = (m: string) => { this.warnings.add(m); };

  constructor(root: Element, private max: number) {
    root.querySelectorAll('[id]').forEach(e => this.ids.set(e.getAttribute('id')!, e));
  }

  run(root: Element, m: Matrix) {
    const paint = resolvePaint(root, DEFAULT_PAINT, this.warn);
    for (const child of Array.from(root.children)) this.walk(child, { m, paint, opacity: 1 }, 0);
  }

  private count = 0;                       // shapes created so far, at any depth
  private groupDepth = 0;
  private full() { return this.count >= this.max; }

  private walk(el: Element, ctx: Ctx, depth: number) {
    if (this.full() || depth > 40) return;
    const tag = el.localName.toLowerCase();
    if (SKIP.has(tag)) return;
    const st = styleMap(el);
    if ((st['display'] ?? el.getAttribute('display')) === 'none') return;
    if (['hidden', 'collapse'].includes(st['visibility'] ?? el.getAttribute('visibility') ?? '')) return;

    const m = multiply(ctx.m, parseTransform(el.getAttribute('transform')));
    const paint = resolvePaint(el, ctx.paint, this.warn);
    const op = num(st['opacity'] ?? el.getAttribute('opacity'));
    const opacity = ctx.opacity * (op === null ? 1 : Math.min(1, Math.max(0, op)));
    const next: Ctx = { m, paint, opacity };

    switch (tag) {
      case 'g': return this.group(el, ctx, next, m, depth, op === null ? 1 : Math.min(1, Math.max(0, op)));
      case 'a': case 'switch':
        for (const c of Array.from(el.children)) this.walk(c, next, depth + 1);
        return;
      case 'svg': {
        const t = multiply(m, [1, 0, 0, 1, num(el.getAttribute('x')) ?? 0, num(el.getAttribute('y')) ?? 0]);
        for (const c of Array.from(el.children)) this.walk(c, { ...next, m: t }, depth + 1);
        return;
      }
      case 'use': return this.use(el, next, depth);
      case 'image': return this.image(el, next);
      case 'rect': return this.rect(el, next);
      case 'circle': case 'ellipse': return this.ellipse(el, next, tag === 'circle');
      case 'line': return this.line(el, next);
      case 'polyline': case 'polygon': return this.poly(el, next, tag === 'polygon');
      case 'path': return this.path(el, next);
      case 'text': return this.text(el, next);
    }
  }

  // — helpers —
  private n(el: Element, a: string) { return num(el.getAttribute(a)) ?? 0; }

  private style(p: Paint, m: Matrix): Style {
    const k = Math.sqrt(det(m));
    return { fill: withAlpha(p.fill, p.fillOpacity), stroke: withAlpha(p.stroke, p.strokeOpacity), strokeWidth: round(p.strokeWidth * k, 3) };
  }

  /** Applies the non-geometric attributes shared by all shapes. */
  private finish<S extends Shape>(shape: S, el: Element, ctx: Ctx): S {
    const k = Math.sqrt(det(ctx.m));
    const id = el.getAttribute('id') ?? '';
    const dash = ctx.paint.dasharray
      ? ctx.paint.dasharray.split(/[\s,]+/).map(Number).filter(Number.isFinite).map(v => round(v * k, 2)).join(' ')
      : '';
    const out = {
      ...shape,
      fill: this.resolvePaint(shape.fill, shape, ctx),
      stroke: this.resolvePaint(shape.stroke, shape, ctx),
      opacity: round(ctx.opacity, 3),
      strokeLinecap: ctx.paint.linecap,
      strokeLinejoin: ctx.paint.linejoin,
      strokeDasharray: dash,
      ...(dash && ctx.paint.dashoffset ? { strokeDashoffset: round(ctx.paint.dashoffset * k, 2) } : {}),
      name: id && !GENERIC_NAME.test(id) ? id : '',
    };
    return out;
  }

  // — gradients —

  /** 'url(#id)[@opacity]' → a gradient paint string (or the first stop's color when the gradient cannot be expressed). */
  private resolvePaint(paint: string, shape: Shape, ctx: Ctx): string {
    if (!paint.startsWith('url(')) return paint;
    const m = /^url\(#(.+?)\)(?:@([\d.]+))?$/.exec(paint);
    const el = m ? this.ids.get(m[1]) : undefined;
    const tag = el?.localName.toLowerCase();
    if (!m || !el || (tag !== 'lineargradient' && tag !== 'radialgradient')) {
      this.warn('A gradient or pattern could not be imported — replaced by grey.');
      return '#808080';
    }
    const alpha = m[2] ? Number(m[2]) : 1;
    const info = this.gradientInfo(el);
    if (!info.stops.length) return '#808080';
    const fade = (stops: Stop[]): Stop[] => alpha >= 1 ? stops : stops.map(st => ({ ...st, color: withAlpha(st.color, alpha) }));
    if (info.stops.length === 1) return fade(info.stops)[0].color;
    const b = getLocalBounds(shape);
    if (info.spread !== 'pad') this.warn('Gradient repeat / reflect is not supported — the gradient is padded.');
    if (info.hasFocal) this.warn('Gradient focal points are not supported.');

    // Points of the gradient in the shape's own, unrotated box (0..1 = box edge)
    const origin = getRotationOrigin(shape);
    const toBox = (x: number, y: number) => {
      let p = { x, y };
      if (!info.bbox) {
        p = applyMatrix(multiply(ctx.m, info.transform), p);
        if (shape.rotation) p = rotatePoint(p, origin, -shape.rotation);
        return { x: b.width ? (p.x - b.x) / b.width : 0.5, y: b.height ? (p.y - b.y) / b.height : 0.5 };
      }
      p = applyMatrix(info.transform, p);                // bbox units: gradientTransform acts in box space
      return p;
    };
    let g: Gradient;
    if (tag === 'lineargradient') {
      const A = toBox(info.x1, info.y1), B = toBox(info.x2, info.y2);
      const dx = B.x - A.x, dy = B.y - A.y;
      if (Math.hypot(dx, dy) < 1e-9) return fade(info.stops)[info.stops.length - 1].color;
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      // Our line always runs through the box centre and spans it; the imported one may not. Re-express the stops on ours.
      const a = (angle * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a), t = 0.5 * (Math.abs(c) + Math.abs(sn));
      const P0 = { x: 0.5 - c * t, y: 0.5 - sn * t }, L = 2 * t;
      const uA = ((A.x - P0.x) * c + (A.y - P0.y) * sn) / L, uB = ((B.x - P0.x) * c + (B.y - P0.y) * sn) / L;
      const mapped = info.stops.map(st => ({ ...st, offset: (uA + (st.offset / 100) * (uB - uA)) * 100 }));
      const at = (pos: number) => colorAt(info.stops, ((pos - uA * 100) / ((uB - uA) * 100 || 1)) * 100);
      const inside = mapped.filter(st => st.offset > 0 && st.offset < 100);
      const stops = [{ offset: 0, color: at(0) }, ...inside, { offset: 100, color: at(100) }];
      g = { type: 'linear', angle: round(angle, 2), stops: fade(stops.map(st => ({ ...st, offset: round(st.offset, 2) }))) };
    } else {
      const C = toBox(info.cx, info.cy);
      const k = info.bbox ? 1 : Math.sqrt(Math.abs(det(multiply(ctx.m, info.transform)))) / (Math.max(b.width, b.height) || 1);
      g = { type: 'radial', cx: round(C.x * 100, 2), cy: round(C.y * 100, 2), r: round(Math.max(1, info.r * k * 100), 2), stops: fade(info.stops) };
    }
    return formatGradient(g);
  }

  /** Everything needed from a gradient element, following xlink:href / href chains for stops, units, transform and coordinates. */
  private gradientInfo(el: Element) {
    const chain: Element[] = [];
    let cur: Element | undefined = el;
    while (cur && chain.length < 8 && !chain.includes(cur)) {
      chain.push(cur);
      const refId: string = (cur.getAttribute('href') ?? cur.getAttribute('xlink:href') ?? '').replace(/^#/, '');
      cur = refId ? this.ids.get(refId) : undefined;
    }
    const attr = (name: string) => { for (const e of chain) { const v = e.getAttribute(name); if (v != null && v.trim() !== '') return v.trim(); } return null; };
    const stopsEl = chain.find(e => e.querySelector(':scope > stop')) ?? el;
    const bbox = attr('gradientUnits') !== 'userSpaceOnUse';
    const pc = (name: string, d: number) => {
      const v = attr(name);
      if (v == null) return d;
      const n = parseFloat(v);
      return Number.isFinite(n) ? (v.endsWith('%') ? n / 100 : n) : d;
    };
    const stops: Stop[] = [];
    let last = 0;
    for (const st of Array.from(stopsEl.children).filter(c => c.localName.toLowerCase() === 'stop')) {
      const sm = styleMap(st);
      const raw = sm['offset'] ?? st.getAttribute('offset') ?? '0';
      let off = parseFloat(raw); if (!Number.isFinite(off)) off = 0;
      off = Math.min(1, Math.max(last, raw.trim().endsWith('%') ? off / 100 : off)); last = off;
      let color = normalizeColor(sm['stop-color'] ?? st.getAttribute('stop-color') ?? '#000000', '#000000', this.warn);
      if (color === 'none' || color.startsWith('url(')) color = '#000000';
      const so = num(sm['stop-opacity'] ?? st.getAttribute('stop-opacity'));
      stops.push({ offset: round(off * 100, 2), color: withAlpha(color, so === null ? 1 : Math.min(1, Math.max(0, so))) });
    }
    return {
      stops, bbox,
      spread: attr('spreadMethod') ?? 'pad',
      transform: parseTransform(attr('gradientTransform')),
      x1: pc('x1', 0), y1: pc('y1', 0), x2: pc('x2', bbox ? 1 : 0), y2: pc('y2', 0),
      cx: pc('cx', bbox ? 0.5 : 0), cy: pc('cy', bbox ? 0.5 : 0), r: pc('r', bbox ? 0.5 : 0),
      hasFocal: (() => { const fx = attr('fx'), fy = attr('fy'); return (fx != null && pc('fx', 0) !== pc('cx', 0)) || (fy != null && pc('fy', 0) !== pc('cy', 0)); })(),
    };
  }

  private push(shape: Shape) { if (!this.full()) { this.shapes.push(shape); this.count++; } }

  /** Runs `fn`, collecting everything it pushes into a separate list. */
  private collect(fn: () => void): Shape[] {
    const outer = this.shapes;
    this.shapes = [];
    try { fn(); return this.shapes; }
    finally { this.shapes = outer; }
  }

  /**
   * <g> → GroupShape. Children keep their absolute coordinates (the transforms of everything
   * above them are baked in, as for any shape). A group whose own transform is a pure rotation
   * about the centre of its content — exactly what the exporter writes — keeps that rotation
   * as the group's `rotation`; any other group transform is baked into the children.
   */
  private group(el: Element, ctx: Ctx, next: Ctx, m: Matrix, depth: number, opacity: number) {
    const kids = Array.from(el.children);
    const emit = (matrix: Matrix) => this.collect(() => {
      this.groupDepth++;
      try { for (const c of kids) this.walk(c, { ...next, m: matrix, opacity: ctx.opacity }, depth + 1); }
      finally { this.groupDepth--; }
    });
    const make = (children: Shape[], rotation: number): Shape => ({
      id: uid(), name: (() => { const id = el.getAttribute('id') ?? ''; return id && !GENERIC_NAME.test(id) ? id : ''; })(),
      visible: true, fill: 'none', stroke: 'none', strokeWidth: 0, opacity: round(opacity, 3), rotation,
      strokeLinecap: 'round', strokeLinejoin: 'round', strokeDasharray: '',
      type: 'group', children,
    });

    if (this.groupDepth + 1 >= MAX_GROUP_DEPTH) {          // too deep for the model: flatten
      for (const c of kids) this.walk(c, next, depth + 1);
      return;
    }

    const own = parseTransform(el.getAttribute('transform'));
    const rot = pureRotation(own);
    const pk = classify(ctx.m);
    const similar = (pk.kind === 'axis' && Math.abs(pk.sx - pk.sy) < 1e-9) || pk.kind === 'sim';
    const n0 = this.count;
    if (rot && similar) {
      const children = emit(ctx.m);                        // attempt: keep the rotation on the group
      if (!children.length) return;
      const probe = make(children, rot.theta) as GroupShape;
      const o = getRotationOrigin(probe), want = applyMatrix(ctx.m, { x: rot.cx, y: rot.cy });
      if (Math.hypot(o.x - want.x, o.y - want.y) < 0.01) { this.push(probe); return; }
      this.count = n0;                                     // different pivot: fall back to baking
    }
    const children = emit(m);
    if (children.length) this.push(make(children, 0));
  }

  // — elements —
  private use(el: Element, ctx: Ctx, depth: number) {
    const href = el.getAttribute('href') ?? el.getAttribute('xlink:href')
      ?? el.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ?? '';
    const target = href.startsWith('#') ? this.ids.get(href.slice(1)) : undefined;
    if (!target) { this.warn('A <use> element referenced something that could not be found.'); return; }
    const m = multiply(ctx.m, [1, 0, 0, 1, this.n(el, 'x'), this.n(el, 'y')]);
    const next = { ...ctx, m };
    if (target.localName.toLowerCase() === 'symbol') {
      const paint = resolvePaint(target, ctx.paint, this.warn);
      for (const c of Array.from(target.children)) this.walk(c, { ...next, paint }, depth + 1);
    } else this.walk(target, next, depth + 1);
  }

  private rect(el: Element, ctx: Ctx) {
    const x = this.n(el, 'x'), y = this.n(el, 'y'), w = this.n(el, 'width'), h = this.n(el, 'height');
    if (w <= 0 || h <= 0) return;
    let rx = num(el.getAttribute('rx')), ry = num(el.getAttribute('ry'));
    if (rx === null && ry === null) { rx = 0; ry = 0; } else { rx ??= ry!; ry ??= rx; }
    rx = Math.min(Math.max(rx, 0), w / 2); ry = Math.min(Math.max(ry!, 0), h / 2);
    const st = this.style(ctx.paint, ctx.m);
    const k = classify(ctx.m);

    if (k.kind === 'axis') {
      const p = applyMatrix(ctx.m, { x: x, y: y });
      const r = makeRect(p.x, p.y, w * k.sx, h * k.sy, st);
      r.rx = rx * k.sx; r.ry = ry * k.sy;
      return this.push(this.finish(r, el, ctx));
    }
    if (k.kind === 'sim') {
      const c = applyMatrix(ctx.m, { x: x + w / 2, y: y + h / 2 });
      const W = w * k.s, H = h * k.s;
      const r = makeRect(c.x - W / 2, c.y - H / 2, W, H, st);
      r.rx = rx * k.s; r.ry = ry * k.s; r.rotation = k.theta;
      return this.push(this.finish(r, el, ctx));
    }
    const base = makeRect(x, y, w, h, st); base.rx = rx; base.ry = ry;
    const path = toPathShape(base)!;
    this.push(this.finish({ ...path, nodes: transformNodes(path.nodes, ctx.m) }, el, ctx));
  }

  /** <image>: a data: URL or an http(s) link. Other references (relative files) cannot be resolved here. */
  private image(el: Element, ctx: Ctx) {
    const href = el.getAttribute('href') ?? el.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ?? el.getAttribute('xlink:href') ?? '';
    if (!/^data:image\//.test(href) && !/^https?:\/\//.test(href)) { this.warn('An image that refers to a separate file could not be imported.'); return; }
    let x = this.n(el, 'x');
    const y = this.n(el, 'y'), w = this.n(el, 'width'), h = this.n(el, 'height');
    if (w <= 0 || h <= 0) { this.warn('An image without a width and height was skipped.'); return; }
    // A mirroring transform becomes flipX (about the box centre), like text.
    let m = ctx.m;
    const flipX = m[0] * m[3] - m[1] * m[2] < 0;
    if (flipX) { m = [-m[0], -m[1], m[2], m[3], m[4], m[5]]; x = -x - w; }
    const k = classify(m);
    if (k.kind === 'general') this.warn('A skewed image was approximated (rotation and scale only).');
    const s = k.kind === 'axis' ? 1 : k.s;
    const W = w * (k.kind === 'axis' ? k.sx : s), H = h * (k.kind === 'axis' ? k.sy : s);
    const c = applyMatrix(m, { x: x + w / 2, y: y + h / 2 });
    const img: ImageShape = { ...makeImage(c.x - W / 2, c.y - H / 2, W, H, href), rotation: k.kind === 'axis' ? 0 : k.theta };
    const par = el.getAttribute('preserveAspectRatio');
    if (par && par.trim() !== 'none') img.preserveAspectRatio = par.trim(); else if (!par) img.preserveAspectRatio = 'xMidYMid meet';   // the SVG default
    if (flipX) img.flipX = true;
    const done = this.finish(img, el, ctx);
    this.push({ ...done, fill: 'none', stroke: 'none', strokeWidth: 0 });
  }

  private ellipse(el: Element, ctx: Ctx, circle: boolean) {
    const cx = this.n(el, 'cx'), cy = this.n(el, 'cy');
    const rx = circle ? this.n(el, 'r') : this.n(el, 'rx'), ry = circle ? rx : this.n(el, 'ry');
    if (rx <= 0 || ry <= 0) return;
    const st = this.style(ctx.paint, ctx.m);
    const k = classify(ctx.m);
    const c = applyMatrix(ctx.m, { x: cx, y: cy });
    if (k.kind === 'axis') return this.push(this.finish(makeEllipse(c.x, c.y, rx * k.sx, ry * k.sy, st), el, ctx));
    if (k.kind === 'sim') {
      const e = makeEllipse(c.x, c.y, rx * k.s, ry * k.s, st); e.rotation = k.theta;
      return this.push(this.finish(e, el, ctx));
    }
    const path = toPathShape(makeEllipse(cx, cy, rx, ry, st))!;
    this.push(this.finish({ ...path, nodes: transformNodes(path.nodes, ctx.m) }, el, ctx));
  }

  private line(el: Element, ctx: Ctx) {
    const a = applyMatrix(ctx.m, { x: this.n(el, 'x1'), y: this.n(el, 'y1') });
    const b = applyMatrix(ctx.m, { x: this.n(el, 'x2'), y: this.n(el, 'y2') });
    this.push(this.finish(makeLine(a, b, this.style(ctx.paint, ctx.m)), el, ctx));
  }

  private poly(el: Element, ctx: Ctx, closed: boolean) {
    const raw = (el.getAttribute('points') ?? '').trim().split(/[\s,]+/).map(Number);
    const nodes: PathNode[] = [];
    for (let i = 0; i + 1 < raw.length; i += 2) {
      if (Number.isFinite(raw[i]) && Number.isFinite(raw[i + 1])) {
        const p = applyMatrix(ctx.m, { x: raw[i], y: raw[i + 1] });
        nodes.push(corner(p.x, p.y));
      }
    }
    if (nodes.length < 2) return;
    this.push(this.finish(makePath(nodes, closed, this.style(ctx.paint, ctx.m), true), el, ctx));
  }

  private path(el: Element, ctx: Ctx) {
    const d = el.getAttribute('d');
    if (!d) return;
    const subs = parsePathData(d);
    const st = this.style(ctx.paint, ctx.m);
    if (subs.length > 1 && subs.every(sp => sp.closed)) {             // donuts, glyphs: ONE compound path
      const shape = makePath(joinContours(subs.map(sp => transformNodes(sp.nodes, ctx.m))), true, st, true);
      if (ctx.paint.fillRule === 'evenodd') shape.fillRule = 'evenodd';
      return void this.push(this.finish(shape, el, ctx));
    }
    if (subs.length > 1) this.warn('Paths mixing open and closed sub-paths were split into separate shapes.');
    for (const sp of subs) {
      this.push(this.finish(makePath(transformNodes(sp.nodes, ctx.m), sp.closed, st, true), el, ctx));
    }
  }

  private text(el: Element, ctx: Ctx) {
    const preserve = (el.getAttribute('xml:space') ?? el.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'space')) === 'preserve'
      || /white-space\s*:\s*pre/.test(el.getAttribute('style') ?? '');
    const lines: string[] = [''];
    const collect = (node: Node) => {
      for (const ch of Array.from(node.childNodes)) {
        if (ch.nodeType === 3) {
          let t = ch.textContent ?? '';
          t = preserve ? t.replace(/[\r\n\t]/g, ' ') : t.replace(/\s+/g, ' ');
          lines[lines.length - 1] += t;
        } else if (ch.nodeType === 1) {
          const e = ch as Element;
          const isNewLine = e.localName === 'tspan' && (e.hasAttribute('x') || e.hasAttribute('dy'));
          if (isNewLine && (lines.length > 1 || lines[0].trim() !== '')) lines.push('');
          collect(e);
        }
      }
    };
    collect(el);
    const content = (preserve ? lines : lines.map(l => l.trim())).join('\n').replace(/^\n+|\n+$/g, '');
    if (!content.trim()) return;

    const firstSpan = el.querySelector('tspan');
    const first = (name: string): number => {
      const own = (el.getAttribute(name) ?? '').split(/[\s,]+/)[0];
      const fromSpan = (firstSpan?.getAttribute(name) ?? '').split(/[\s,]+/)[0];
      return num(own) ?? num(fromSpan) ?? 0;
    };
    let x = first('x');
    const y = first('y') + (num(el.getAttribute('dy')) ?? 0);
    // Line height: the dy of the second line, when the lines are tspans.
    const lineDy = [...el.querySelectorAll('tspan')].slice(1).map(t => num(t.getAttribute('dy'))).find(v => v !== null && v > 0);
    const lineHeight = lineDy ? Math.min(5, Math.max(0.5, round(lineDy / ctx.paint.fontSize, 3))) : LINE_HEIGHT;
    const local: TextProps = {
      fontFamily: ctx.paint.fontFamily, fontSize: ctx.paint.fontSize, fontWeight: ctx.paint.fontWeight, fontStyle: ctx.paint.fontStyle,
      textDecoration: ctx.paint.textDecoration, textAnchor: ctx.paint.textAnchor, letterSpacing: ctx.paint.letterSpacing,
      wordSpacing: ctx.paint.wordSpacing, lineHeight,
    };

    // A mirroring transform becomes flipX: m = m2 · mirror(x = 0), and mirroring about x = 0 is mirroring the text
    // box about its own centre (what flipX does) followed by a shift of −2 × its centre.
    let m = ctx.m;
    const flipX = m[0] * m[3] - m[1] * m[2] < 0;
    if (flipX) {
      const lb = textBounds({ ...makeText(x, y, content, local, { fill: '#000', stroke: 'none', strokeWidth: 0 }) });
      m = [-m[0], -m[1], m[2], m[3], m[4], m[5]];
      x -= 2 * (lb.x + lb.width / 2);
    }

    const k = classify(m);
    const s = k.kind === 'axis' ? Math.sqrt(k.sx * k.sy) : k.s;
    const theta = k.kind === 'axis' ? 0 : k.theta;
    if (k.kind === 'general') this.warn('Skewed text was approximated (rotation and scale only).');
    const p = applyMatrix(m, { x, y });

    const tp: TextProps = {
      ...local, fontSize: Math.max(1, round(local.fontSize * s, 2)),
      letterSpacing: round(local.letterSpacing * s, 3), wordSpacing: round(local.wordSpacing * s, 3),
    };
    const made = makeText(p.x, p.y, content, tp, { fill: withAlpha(ctx.paint.fill, ctx.paint.fillOpacity), stroke: 'none', strokeWidth: 0 });
    const base = flipX ? { ...made, flipX: true } : made;
    this.push(this.finish(rotateAboutPoint(base, p, theta), el, ctx));
  }
}

// ── entry point ───────────────────────────────────────────────────────────────

const UNITS: Record<string, number> = { px: 1, pt: 4 / 3, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 };

function parseLength(v: string | null): number | undefined {
  if (!v) return undefined;
  const m = /^\s*([+-]?[\d.]+(?:e[+-]?\d+)?)\s*([a-z%]*)\s*$/i.exec(v);
  if (!m || m[2] === '%') return undefined;
  const n = parseFloat(m[1]) * (m[2] ? UNITS[m[2].toLowerCase()] ?? NaN : 1);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Throws Error with a user-presentable message if the text is not a usable SVG. */
export function importSvg(text: string, opts: ImportOptions = {}): ImportResult {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || doc.getElementsByTagName('parsererror').length || root.localName.toLowerCase() !== 'svg') {
    throw new Error('This file is not a valid SVG.');
  }

  let width = parseLength(root.getAttribute('width'));
  let height = parseLength(root.getAttribute('height'));
  const vb = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  const hasVb = vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0;
  let m: Matrix = IDENTITY;
  if (hasVb) {
    width ??= vb[2]; height ??= vb[3];
    const s = Math.min(width / vb[2], height / vb[3]);                  // preserveAspectRatio default: xMidYMid meet
    m = [s, 0, 0, s, -vb[0] * s + (width - vb[2] * s) / 2, -vb[1] * s + (height - vb[3] * s) / 2];
  }

  const max = opts.maxShapes ?? 5000;
  const imp = new Importer(root, max);
  imp.run(root, m);
  if (imp.shapes.length >= max) imp.warnings.add(`Import stopped at ${max} shapes.`);
  if ([...doc.getElementsByTagName('style')].some(s => /(^|})\s*[^@{}\s][^{}]*\{/.test(s.textContent ?? ''))) {
    imp.warnings.add('CSS stylesheets (<style> rules) are not applied.');
  }
  return {
    shapes: imp.shapes,
    width: width && Math.round(width), height: height && Math.round(height),
    warnings: [...imp.warnings],
  };
}
