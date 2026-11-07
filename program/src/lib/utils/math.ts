/**
 * @file Geometry helpers: points, rotation, affine matrices, rounding.
 */

import type { Point } from './types';

export const EPS = 1e-6;

export const toRad = (deg: number) => deg * Math.PI / 180;
export const normDeg = (deg: number) => ((deg % 360) + 360) % 360;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const round = (n: number, d = 2) => { const f = 10 ** d; return Math.round(n * f) / f; };
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const lerpPt = (a: Point, b: Point, t: number): Point => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
export const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Rotate `p` around `c` by `deg` degrees (positive = clockwise on screen, like SVG rotate()). */
export function rotatePoint(p: Point, c: Point, deg: number): Point {
  if (!deg) return { x: p.x, y: p.y };
  const r = toRad(deg), cos = Math.cos(r), sin = Math.sin(r);
  const dx = p.x - c.x, dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

// ── Affine matrices [a b c d e f] — same layout as SVG matrix(a b c d e f) ──────
export type Matrix = readonly [number, number, number, number, number, number];
export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** m1 · m2  (m2 is applied first). */
export function multiply(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

export function applyMatrix(m: Matrix, p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

/** True when the matrix only translates and scales by positive factors (no rotation/skew/flip). */
export function isTranslateScale(m: Matrix): boolean {
  return Math.abs(m[1]) < EPS && Math.abs(m[2]) < EPS && m[0] > EPS && m[3] > EPS;
}

export function isIdentity(m: Matrix): boolean {
  return m.every((v, i) => Math.abs(v - IDENTITY[i]) < EPS);
}

/** Parses an SVG `transform` attribute (matrix, translate, scale, rotate, skewX, skewY). */
export function parseTransform(src: string | null | undefined): Matrix {
  let m: Matrix = IDENTITY;
  if (!src) return m;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let mt: RegExpExecArray | null;
  while ((mt = re.exec(src))) {
    const a = mt[2].split(/[\s,]+/).filter(Boolean).map(Number);
    if (a.some(Number.isNaN)) continue;
    let t: Matrix = IDENTITY;
    switch (mt[1]) {
      case 'matrix':    if (a.length === 6) t = a as unknown as Matrix; break;
      case 'translate': t = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0]; break;
      case 'scale':     t = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0]; break;
      case 'rotate': {
        const r = toRad(a[0] ?? 0), cs = Math.cos(r), sn = Math.sin(r);
        const rm: Matrix = [cs, sn, -sn, cs, 0, 0];
        t = a.length >= 3
          ? multiply(multiply([1, 0, 0, 1, a[1], a[2]], rm), [1, 0, 0, 1, -a[1], -a[2]])
          : rm;
        break;
      }
      case 'skewX': t = [1, 0, Math.tan(toRad(a[0] ?? 0)), 1, 0, 0]; break;
      case 'skewY': t = [1, Math.tan(toRad(a[0] ?? 0)), 0, 1, 0, 0]; break;
    }
    m = multiply(m, t);
  }
  return m;
}
