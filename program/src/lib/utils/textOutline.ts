/**
 * @file Text → path. Lays the text out like the renderer (same line height, anchor, letter and word spacing) with the
 * glyph outlines of its real font (fonts/outlineFont.ts) and returns one compound path, holes included.
 *
 * Layout is done by fontkit, a real OpenType engine: kerning, ligatures and contextual alternates, mark
 * positioning, Arabic and Indic shaping. Variable fonts are set to the text's weight and optical size; a weight or
 * slant the font lacks is synthesized the way browsers do it. Browsers switch ligatures off when letter spacing is
 * not 0, and so does this. Not done: bidirectional reordering of mixed right-to-left / left-to-right text (reported).
 */

import type { Font, Glyph } from 'fontkit';
import type { TextShape, PathShape, PathNode, Point } from './types';
import { getOutlineFont, type OutlineFont } from '../fonts/outlineFont';
import { lineAdvance, decorationLines } from './text';
import { rotatePoint, EPS } from './math';
import { corner, joinContours, mapNodes, pathBounds } from './path';
import { getRotationOrigin, centerOf } from './shapes';
import { emboldenContours } from './strokeToPath';

// ── glyph commands → contours ─────────────────────────────────────────────────

const near = (a: Point, b: Point) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;

export interface PathCommand {
  type: 'M' | 'L' | 'Q' | 'C' | 'Z';
  x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number;
}

/** Absolute path commands (M L Q C Z) → closed contours of PathNode (quadratics become cubics). */
export function commandsToContours(cmds: readonly PathCommand[]): PathNode[][] {
  const out: PathNode[][] = [];
  let cur: PathNode[] = [];
  let cx = 0, cy = 0;

  const close = () => {
    if (cur.length > 1 && near(cur[0], cur[cur.length - 1])) {
      const last = cur.pop()!;
      if (last.hin) cur[0] = { ...cur[0], hin: last.hin };
    }
    if (cur.length >= 2) out.push(cur);
    cur = [];
  };
  const cubic = (x1: number, y1: number, x2: number, y2: number, x: number, y: number) => {
    if (!cur.length) cur.push(corner(cx, cy));
    cur[cur.length - 1] = { ...cur[cur.length - 1], hout: { x: x1, y: y1 } };
    cur.push({ x, y, hin: { x: x2, y: y2 }, hout: null, smooth: false });
    cx = x; cy = y;
  };

  for (const c of cmds) {
    switch (c.type) {
      case 'M': close(); cx = c.x!; cy = c.y!; cur = [corner(cx, cy)]; break;
      case 'L':
        if (!cur.length) cur.push(corner(cx, cy));
        // fonts contain zero-length lines (a duplicate point); a node pair at one position is junk for the user
        if (!near(cur[cur.length - 1], { x: c.x!, y: c.y! })) cur.push(corner(c.x!, c.y!));
        cx = c.x!; cy = c.y!; break;
      case 'C': cubic(c.x1!, c.y1!, c.x2!, c.y2!, c.x!, c.y!); break;
      case 'Q': {
        const x0 = cx, y0 = cy;
        cubic(x0 + 2 / 3 * (c.x1! - x0), y0 + 2 / 3 * (c.y1! - y0),
              c.x! + 2 / 3 * (c.x1! - c.x!), c.y! + 2 / 3 * (c.y1! - c.y!), c.x!, c.y!);
        break;
      }
      case 'Z': close(); break;
    }
  }
  close();
  return out;
}

const signedArea = (nodes: PathNode[]) => {
  let a = 0;
  for (let i = 0; i < nodes.length; i++) {
    const p = nodes[i], q = nodes[(i + 1) % nodes.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
};

// ── layout ────────────────────────────────────────────────────────────────────

/** A glyph of a laid-out line: where its origin goes (px, relative to the line start; y relative to the baseline). */
interface Placed { glyph: Glyph; x: number; y: number; k?: number; }
interface Line { placed: Placed[]; width: number; }

/** Tried in this order for characters the text's own font lacks (Google Fonts; unavailable ones are skipped). */
export const FALLBACK_FAMILIES = ['Noto Sans', 'Noto Sans Symbols', 'Noto Sans Symbols 2', 'Noto Sans Math'];

const NO_LIGATURES = { liga: false, clig: false, dlig: false, hlig: false };

/**
 * Lays one line out left to right: shaping (ligatures, kerning, marks …) by the font engine, then
 * letter-spacing after every glyph that is not a combining mark (browsers add it per character).
 */
function layoutLine(font: Font, text: string, size: number, ls: number, ws: number): Line {
  if (!text) return { placed: [], width: 0 };
  const k = size / font.unitsPerEm;
  const run = font.layout(text, ls === 0 ? undefined : NO_LIGATURES);
  const placed: Placed[] = [];
  let x = 0;
  run.glyphs.forEach((glyph, i) => {
    const p = run.positions[i];
    placed.push({ glyph, x: x + p.xOffset * k, y: -p.yOffset * k });
    x += p.xAdvance * k + (glyph.isMark ? 0 : ls) + (ws && glyph.codePoints.includes(32) ? ws : 0);
  });
  return { placed, width: x };
}

/** Browsers slant a synthesized italic by this much (x shift per unit of height above the baseline). */
const SYNTH_ITALIC_SKEW = 0.25;
/**
 * How far a synthesized bold grows each outline, in px: a stroke of size/24 (small text) to size/32 (36 px and up)
 * around the glyph, as browsers draw it.
 */
export function syntheticBoldDelta(size: number): number {
  const t = Math.min(1, Math.max(0, (size - 9) / 27));
  return size * (1 / 24 + (1 / 32 - 1 / 24) * t) / 2;
}

const polygonToNodes = (pts: Point[]): PathNode[] => pts.map(p => corner(p.x, p.y));

/** A glyph's outline as absolute commands in document space (font units are y-up, the document is y-down). */
function glyphCommands(g: Glyph, ox: number, oy: number, k: number): PathCommand[] {
  let cmds: Glyph['path']['commands'];
  try { cmds = g.path.commands; } catch { return []; }          // a broken glyph must not stop the whole text
  const X = (v: number) => ox + v * k, Y = (v: number) => oy - v * k;
  const out: PathCommand[] = [];
  for (const { command, args: a } of cmds) {
    switch (command) {
      case 'moveTo': out.push({ type: 'M', x: X(a[0]), y: Y(a[1]) }); break;
      case 'lineTo': out.push({ type: 'L', x: X(a[0]), y: Y(a[1]) }); break;
      case 'quadraticCurveTo': out.push({ type: 'Q', x1: X(a[0]), y1: Y(a[1]), x: X(a[2]), y: Y(a[3]) }); break;
      case 'bezierCurveTo': out.push({ type: 'C', x1: X(a[0]), y1: Y(a[1]), x2: X(a[2]), y2: Y(a[3]), x: X(a[4]), y: Y(a[5]) }); break;
      case 'closePath': out.push({ type: 'Z' }); break;
    }
  }
  return out;
}

export interface OutlineResult {
  nodes: PathNode[];            // compound path nodes, document coordinates, NOT rotated
  font: OutlineFont;
  /** Characters in no font at all (left out). Characters the chosen font lacks but a fallback has are drawn. */
  missing: number;
  /** The text mixes right-to-left and left-to-right letters; the engine does not reorder such text. */
  mixedDirection: boolean;
}

const RTL = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const LTR = /[A-Za-z\u00C0-\u02AF\u0370-\u058F\u0900-\u1FFF\u3040-\uFAFF]/;
/** Right-to-left letters and left-to-right letters in the same line: needs bidi reordering. */
export const mixesDirections = (text: string) => text.split('\n').some(l => RTL.test(l) && LTR.test(l));

/**
 * Outlines `s`. Returns null when the text has nothing to draw (empty / whitespace only).
 * Throws FontUnavailable (fonts/outlineFont.ts) when the font cannot be obtained.
 */
export async function outlineText(s: TextShape): Promise<OutlineResult | null> {
  const content = s.content ?? '';
  if (!content.trim()) return null;
  const of = await getOutlineFont(s);
  const font = of.font;

  const size = s.fontSize;
  const k = size / font.unitsPerEm;
  const ls = s.letterSpacing || 0;
  const ws = s.wordSpacing || 0;
  const synthBold = s.fontWeight >= 600 && of.weight < 600;
  const synthItalic = s.fontStyle === 'italic' && !of.italic;
  const lines = decorationLines(s.textDecoration);
  const contours: PathNode[][] = [];
  let missing = 0;

  // Characters the chosen font has no glyph for are not dropped: they come from the first fallback font that has them.
  const has = (f: Font, ch: string) => /\s/.test(ch) || f.hasGlyphForCodePoint(ch.codePointAt(0)!);
  const lacking = new Set<string>();
  for (const ch of content) if (!has(font, ch)) lacking.add(ch);
  const fallbacks: Font[] = [];
  for (const f of of.extras) {                     // the family's own other subsets come first
    const covered = [...lacking].filter(ch => has(f, ch));
    if (covered.length) { fallbacks.push(f); covered.forEach(ch => lacking.delete(ch)); }
  }
  for (const family of lacking.size ? FALLBACK_FAMILIES : []) {
    if (!lacking.size) break;
    try {
      const f = (await getOutlineFont({ ...s, fontFamily: family, content: [...lacking].join('') } as TextShape)).font;
      const covered = [...lacking].filter(ch => has(f, ch));
      if (covered.length) { fallbacks.push(f); covered.forEach(ch => lacking.delete(ch)); }
    } catch { /* this fallback is not available: try the next one */ }
  }
  const fontFor = (ch: string): Font | null => has(font, ch) ? font : fallbacks.find(f => has(f, ch)) ?? null;

  content.split('\n').forEach((raw, i) => {
    // consecutive characters of one font form a run; characters in no font are left out and counted
    const runs: { font: Font; text: string }[] = [];
    for (const ch of raw) {
      const f = fontFor(ch);
      if (!f) { missing++; continue; }
      const last = runs[runs.length - 1];
      if (last && (last.font === f || /\s/.test(ch))) last.text += ch;
      else runs.push({ font: f, text: ch });
    }
    const line = runs.map(r => r.text).join('');
    const placed: Placed[] = [];
    let width = 0;
    for (const r of runs) {
      const l = layoutLine(r.font, r.text, size, ls, ws);
      const kr = size / r.font.unitsPerEm;
      for (const p of l.placed) placed.push({ ...p, x: p.x + width, k: kr });
      width += l.width;
    }
    const x0 = s.textAnchor === 'middle' ? s.x - width / 2 : s.textAnchor === 'end' ? s.x - width : s.x;
    const y = s.y + i * lineAdvance(s);

    let lineContours: PathNode[][] = [];
    for (const p of placed) lineContours.push(...commandsToContours(glyphCommands(p.glyph, x0 + p.x, y + p.y, p.k ?? k)));
    if (synthItalic) lineContours = lineContours.map(c => mapNodes(c, q => ({ x: q.x + SYNTH_ITALIC_SKEW * (y - q.y), y: q.y })));
    if (synthBold && lineContours.length) lineContours = emboldenContours(lineContours, syntheticBoldDelta(size)).map(polygonToNodes);
    contours.push(...lineContours);

    if (lines.length && width > 0 && line.trim()) {
      // Same winding as the glyphs of this line, otherwise nonzero filling would punch holes where they overlap.
      const biggest = lineContours.reduce((b, c) => Math.abs(signedArea(c)) > Math.abs(b) ? signedArea(c) : b, 0);
      for (const kind of lines) {
        const { centre, thick } = decorationMetrics(font, kind, size, k);
        const ya = y + centre - thick / 2, yb = y + centre + thick / 2;
        const rect = [corner(x0, ya), corner(x0 + width, ya), corner(x0 + width, yb), corner(x0, yb)];
        if (biggest < 0) rect.reverse();
        contours.push(rect);
      }
    }
  });

  // A mirrored text: the outline is mirrored about the centre of the text box, like the text itself.
  if (s.flipX || s.flipY) {
    const c = getRotationOrigin(s);
    // Every contour changes direction alike, so the nonzero fill is unchanged.
    const flipped = contours.map(cont => mapNodes(cont, q => ({ x: s.flipX ? 2 * c.x - q.x : q.x, y: s.flipY ? 2 * c.y - q.y : q.y })));
    contours.splice(0, contours.length, ...flipped);
  }

  if (!contours.length) return null;
  return { nodes: joinContours(contours), font: of, missing, mixedDirection: mixesDirections(content) };
}

/**
 * Where a decoration line goes, relative to the baseline (y down), and how thick it is: the font's own
 * underline / strikeout metrics, overline at the ascender.
 */
function decorationMetrics(font: Font, kind: 'underline' | 'overline' | 'line-through', size: number, k: number): { centre: number; thick: number } {
  const underThick = Math.max(size * 0.02, (font.underlineThickness || font.unitsPerEm * 0.05) * k);
  if (kind === 'underline') return { centre: -(font.underlinePosition ?? -font.unitsPerEm * 0.1) * k, thick: underThick };
  if (kind === 'overline') return { centre: -font.ascent * k + underThick / 2, thick: underThick };
  const os2 = (font as unknown as { 'OS/2'?: { yStrikeoutPosition?: number; yStrikeoutSize?: number } })['OS/2'];
  const thick = os2?.yStrikeoutSize ? Math.max(size * 0.02, os2.yStrikeoutSize * k) : underThick;
  const pos = os2?.yStrikeoutPosition ? os2.yStrikeoutPosition * k : (font.xHeight || font.unitsPerEm * 0.5) * k / 2;
  return { centre: -pos, thick };
}

// ── text shape → path shape ───────────────────────────────────────────────────

export interface TextToPathResult { shape: PathShape; warnings: string[]; }

/**
 * Same id, fill, opacity and (if rotated) rotation as the text, so the picture does not move.
 * Returns null if there is nothing to outline; throws FontUnavailable if the font cannot be obtained.
 */
export async function textToPathShape(s: TextShape): Promise<TextToPathResult | null> {
  const r = await outlineText(s);
  if (!r) return null;

  let nodes = r.nodes;
  if (s.rotation) {
    // The text rotates about the centre of its text box, a path about the centre of its own bounds.
    // Translate so both pivots give the same picture.
    const cp = centerOf(pathBounds(nodes, true));
    const target = rotatePoint(cp, getRotationOrigin(s), s.rotation);
    const dx = target.x - cp.x, dy = target.y - cp.y;
    if (Math.abs(dx) > EPS || Math.abs(dy) > EPS) nodes = mapNodes(nodes, p => ({ x: p.x + dx, y: p.y + dy }));
  }

  const warnings: string[] = [];
  const f = r.font;
  if (r.missing) warnings.push(`${r.missing} character${r.missing === 1 ? ' is' : 's are'} in neither ${f.family} nor any fallback font and ${r.missing === 1 ? 'was' : 'were'} left out.`);
  if (r.mixedDirection) warnings.push('This text mixes right-to-left and left-to-right letters; the outline does not reorder them the way a browser does.');

  const shape: PathShape = {
    id: s.id, type: 'path', name: s.name, visible: s.visible,
    fill: s.fill, stroke: 'none', strokeWidth: 0, opacity: s.opacity, rotation: s.rotation,
    strokeLinecap: s.strokeLinecap, strokeLinejoin: s.strokeLinejoin, strokeDasharray: '',
    nodes, closed: true,
  };
  return { shape, warnings };
}
