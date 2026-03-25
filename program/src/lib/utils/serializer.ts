import type { Shape } from './types';

// ── Color helpers ─────────────────────────────────────────────────────────────

function splitColor(color: string): { hex: string; opacity: number } {
  if (!color || color === 'none' || color === 'transparent') {
    return { hex: color, opacity: 1 };
  }
  if (color.length === 9 && color.startsWith('#')) {
    const alpha = parseInt(color.slice(7, 9), 16) / 255;
    return { hex: color.slice(0, 7), opacity: Math.round(alpha * 1000) / 1000 };
  }
  return { hex: color, opacity: 1 };
}

function colorAttr(attr: string, color: string, opacityAttr: string): string {
  const { hex, opacity } = splitColor(color);
  const opStr = opacity < 1 ? ` ${opacityAttr}="${opacity}"` : '';
  return ` ${attr}="${hex}"${opStr}`;
}

// ── Main serializer ───────────────────────────────────────────────────────────

export function shapeToSvgElement(shape: Shape): string {
  if (shape.visible === false) return '';

  const globalOpacity = shape.opacity !== undefined && shape.opacity !== 1
    ? ` opacity="${shape.opacity}"` : '';

  const rot = (shape as any).rotation
    ? ` transform="rotate(${(shape as any).rotation}, ${cx(shape)}, ${cy(shape)})"` : '';

  const lc = (shape as any).strokeLinecap   ?? 'round';
  const lj = (shape as any).strokeLinejoin  ?? 'round';
  const da = (shape as any).strokeDasharray ?? '';

  const fillAttr   = colorAttr('fill',   shape.fill,   'fill-opacity');
  const strokeAttr = colorAttr('stroke', shape.stroke, 'stroke-opacity');
  const swAttr     = ` stroke-width="${shape.strokeWidth}"`;
  const lcAttr     = lc !== 'round'  ? ` stroke-linecap="${lc}"`   : '';
  const ljAttr     = lj !== 'round'  ? ` stroke-linejoin="${lj}"`  : '';
  const daAttr     = da              ? ` stroke-dasharray="${da}"`  : '';
  const strokeStyle = `${strokeAttr}${swAttr}${lcAttr}${ljAttr}${daAttr}`;

  switch (shape.type) {
    case 'line':
      return `  <line x1="${r(shape.x1)}" y1="${r(shape.y1)}" x2="${r(shape.x2)}" y2="${r(shape.y2)}"${strokeStyle}${globalOpacity}${rot} />`;

    case 'rectangle':
      return `  <rect x="${r(shape.x)}" y="${r(shape.y)}" width="${r(shape.width)}" height="${r(shape.height)}"${fillAttr}${strokeStyle}${shape.rx ? ` rx="${r(shape.rx)}"` : ''}${globalOpacity}${rot} />`;

    case 'ellipse':
      return `  <ellipse cx="${r(shape.cx)}" cy="${r(shape.cy)}" rx="${r(shape.rx)}" ry="${r(shape.ry)}"${fillAttr}${strokeStyle}${globalOpacity}${rot} />`;

    case 'polygon': {
      // FIX: open polygons (closed === false) must export as <polyline>
      const tag = shape.closed === false ? 'polyline' : 'polygon';
      const pts = shape.points.map(p => `${r(p.x)},${r(p.y)}`).join(' ');
      // polyline never has fill
      const pFill = shape.closed === false ? ' fill="none"' : fillAttr;
      return `  <${tag} points="${pts}"${pFill}${strokeStyle}${globalOpacity}${rot} />`;
    }

    case 'text': {
      /*
       * FIX: multiline text uses <tspan> elements with dy offsets rather than
       * dumping the entire content (including '\n' characters) into a single
       * text node, which SVG renderers ignore/display literally.
       */
      const { hex: fillHex, opacity: fillOp } = splitColor(shape.fill);
      const foAttr = fillOp < 1 ? ` fill-opacity="${fillOp}"` : '';
      const fw = shape.fontWeight !== 'normal' ? ` font-weight="${shape.fontWeight}"` : '';
      const fs = shape.fontStyle  !== 'normal' ? ` font-style="${shape.fontStyle}"`   : '';
      const td = shape.textDecoration !== 'none' ? ` text-decoration="${shape.textDecoration}"` : '';
      const ta = shape.textAnchor !== 'start'   ? ` text-anchor="${shape.textAnchor}"` : '';
      const ls = shape.letterSpacing ? ` letter-spacing="${shape.letterSpacing}"` : '';

      const lines = (shape.content ?? '').split('\n');
      const tspans = lines
        .map((line, i) => {
          const dy = i === 0 ? 0 : r(shape.fontSize * 1.25);
          return `<tspan x="${r(shape.x)}" dy="${dy}">${escapeXml(line)}</tspan>`;
        })
        .join('');

      return `  <text x="${r(shape.x)}" y="${r(shape.y)}" font-family="${shape.fontFamily}" font-size="${shape.fontSize}" fill="${fillHex}"${foAttr}${fw}${fs}${td}${ta}${ls}${globalOpacity}${rot}>${tspans}</text>`;
    }

    case 'freehand':
    case 'quadratic-bezier':
    case 'cubic-bezier':
    case 'arc':
      return `  <path d="${shape.pathData}"${fillAttr}${strokeStyle}${globalOpacity}${rot} />`;

    default:
      return '';
  }
}

export function buildSvgDocument(shapes: Shape[], width = 800, height = 600, bgImage = ''): string {
  const bgEl = bgImage
    ? `  <image href="${bgImage}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice"/>\n`
    : '';
  const elements = shapes.map(shapeToSvgElement).filter(Boolean).join('\n');

  const systemFonts = new Set(['sans-serif','serif','monospace']);
  const fonts  = [...new Set(shapes
    .filter(s => s.type === 'text')
    .map(s => (s as any).fontFamily)
    .filter((f: string) => !systemFonts.has(f) && f)
  )];
  const styleEl = fonts.length
    ? `  <style>\n${fonts.map(f =>
        `    @import url('https://fonts.googleapis.com/css2?family=${f.replace(/ /g,'+')}:wght@400;700&display=swap');`
      ).join('\n')}\n  </style>\n`
    : '';

  // FIX: add viewBox so the SVG scales correctly when embedded or resized
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
${styleEl}${bgEl}${elements}
</svg>`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function r(n: number): number { return Math.round(n * 100) / 100; }

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Rotation center X for a shape.
 * FIX: path types (freehand, bezier, arc) now compute their center from
 * their points array instead of returning 0, so the rotation transform
 * in the exported SVG is applied around the correct visual center.
 */
function cx(shape: Shape): number {
  switch (shape.type) {
    case 'ellipse':   return shape.cx;
    case 'rectangle': return shape.x + shape.width / 2;
    case 'text':      return shape.x;
    case 'line':      return (shape.x1 + shape.x2) / 2;
    default: {
      const s = shape as any;
      const pts: Array<{x:number; y:number}> | undefined =
        shape.type === 'arc' ? s.points?.slice(0, 2) : s.points;
      if (pts?.length) {
        const xs = pts.map(p => p.x);
        return (Math.min(...xs) + Math.max(...xs)) / 2;
      }
      return 0;
    }
  }
}

function cy(shape: Shape): number {
  switch (shape.type) {
    case 'ellipse':   return shape.cy;
    case 'rectangle': return shape.y + shape.height / 2;
    case 'text':      return shape.y;
    case 'line':      return (shape.y1 + shape.y2) / 2;
    default: {
      const s = shape as any;
      const pts: Array<{x:number; y:number}> | undefined =
        shape.type === 'arc' ? s.points?.slice(0, 2) : s.points;
      if (pts?.length) {
        const ys = pts.map(p => p.y);
        return (Math.min(...ys) + Math.max(...ys)) / 2;
      }
      return 0;
    }
  }
}