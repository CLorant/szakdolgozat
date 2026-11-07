/**
 * @file Document → SVG text (export and clipboard). Everything is written explicitly, never relying on SVG defaults,
 * so the file looks the same as the editor.
 */

import type { Shape, DocumentState, BgFit } from './types';
import { round } from './math';
import { shapeTransform } from './shapes';
import { pathToD } from './path';
import { svgFontFamily, lineAdvance } from './text';
import { parseGradient, gradientSvg, paintId } from './gradient';

// ── helpers ───────────────────────────────────────────────────────────────────

/** '#rrggbbaa' → hex + alpha; 'none'/'transparent' → 'none'. */
export function splitColor(color: string): { hex: string; opacity: number } {
  if (!color || color === 'none' || color === 'transparent') return { hex: 'none', opacity: 1 };
  if (color.length === 9 && color[0] === '#') {
    return { hex: color.slice(0, 7), opacity: Math.round(parseInt(color.slice(7, 9), 16) / 255 * 1000) / 1000 };
  }
  return { hex: color, opacity: 1 };
}

export const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const escapeAttr = (s: string) => escapeXml(s).replace(/"/g, '&quot;');

/** Gradient definitions collected while a document is written (one <defs> at the top); see shapeToSvgElement. */
let defsSink: string[] | null = null;

function paint(attr: 'fill' | 'stroke', s: Shape): string {
  const color = attr === 'fill' ? s.fill : s.stroke;
  const g = parseGradient(color);
  if (g && defsSink) {
    const id = paintId(s.id, attr);
    defsSink.push(gradientSvg(g, id));
    return ` ${attr}="url(#${id})"`;
  }
  const { hex, opacity } = splitColor(g ? g.stops[0].color : color);
  return ` ${attr}="${escapeAttr(hex)}"${opacity < 1 ? ` ${attr}-opacity="${opacity}"` : ''}`;
}

function strokeAttrs(s: Shape): string {
  if (s.stroke === 'none' || !s.strokeWidth) return ' stroke="none"';
  return paint('stroke', s)
    + ` stroke-width="${round(s.strokeWidth, 3)}"`
    + ` stroke-linecap="${s.strokeLinecap}" stroke-linejoin="${s.strokeLinejoin}"`    // SVG default is butt/miter
    + (s.strokeDasharray ? ` stroke-dasharray="${escapeAttr(s.strokeDasharray)}"` : '')
    + (s.strokeDasharray && s.strokeDashoffset ? ` stroke-dashoffset="${round(s.strokeDashoffset, 3)}"` : '');
}

function commonAttrs(s: Shape): string {
  const o = s.opacity !== 1 ? ` opacity="${round(s.opacity, 3)}"` : '';
  const t = shapeTransform(s, n => round(n, 3));
  return t ? `${o} transform="${t}"` : o;
}

// ── shapes ────────────────────────────────────────────────────────────────────

export function shapeToSvgElement(s: Shape, indent = '  '): string {
  // Standalone call: the gradients this shape needs are written in a <defs> right before it.
  if (defsSink) return shapeElement(s, indent);
  const own: string[] = [];
  defsSink = own;
  try {
    const body = shapeElement(s, indent);
    return own.length && body ? `${indent}<defs>\n${own.join('\n')}\n${indent}</defs>\n${body}` : body;
  } finally { defsSink = null; }
}

function shapeElement(s: Shape, indent: string): string {
  if (!s.visible) return '';
  const r = (n: number) => round(n);
  const tail = `${commonAttrs(s)}`;
  switch (s.type) {
    case 'group': {
      const kids = s.children.map(c => shapeElement(c, indent + '  ')).filter(Boolean);
      if (!kids.length) return '';
      return `${indent}<g${tail}>\n${kids.join('\n')}\n${indent}</g>`;
    }
    case 'line':
      return `${indent}<line x1="${r(s.x1)}" y1="${r(s.y1)}" x2="${r(s.x2)}" y2="${r(s.y2)}" fill="none"${strokeAttrs(s)}${tail}/>`;
    case 'rectangle': {
      const rx = s.rx ? ` rx="${r(s.rx)}"` : '', ry = s.ry && s.ry !== s.rx ? ` ry="${r(s.ry)}"` : '';
      return `${indent}<rect x="${r(s.x)}" y="${r(s.y)}" width="${r(s.width)}" height="${r(s.height)}"${rx}${ry}${paint('fill', s)}${strokeAttrs(s)}${tail}/>`;
    }
    case 'ellipse':
      return `${indent}<ellipse cx="${r(s.cx)}" cy="${r(s.cy)}" rx="${r(s.rx)}" ry="${r(s.ry)}"${paint('fill', s)}${strokeAttrs(s)}${tail}/>`;
    case 'path':
      return `${indent}<path d="${pathToD(s.nodes, s.closed)}"${s.fillRule === 'evenodd' ? ' fill-rule="evenodd"' : ''}${paint('fill', s)}${strokeAttrs(s)}${tail}/>`;
    case 'image':
      return `${indent}<image x="${r(s.x)}" y="${r(s.y)}" width="${r(s.width)}" height="${r(s.height)}" preserveAspectRatio="${escapeAttr(s.preserveAspectRatio ?? 'none')}" href="${escapeAttr(s.href)}"${tail}/>`;
    case 'text': {
      const lines = (s.content ?? '').split('\n');
      const tspans = lines.map((line, i) =>
        `<tspan x="${r(s.x)}"${i ? ` dy="${r(lineAdvance(s))}"` : ''}>${escapeXml(line)}</tspan>`).join('');
      return `${indent}<text x="${r(s.x)}" y="${r(s.y)}" font-family="${escapeAttr(svgFontFamily(s.fontFamily))}" font-size="${s.fontSize}"`
        + paint('fill', s)
        + (s.fontWeight !== 400 ? ` font-weight="${s.fontWeight}"` : '')
        + (s.fontStyle !== 'normal' ? ` font-style="${s.fontStyle}"` : '')
        + (s.textDecoration && s.textDecoration !== 'none' ? ` text-decoration="${escapeAttr(s.textDecoration)}"` : '')
        + (s.textAnchor !== 'start' ? ` text-anchor="${s.textAnchor}"` : '')
        + (s.letterSpacing ? ` letter-spacing="${s.letterSpacing}"` : '')
        + (s.wordSpacing ? ` word-spacing="${s.wordSpacing}"` : '')
        + ` xml:space="preserve" style="white-space:pre"${tail}>${tspans}</text>`;
    }
  }
}

// ── document ──────────────────────────────────────────────────────────────────

export interface SvgOptions {
  /** Draw the page background (color + image). Default true. */
  background?: boolean;
  /** Treat transparent backgrounds as white (JPG). */
  opaque?: boolean;
  /** Inline @font-face CSS (see embedFontCss): makes <text> render the same everywhere, offline. */
  fontCss?: string;
  /** Pixel size written to width/height (the viewBox stays the document size). Raster export uses this so the browser renders the vectors at the final resolution. */
  size?: { width: number; height: number };
  /** The part of the document to export (default: the whole page 0,0,width,height) — "fit around objects". */
  viewBox?: { x: number; y: number; width: number; height: number };
  /** Omit width / height (viewBox only): the SVG scales to whatever box it is placed in. */
  scalable?: boolean;
}

const FIT_ASPECT: Record<BgFit, string> = { cover: 'xMidYMid slice', contain: 'xMidYMid meet', stretch: 'none' };

/** The solid color behind the drawing, or null for a transparent page. */
export function backgroundColor(doc: DocumentState, opaque = false): string | null {
  switch (doc.background) {
    case 'white':  return '#ffffff';
    case 'black':  return '#000000';
    case 'custom': return doc.bgColor ?? '#ffffff';
    default:       return opaque ? '#ffffff' : null;
  }
}

export function buildSvgDocument(doc: DocumentState, opts: SvgOptions = {}): string {
  const { background = true, opaque = false, fontCss = '', size, scalable = false } = opts;
  const vb = opts.viewBox ?? { x: 0, y: 0, width: doc.width, height: doc.height };
  const r = (n: number) => Math.round(n * 1000) / 1000;

  let bg = '';
  if (background) {
    const color = backgroundColor(doc, opaque);
    if (color) bg += `  <rect x="${r(vb.x)}" y="${r(vb.y)}" width="${r(vb.width)}" height="${r(vb.height)}" fill="${color}"/>\n`;
    if (doc.bgImage) {
      bg += `  <image href="${escapeAttr(doc.bgImage)}" x="0" y="0" width="${doc.width}" height="${doc.height}" preserveAspectRatio="${FIT_ASPECT[doc.bgFit ?? 'cover']}"/>\n`;
    }
  } else if (opaque) {
    bg += `  <rect x="${r(vb.x)}" y="${r(vb.y)}" width="${r(vb.width)}" height="${r(vb.height)}" fill="#ffffff"/>\n`;   // JPEG has no alpha
  }

  const style = fontCss ? `  <style><![CDATA[\n${fontCss.replace(/]]>/g, ']]]]><![CDATA[>')}\n  ]]></style>\n` : '';

  const defs: string[] = [];
  defsSink = defs;
  let body: string;
  try { body = doc.shapes.map(s => shapeElement(s, '  ')).filter(Boolean).join('\n'); } finally { defsSink = null; }
  const defsBlock = defs.length ? `  <defs>\n${defs.join('\n')}\n  </defs>\n` : '';
  const dims = scalable && !size ? '' : ` width="${size?.width ?? r(vb.width)}" height="${size?.height ?? r(vb.height)}"`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<svg xmlns="http://www.w3.org/2000/svg"${dims} viewBox="${r(vb.x)} ${r(vb.y)} ${r(vb.width)} ${r(vb.height)}">\n`
    + `${style}${defsBlock}${bg}${body}\n</svg>\n`;
}
