import type { Shape, Point, BoundingBox } from './types';

const HIT_TOL = 6;

// ── Bounding Box ─────────────────────────────────────────────────────────────

export function getShapeBoundingBox(shape: Shape): BoundingBox {
  switch (shape.type) {
    case 'line': {
      const x = Math.min(shape.x1, shape.x2);
      const y = Math.min(shape.y1, shape.y2);
      return { x, y, width: Math.abs(shape.x2 - shape.x1) || 1, height: Math.abs(shape.y2 - shape.y1) || 1 };
    }
    case 'rectangle':
      return { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
    case 'ellipse':
      return { x: shape.cx - shape.rx, y: shape.cy - shape.ry, width: shape.rx * 2, height: shape.ry * 2 };
    case 'polygon': {
      if (shape.points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
      const xs = shape.points.map(p => p.x);
      const ys = shape.points.map(p => p.y);
      const x = Math.min(...xs), y = Math.min(...ys);
      return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
    }
    case 'text': {
      const lines   = ((shape as any).content || '').split('\n');
      const maxLen  = Math.max(...lines.map((l: string) => l.length), 1);
      const numLines = Math.max(lines.length, 1);
      const w = (shape as any).fontSize * maxLen * 0.6 || 20;
      const h = (shape as any).fontSize * 1.25 * numLines || 20;
      return { x: shape.x, y: shape.y - ((shape as any).fontSize ?? 16), width: w, height: h };
    }
    default: {
      const p = (shape as any).points as Point[];
      if (!p || p.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
      const xs = p.map(pt => pt.x);
      const ys = p.map(pt => pt.y);
      const x = Math.min(...xs), y = Math.min(...ys);
      return { x, y, width: Math.max(...xs) - x || 1, height: Math.max(...ys) - y || 1 };
    }
  }
}

// ── Hit testing ──────────────────────────────────────────────────────────────

export function isPointInShape(point: Point, shape: Shape): boolean {
  if (shape.visible === false) return false;
  const tol = HIT_TOL + shape.strokeWidth / 2;

  switch (shape.type) {
    case 'line': {
      const dx = shape.x2 - shape.x1, dy = shape.y2 - shape.y1;
      const lenSq = dx * dx + dy * dy;
      if (lenSq === 0) return dist(point, { x: shape.x1, y: shape.y1 }) <= tol;
      const t = Math.max(0, Math.min(1, ((point.x - shape.x1) * dx + (point.y - shape.y1) * dy) / lenSq));
      return dist(point, { x: shape.x1 + t * dx, y: shape.y1 + t * dy }) <= tol;
    }
    case 'rectangle':
      return point.x >= shape.x - tol && point.x <= shape.x + shape.width + tol &&
             point.y >= shape.y - tol && point.y <= shape.y + shape.height + tol;
    case 'ellipse': {
      const nx = (point.x - shape.cx) / (shape.rx + tol);
      const ny = (point.y - shape.cy) / (shape.ry + tol);
      return nx * nx + ny * ny <= 1;
    }
    case 'text': {
      const bb = getShapeBoundingBox(shape);
      return point.x >= bb.x - tol && point.x <= bb.x + bb.width + tol &&
             point.y >= bb.y - tol && point.y <= bb.y + bb.height + tol;
    }
    case 'polygon':
      return pointInPolygon(point, shape.points) || nearPolyline(point, shape.points, tol, shape.closed);
    default:
      return nearPolyline(point, (shape as any).points ?? [], tol, false);
  }
}

export function shapeIntersectsRect(shape: Shape, rect: BoundingBox): boolean {
  const bb = getShapeBoundingBox(shape);
  return !(bb.x + bb.width < rect.x || bb.x > rect.x + rect.width ||
           bb.y + bb.height < rect.y || bb.y > rect.y + rect.height);
}

// ── Translate ────────────────────────────────────────────────────────────────

export function translateShape(shape: Shape, dx: number, dy: number): Partial<Shape> {
  switch (shape.type) {
    case 'line':
      return { x1: shape.x1 + dx, y1: shape.y1 + dy, x2: shape.x2 + dx, y2: shape.y2 + dy };
    case 'rectangle':
      return { x: shape.x + dx, y: shape.y + dy };
    case 'ellipse':
      return { cx: shape.cx + dx, cy: shape.cy + dy };
    case 'text':
      return { x: shape.x + dx, y: shape.y + dy };
    case 'polygon':
      return { points: shape.points.map(p => ({ x: p.x + dx, y: p.y + dy })) };
    default: {
      const s = shape as any;
      const newPoints = (s.points as Point[]).map((p: Point) => ({ x: p.x + dx, y: p.y + dy }));

      let pathData: string;
      if (shape.type === 'arc') {
        /*
         * FIX: for arc paths, do NOT run the coordinate-pair regex over the
         * pathData string. An arc path looks like:
         *   M x0,y0 A rx,ry 0 large-arc sweep x1,y1
         * The regex would correctly match x0,y0 and x1,y1 but also rx,ry,
         * incorrectly treating them as canvas coordinates and adding dx/dy to
         * the radii. Instead, rebuild the arc path from the translated points.
         */
        pathData = _rebuildArcPath(newPoints);
      } else {
        // For freehand / quadratic-bezier / cubic-bezier: all comma-separated
        // pairs are coordinate pairs so the regex is safe.
        pathData = s.pathData.replace(/(-?[\d.]+),(-?[\d.]+)/g, (_: string, x: string, y: string) =>
          `${parseFloat(x) + dx},${parseFloat(y) + dy}`
        );
      }

      return { points: newPoints, pathData };
    }
  }
}

// ── Resize by handle ─────────────────────────────────────────────────────────

export function resizeShape(
  shape: Shape,
  handleId: string,
  dx: number, dy: number,
  originalBB: BoundingBox
): Partial<Shape> | null {
  let { x, y, width, height } = originalBB;

  switch (handleId) {
    case 'nw': x += dx; y += dy; width -= dx; height -= dy; break;
    case 'n':             y += dy;              height -= dy; break;
    case 'ne':            y += dy; width += dx; height -= dy; break;
    case 'e':                       width += dx;              break;
    case 'se':                      width += dx; height += dy; break;
    case 's':                                    height += dy; break;
    case 'sw': x += dx;             width -= dx; height += dy; break;
    case 'w':  x += dx;             width -= dx;               break;
    default: return null;
  }

  if (width < 1) width = 1;
  if (height < 1) height = 1;

  return applyBBToShape(shape, { x, y, width, height });
}

function applyBBToShape(shape: Shape, bb: BoundingBox): Partial<Shape> {
  switch (shape.type) {
    case 'rectangle':
      return { x: bb.x, y: bb.y, width: bb.width, height: bb.height };
    case 'ellipse':
      return { cx: bb.x + bb.width / 2, cy: bb.y + bb.height / 2, rx: bb.width / 2, ry: bb.height / 2 };
    case 'line': {
      const origBB = getShapeBoundingBox(shape);
      const sx = bb.width / (origBB.width || 1);
      const sy = bb.height / (origBB.height || 1);
      return {
        x1: bb.x + (shape.x1 - origBB.x) * sx,
        y1: bb.y + (shape.y1 - origBB.y) * sy,
        x2: bb.x + (shape.x2 - origBB.x) * sx,
        y2: bb.y + (shape.y2 - origBB.y) * sy,
      };
    }
    case 'polygon': {
      const origBB = getShapeBoundingBox(shape);
      const sx = bb.width / (origBB.width || 1);
      const sy = bb.height / (origBB.height || 1);
      return {
        points: shape.points.map(p => ({
          x: bb.x + (p.x - origBB.x) * sx,
          y: bb.y + (p.y - origBB.y) * sy,
        })),
      };
    }
    case 'text': {
      const lines = ((shape as any).content || '').split('\n');
      const lc    = Math.max(1, lines.length);
      const newFs = Math.max(6, Math.round(bb.height / lc / 1.25));
      return { x: bb.x, y: bb.y + newFs, fontSize: newFs };
    }
    default:
      return {};
  }
}

// ── Arc path rebuild helper ───────────────────────────────────────────────────

/**
 * Rebuild an arc SVG path from translated points.
 * Points: [p0, p1, handle?]. The handle (midpoint control) preserves curvature.
 */
function _rebuildArcPath(points: Point[]): string {
  if (points.length < 2) return '';
  const p0 = points[0], p1 = points[1], h = points[2];

  if (!h) return `M ${r(p0.x)},${r(p0.y)} L ${r(p1.x)},${r(p1.y)}`;

  const chord = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  if (chord < 0.5) return `M ${r(p0.x)},${r(p0.y)} L ${r(p1.x)},${r(p1.y)}`;

  const mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2;
  const nx = -(p1.y - p0.y) / chord, ny = (p1.x - p0.x) / chord;
  const sag = (h.x - mx) * nx + (h.y - my) * ny;

  if (Math.abs(sag) < 0.5) return `M ${r(p0.x)},${r(p0.y)} L ${r(p1.x)},${r(p1.y)}`;

  const R = (chord * chord / 4 + sag * sag) / (2 * Math.abs(sag));
  const sweep     = sag > 0 ? 0 : 1;
  const large_arc = Math.abs(sag) > R ? 1 : 0;

  return `M ${r(p0.x)},${r(p0.y)} A ${r(R)},${r(R)} 0 ${large_arc} ${sweep} ${r(p1.x)},${r(p1.y)}`;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function dist(a: Point, b: Point): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function pointInPolygon(point: Point, pts: Point[]): boolean {
  if (pts.length < 3) return false;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const { x: xi, y: yi } = pts[i];
    const { x: xj, y: yj } = pts[j];
    if ((yi > point.y) !== (yj > point.y) && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

function nearPolyline(point: Point, pts: Point[], tol: number, closed: boolean): boolean {
  const len = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < len; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) continue;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq));
    if (dist(point, { x: a.x + t * dx, y: a.y + t * dy }) <= tol) return true;
  }
  return false;
}

function r(n: number): number { return Math.round(n * 10) / 10; }