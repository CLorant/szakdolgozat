/**
 * @file Copy & paste of shapes between tabs (and other SVG editors).
 *
 *  • The shapes are kept in localStorage ("svgeditor.clipboard"), which every tab of this app shares: that is what makes
 *    copy → paste between two editor tabs work without any browser permission, with full fidelity (names, gradients, groups).
 *  • At the same time the system clipboard gets the selection as SVG text (so it can be pasted into Inkscape, Figma, a
 *    text editor …), tagged with an XML comment that names the stored entry.
 *  • Pasting SVG text that came from somewhere else goes through the normal SVG importer.
 */
import type { Shape, DocumentState } from './types';
import { normalizeShape } from './project';
import { buildSvgDocument } from './serializer';
import { getWorldBounds, unionBounds } from './shapes';

const KEY = 'svgeditor.clipboard';
const MAX_BYTES = 2_500_000;                 // localStorage allows ~5 MB per origin; autosave needs room too

export interface ClipEntry { nonce: string; time: number; shapes: Shape[]; }
export const MARKER = /<!--\s*svgeditor-clip:([a-z0-9]+)\s*-->/;

/** Stores the shapes for other tabs. Returns the entry (also when storing failed: the caller still has it in memory). */
export function saveSharedClip(shapes: Shape[]): ClipEntry {
  const entry: ClipEntry = { nonce: Math.random().toString(36).slice(2, 10), time: Date.now(), shapes };
  try {
    const json = JSON.stringify(entry);
    if (json.length <= MAX_BYTES) localStorage.setItem(KEY, json);
    else localStorage.removeItem(KEY);
  } catch { /* storage full or blocked: pasting within this tab still works */ }
  return entry;
}

/** The stored entry, validated shape by shape (the storage is shared with whatever else runs on this origin). */
export function loadSharedClip(): ClipEntry | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || !Array.isArray(data.shapes) || typeof data.nonce !== 'string') return null;
    const seen = new Set<string>();
    const shapes = data.shapes.map((s: unknown) => normalizeShape(s, seen)).filter((s: Shape | null): s is Shape => !!s);
    return shapes.length ? { nonce: data.nonce, time: Number(data.time) || 0, shapes } : null;
  } catch { return null; }
}

/** The selection as a standalone SVG (cropped to the shapes), tagged with the entry's nonce. */
export function clipSvg(shapes: Shape[], nonce: string): string {
  const b = unionBounds(shapes.map(getWorldBounds)) ?? { x: 0, y: 0, width: 1, height: 1 };
  const doc: DocumentState = { shapes, width: Math.max(1, Math.ceil(b.width)), height: Math.max(1, Math.ceil(b.height)), background: 'transparent-light', bgImage: '' };
  const svg = buildSvgDocument(doc, { background: false, viewBox: { x: b.x, y: b.y, width: Math.max(1, b.width), height: Math.max(1, b.height) } });
  const nl = svg.indexOf('\n');
  return `${svg.slice(0, nl + 1)}<!--svgeditor-clip:${nonce}-->\n${svg.slice(nl + 1)}`;
}

/** Does this clipboard text look like an SVG document? */
export const looksLikeSvg = (text: string) => /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!doctype[^>]*>\s*)?<svg[\s>]/i.test(text);
