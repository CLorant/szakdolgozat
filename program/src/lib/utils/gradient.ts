/**
 * @file Gradient paints.
 *
 * A gradient is stored IN the shape's fill / stroke string, exactly where a color would be:
 *
 *     lg:<angle>;<color>@<pos>,<color>@<pos>,…          linear, angle in degrees (0 = left → right, 90 = top → bottom)
 *     rg:<cx>,<cy>,<r>;<color>@<pos>,…                  radial, centre and radius in % of the shape's box
 *
 * <color> is '#rrggbb' or '#rrggbbaa', <pos> is 0–100 (%). Because the paint is a plain string, everything that already
 * handles fills (undo, duplicate, groups, copy & paste, the project file) handles gradients too, with no shared "defs"
 * table to keep in sync. Gradients are relative to the shape's bounding box (SVG objectBoundingBox), so they move,
 * scale and rotate with the shape. Renderers turn the string into a <linearGradient> / <radialGradient> (see GradientDefs
 * and the serializer).
 *
 * Known SVG limitation: a bounding box with zero width or height (a perfectly horizontal / vertical line) cannot show
 * an objectBoundingBox gradient: browsers draw nothing. Tilt the line by a pixel or use a thin rectangle.
 */

export interface Stop { offset: number; color: string; }
export type Gradient =
  | { type: 'linear'; angle: number; stops: Stop[] }
  | { type: 'radial'; cx: number; cy: number; r: number; stops: Stop[] };

const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const num = (n: number, d = 2) => String(Math.round(n * 10 ** d) / 10 ** d);

export const isGradient = (paint: string): boolean => paint.startsWith('lg:') || paint.startsWith('rg:');

export function parseGradient(paint: string): Gradient | null {
  if (typeof paint !== 'string' || !isGradient(paint)) return null;
  const semi = paint.indexOf(';');
  if (semi < 0) return null;
  const head = paint.slice(3, semi).split(',').map(Number);
  const stops: Stop[] = [];
  for (const part of paint.slice(semi + 1).split(',')) {
    const [color, pos] = part.split('@');
    const offset = Number(pos);
    if (!HEX.test(color) || !Number.isFinite(offset)) return null;
    stops.push({ color: color.toLowerCase(), offset: clamp(offset, 0, 100) });
  }
  if (stops.length < 2 || stops.length > 16 || head.some(n => !Number.isFinite(n))) return null;
  stops.sort((a, b) => a.offset - b.offset);
  if (paint[0] === 'l') return head.length === 1 ? { type: 'linear', angle: head[0], stops } : null;
  return head.length === 3 ? { type: 'radial', cx: head[0], cy: head[1], r: clamp(head[2], 1, 200), stops } : null;
}

export function formatGradient(g: Gradient): string {
  const stops = [...g.stops].sort((a, b) => a.offset - b.offset).map(s => `${s.color.toLowerCase()}@${num(s.offset)}`).join(',');
  return g.type === 'linear'
    ? `lg:${num(((g.angle % 360) + 360) % 360)};${stops}`
    : `rg:${num(g.cx)},${num(g.cy)},${num(g.r)};${stops}`;
}

/** Is `paint` a usable value: a color, 'none' or a well-formed gradient? */
export const isValidPaint = (paint: unknown): paint is string =>
  typeof paint === 'string' && (paint === 'none' || HEX.test(paint) || parseGradient(paint) !== null);

// ── building ──────────────────────────────────────────────────────────────────

const withAlpha0 = (c: string) => c.slice(0, 7) + '00';
const baseColor = (paint: string) => (HEX.test(paint) ? paint : '#808080');

/** A fresh two-stop gradient from a plain color (to the same color fully transparent). */
export function gradientFrom(paint: string, type: 'linear' | 'radial'): Gradient {
  const g = parseGradient(paint);
  if (g) return convertGradient(g, type);
  const c = baseColor(paint);
  const stops = [{ offset: 0, color: c }, { offset: 100, color: withAlpha0(c) }];
  return type === 'linear' ? { type, angle: 0, stops } : { type, cx: 50, cy: 50, r: 50, stops };
}

export function convertGradient(g: Gradient, type: 'linear' | 'radial'): Gradient {
  if (g.type === type) return g;
  return type === 'linear' ? { type, angle: 0, stops: g.stops } : { type, cx: 50, cy: 50, r: 50, stops: g.stops };
}

/** The plain color a gradient stands for where only one color fits (the first stop). */
export const solidOf = (paint: string): string => parseGradient(paint)?.stops[0].color ?? paint;

export const reverseStops = (stops: readonly Stop[]): Stop[] =>
  stops.map(s => ({ ...s, offset: 100 - s.offset })).reverse();

/** The color at `pos` % of the gradient (linear interpolation of RGBA, used when a stop is added in the middle). */
export function colorAt(stops: readonly Stop[], pos: number): string {
  const s = [...stops].sort((a, b) => a.offset - b.offset);
  if (pos <= s[0].offset) return s[0].color;
  if (pos >= s[s.length - 1].offset) return s[s.length - 1].color;
  const i = s.findIndex(x => x.offset >= pos);
  const a = s[i - 1], b = s[i], t = (pos - a.offset) / ((b.offset - a.offset) || 1);
  const ch = (c: string) => [1, 3, 5, 7].map((k, j) => c.length > k ? parseInt(c.slice(k, k + 2), 16) : j === 3 ? 255 : 0);
  const [ca, cb] = [ch(a.color), ch(b.color)];
  const mix = ca.map((v, k) => Math.round(v + (cb[k] - v) * t));
  return '#' + mix.map(v => v.toString(16).padStart(2, '0')).join('').replace(/ff$/, '');
}

// ── output ────────────────────────────────────────────────────────────────────

/** x1 y1 x2 y2 in bounding-box units for a CSS-like angle: the line runs through the centre and spans the whole box. */
export function linearCoords(angleDeg: number) {
  const a = (angleDeg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const t = 0.5 * (Math.abs(c) + Math.abs(s));
  const r = (n: number) => Math.round(n * 1e4) / 1e4;
  return { x1: r(0.5 - c * t), y1: r(0.5 - s * t), x2: r(0.5 + c * t), y2: r(0.5 + s * t) };
}

/** '#rrggbbaa' → color + opacity for <stop>. */
export function stopPaint(color: string): { color: string; opacity: number } {
  return color.length === 9
    ? { color: color.slice(0, 7), opacity: Math.round(parseInt(color.slice(7, 9), 16) / 255 * 1000) / 1000 }
    : { color, opacity: 1 };
}

/** Safe element id for a shape's paint. */
export const paintId = (shapeId: string, which: 'fill' | 'stroke') => `g-${shapeId.replace(/[^A-Za-z0-9_-]/g, '_')}-${which === 'fill' ? 'f' : 's'}`;

/** The <linearGradient> / <radialGradient> element as SVG text. */
export function gradientSvg(g: Gradient, id: string, indent = '  '): string {
  const stops = g.stops.map(s => {
    const p = stopPaint(s.color);
    return `${indent}  <stop offset="${num(s.offset / 100, 4)}" stop-color="${p.color}"${p.opacity < 1 ? ` stop-opacity="${p.opacity}"` : ''}/>`;
  }).join('\n');
  if (g.type === 'linear') {
    const c = linearCoords(g.angle);
    return `${indent}<linearGradient id="${id}" x1="${c.x1}" y1="${c.y1}" x2="${c.x2}" y2="${c.y2}">\n${stops}\n${indent}</linearGradient>`;
  }
  return `${indent}<radialGradient id="${id}" cx="${num(g.cx / 100, 4)}" cy="${num(g.cy / 100, 4)}" r="${num(g.r / 100, 4)}">\n${stops}\n${indent}</radialGradient>`;
}

/** CSS background for previews (the bar in the editor, the dot in the Layers panel). */
export function gradientCss(g: Gradient, forceLinear = false): string {
  const stops = g.stops.map(s => {
    const p = stopPaint(s.color);
    const rgb = [1, 3, 5].map(k => parseInt(p.color.slice(k, k + 2), 16)).join(',');
    return `rgba(${rgb},${p.opacity}) ${s.offset}%`;
  }).join(', ');
  // CSS angles: 0deg = up, 90deg = right; ours: 0 = right, 90 = down
  if (g.type === 'linear') return `linear-gradient(${g.angle + 90}deg, ${stops})`;
  return forceLinear ? `linear-gradient(90deg, ${stops})` : `radial-gradient(circle at ${g.cx}% ${g.cy}%, ${stops})`;
}
