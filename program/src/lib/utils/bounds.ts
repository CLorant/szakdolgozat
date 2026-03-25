import type { Shape, Point, BoundingBox } from './types';
import { generateFreehandPath, generateQuadraticBezierPath,
         generateCubicBezierPath } from './path';

const EPS = 1e-6;

// ── Bounding box ──────────────────────────────────────────────────────────

export function getShapeBounds(shape: Shape): BoundingBox {
  switch (shape.type) {
    case 'line': {
      const x = Math.min(shape.x1, shape.x2);
      const y = Math.min(shape.y1, shape.y2);
      return { x, y, width: Math.abs(shape.x2 - shape.x1) || 1, height: Math.abs(shape.y2 - shape.y1) || 1 };
    }
    case 'rectangle':
      return { x: shape.x, y: shape.y, width: shape.width || 1, height: shape.height || 1 };
    case 'ellipse':
      return { x: shape.cx - shape.rx, y: shape.cy - shape.ry, width: shape.rx * 2 || 1, height: shape.ry * 2 || 1 };
    case 'polygon':
    case 'freehand':
    case 'quadratic-bezier':
    case 'cubic-bezier':
    case 'arc': {
      const pts = shape.type === 'arc' ? shape.points.slice(0, 2) : shape.points;
      if (!pts?.length) return { x: 0, y: 0, width: 1, height: 1 };
      const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
      const x = Math.min(...xs), y = Math.min(...ys);
      return { x, y, width: (Math.max(...xs) - x) || 1, height: (Math.max(...ys) - y) || 1 };
    }

    case 'text': {
      /*
       * FIX: previous version used shape.content.length * 0.6 which ignored
       * newlines, giving incorrect bounds for multiline text.
       * We now split by newline and use the longest line for width, and
       * total line count × line-height for height.
       *
       * Also accounts for text-anchor so the bounding box always encloses
       * the visual text regardless of alignment.
       */
      const lines   = (shape.content ?? '').split('\n');
      const maxLen  = Math.max(...lines.map(l => l.length), 1);
      const numLines = Math.max(lines.length, 1);
      const w = shape.fontSize * maxLen * 0.6 || 20;
      const h = shape.fontSize * 1.25 * numLines || 20;
      // Anchor offset: text-anchor shifts the visual text relative to shape.x
      let bx: number;
      switch ((shape as any).textAnchor) {
        case 'middle': bx = shape.x - w / 2; break;
        case 'end':    bx = shape.x - w;     break;
        default:       bx = shape.x;         break;
      }
      // shape.y is the SVG text baseline; the top of the glyph is ~1em above
      return { x: bx, y: shape.y - shape.fontSize, width: w, height: h };
    }

    default:
      return { x: 0, y: 0, width: 1, height: 1 };
  }
}

// ── Handles ───────────────────────────────────────────────────────────────

export function getHandlePositions(b: BoundingBox): Record<string, Point> {
  const { x, y, width: w, height: h } = b;
  return {
    nw: { x,        y        },
    n:  { x: x+w/2, y        },
    ne: { x: x+w,   y        },
    e:  { x: x+w,   y: y+h/2 },
    se: { x: x+w,   y: y+h   },
    s:  { x: x+w/2, y: y+h   },
    sw: { x,        y: y+h   },
    w:  { x,        y: y+h/2 },
  };
}

export function resizeBounds(orig: BoundingBox, handle: string, dp: Point): BoundingBox {
  let { x, y, width, height } = orig;
  if (handle.includes('w')) { x     += dp.x; width  -= dp.x; }
  if (handle.includes('e')) {                 width  += dp.x; }
  if (handle.includes('n')) { y     += dp.y; height -= dp.y; }
  if (handle.includes('s')) {                 height += dp.y; }
  const MIN = 2;
  if (width  < MIN) { if (handle.includes('w')) x = orig.x + orig.width  - MIN; width  = MIN; }
  if (height < MIN) { if (handle.includes('n')) y = orig.y + orig.height - MIN; height = MIN; }
  return { x, y, width, height };
}

// ── Apply new bounding box to a shape ────────────────────────────────────

export function applyBoundsToShape(shape: Shape, nb: BoundingBox): Partial<Shape> {
  const ob = getShapeBounds(shape);
  const sx = ob.width  > EPS ? nb.width  / ob.width  : 1;
  const sy = ob.height > EPS ? nb.height / ob.height : 1;

  switch (shape.type) {
    case 'rectangle':
      return { x: nb.x, y: nb.y, width: nb.width, height: nb.height };
    case 'ellipse':
      return { cx: nb.x + nb.width/2, cy: nb.y + nb.height/2, rx: nb.width/2, ry: nb.height/2 };
    case 'line':
      return { x1: nb.x, y1: nb.y, x2: nb.x + nb.width, y2: nb.y + nb.height };
    case 'polygon': {
      const pts = shape.points.map(p => ({ x: nb.x + (p.x - ob.x) * sx, y: nb.y + (p.y - ob.y) * sy }));
      return { points: pts };
    }
    case 'freehand':
    case 'quadratic-bezier':
    case 'cubic-bezier':
    case 'arc': {
      const pts = shape.points.map(p => ({ x: nb.x + (p.x - ob.x) * sx, y: nb.y + (p.y - ob.y) * sy }));
      return { points: pts, pathData: rebuildPath(shape.type, pts) };
    }
    case 'text':
      // Move text anchor so the bounding box top-left lands at nb.x / nb.y
      // shape.y is the SVG baseline, which is fontSize below the box top
      return { x: nb.x, y: nb.y + shape.fontSize };
    default:
      return {};
  }
}

// ── Edit nodes ────────────────────────────────────────────────────────────

export function getEditNodes(shape: Shape): Point[] {
  switch (shape.type) {
    case 'line':
      return [{ x: shape.x1, y: shape.y1 }, { x: shape.x2, y: shape.y2 }];

    case 'rectangle':
      return [
        { x: shape.x,                 y: shape.y                  }, // 0 TL
        { x: shape.x + shape.width/2, y: shape.y                  }, // 1 TC
        { x: shape.x + shape.width,   y: shape.y                  }, // 2 TR
        { x: shape.x + shape.width,   y: shape.y + shape.height/2 }, // 3 MR
        { x: shape.x + shape.width,   y: shape.y + shape.height   }, // 4 BR
        { x: shape.x + shape.width/2, y: shape.y + shape.height   }, // 5 BC
        { x: shape.x,                 y: shape.y + shape.height   }, // 6 BL
        { x: shape.x,                 y: shape.y + shape.height/2 }, // 7 ML
        // Node 8 — corner-radius handle (orange diamond on top edge)
        { x: shape.x + Math.min(shape.rx ?? 0, shape.width / 2, shape.height / 2), y: shape.y },
      ];

    case 'ellipse':
      return [
        { x: shape.cx,            y: shape.cy             }, // 0 centre
        { x: shape.cx + shape.rx, y: shape.cy             }, // 1 right
        { x: shape.cx,            y: shape.cy + shape.ry  }, // 2 bottom
        { x: shape.cx - shape.rx, y: shape.cy             }, // 3 left
        { x: shape.cx,            y: shape.cy - shape.ry  }, // 4 top
      ];

    case 'polygon':
      return [...shape.points];

    case 'freehand':
    case 'quadratic-bezier':
    case 'cubic-bezier':
      return [...shape.points];

    case 'arc': {
      const pts = shape.points;
      if (!pts || pts.length < 2) return [];
      const p0 = pts[0], p1 = pts[1];
      const handle = pts[2] ?? _defaultArcHandle(shape.pathData, p0, p1);
      return [p0, p1, handle];
    }

    case 'text':
      return [{ x: shape.x, y: shape.y }];

    default:
      return [];
  }
}

// ── Apply a single node move ──────────────────────────────────────────────

export function applyNodeMove(shape: Shape, nodeIdx: number, newPos: Point): Partial<Shape> {
  switch (shape.type) {
    case 'line':
      return nodeIdx === 0
        ? { x1: newPos.x, y1: newPos.y }
        : { x2: newPos.x, y2: newPos.y };

    case 'rectangle': {
      if (nodeIdx === 8) {
        const rx = Math.max(0, Math.min(newPos.x - shape.x, shape.width / 2, shape.height / 2));
        return { rx, ry: rx };
      }
      const corners = [
        { x: shape.x,                 y: shape.y                  },
        { x: shape.x + shape.width/2, y: shape.y                  },
        { x: shape.x + shape.width,   y: shape.y                  },
        { x: shape.x + shape.width,   y: shape.y + shape.height/2 },
        { x: shape.x + shape.width,   y: shape.y + shape.height   },
        { x: shape.x + shape.width/2, y: shape.y + shape.height   },
        { x: shape.x,                 y: shape.y + shape.height   },
        { x: shape.x,                 y: shape.y + shape.height/2 },
      ];
      corners[nodeIdx] = newPos;
      const xs = [corners[0].x, corners[2].x, corners[4].x, corners[6].x];
      const ys = [corners[0].y, corners[2].y, corners[4].y, corners[6].y];
      return {
        x: Math.min(...xs), y: Math.min(...ys),
        width:  Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
      };
    }

    case 'ellipse':
      if (nodeIdx === 0) return { cx: newPos.x, cy: newPos.y };
      if (nodeIdx === 1 || nodeIdx === 3) return { rx: Math.abs(newPos.x - shape.cx) };
      if (nodeIdx === 2 || nodeIdx === 4) return { ry: Math.abs(newPos.y - shape.cy) };
      return {};

    case 'polygon': {
      const pts = [...shape.points]; pts[nodeIdx] = newPos;
      return { points: pts };
    }

    case 'freehand':
    case 'quadratic-bezier':
    case 'cubic-bezier': {
      const pts = [...shape.points]; pts[nodeIdx] = newPos;
      return { points: pts, pathData: rebuildPath(shape.type, pts) };
    }

    case 'arc': {
      const pts = [...shape.points];
      if (pts.length < 3) pts.push(_defaultArcHandle(shape.pathData, pts[0], pts[1]));
      pts[nodeIdx] = newPos;
      const pathData = _arcPathFromHandle(pts[0], pts[1], pts[2]);
      return { points: pts, pathData };
    }

    case 'text':
      return { x: newPos.x, y: newPos.y };

    default:
      return {};
  }
}

// ── Flip ──────────────────────────────────────────────────────────────────

export function flipShape(shape: Shape, axis: 'h' | 'v'): Partial<Shape> {
  const ob = getShapeBounds(shape);
  const cx = ob.x + ob.width  / 2;
  const cy = ob.y + ob.height / 2;
  const fx = (x: number) => axis === 'h' ? 2 * cx - x : x;
  const fy = (y: number) => axis === 'v' ? 2 * cy - y : y;

  switch (shape.type) {
    case 'line':
      return { x1: fx(shape.x1), y1: fy(shape.y1), x2: fx(shape.x2), y2: fy(shape.y2) };
    case 'rectangle':
    case 'ellipse':
      return {};
    case 'polygon':
      return { points: shape.points.map(p => ({ x: fx(p.x), y: fy(p.y) })) };
    default: {
      const s = shape as any;
      const pts = s.points as Point[];
      if (!pts?.length) return {};
      const newPts = pts.map((p: Point) => ({ x: fx(p.x), y: fy(p.y) }));
      return { points: newPts, pathData: rebuildPath(shape.type, newPts) };
    }
  }
}

// ── Arc geometry helpers ──────────────────────────────────────────────────

function _defaultArcHandle(pathData: string, p0: Point, p1: Point): Point {
  const chord = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  if (chord < EPS) return { x: p0.x, y: p0.y };
  const mx = (p0.x + p1.x) / 2;
  const my = (p0.y + p1.y) / 2;
  const nx = -(p1.y - p0.y) / chord;
  const ny =  (p1.x - p0.x) / chord;
  const m = pathData?.match(/A\s*([\d.]+)/);
  if (m) {
    const rx = parseFloat(m[1]);
    const halfChord = chord / 2;
    if (rx >= halfChord) {
      const sag = rx - Math.sqrt(rx * rx - halfChord * halfChord);
      return { x: mx + nx * sag, y: my + ny * sag };
    }
  }
  const defaultSag = chord * 0.2;
  return { x: mx + nx * defaultSag, y: my + ny * defaultSag };
}

function _arcPathFromHandle(p0: Point, p1: Point, h: Point): string {
  const chord = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  if (chord < 0.5) return `M ${r(p0.x)},${r(p0.y)} L ${r(p1.x)},${r(p1.y)}`;

  const mx = (p0.x + p1.x) / 2;
  const my = (p0.y + p1.y) / 2;
  const nx = -(p1.y - p0.y) / chord;
  const ny =  (p1.x - p0.x) / chord;

  const sag = (h.x - mx) * nx + (h.y - my) * ny;

  if (Math.abs(sag) < 0.5) {
    return `M ${r(p0.x)},${r(p0.y)} L ${r(p1.x)},${r(p1.y)}`;
  }

  const R = (chord * chord / 4 + sag * sag) / (2 * Math.abs(sag));
  const sweep     = sag > 0 ? 0 : 1;
  const large_arc = Math.abs(sag) > R ? 1 : 0;

  return `M ${r(p0.x)},${r(p0.y)} A ${r(R)},${r(R)} 0 ${large_arc} ${sweep} ${r(p1.x)},${r(p1.y)}`;
}

// ── Path rebuilder ────────────────────────────────────────────────────────

function rebuildPath(type: string, points: Point[]): string {
  if (!points.length) return '';
  switch (type) {
    case 'freehand':         return generateFreehandPath(points);
    case 'quadratic-bezier': return generateQuadraticBezierPath(points);
    case 'cubic-bezier':     return generateCubicBezierPath(points);
    case 'arc':
      return points.length >= 3
        ? _arcPathFromHandle(points[0], points[1], points[2])
        : _arcPathFromHandle(
            points[0], points[1],
            _defaultArcHandle('', points[0], points[1] ?? points[0])
          );
    default: {
      let d = `M ${r(points[0].x)},${r(points[0].y)}`;
      for (let i = 1; i < points.length; i++) d += ` L ${r(points[i].x)},${r(points[i].y)}`;
      return d;
    }
  }
}

function r(n: number) { return Math.round(n * 10) / 10; }