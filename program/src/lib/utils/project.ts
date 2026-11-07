/**
 * @file Project files (.svgedit.json): saving, loading with strict validation, the autosave in browser storage and the
 * "unsaved changes" flag.
 */

import { isValidPaint } from './gradient';
import { writable } from 'svelte/store';
import type { DocumentState, Shape, PathNode, Point, BackgroundType, BaseProps } from './types';
import { clamp, normDeg } from './math';
import { uid } from './shapes';
import { MAX_GROUP_DEPTH } from './tree';
import { DEFAULT_TEXT_PROPS, MAX_FONT_SIZE, MIN_FONT_SIZE, normWeight, decorationLines } from './text';
import { documentStore } from '../stores/document';

export const PROJECT_FORMAT = 'svg-editor-project';
export const PROJECT_VERSION = 1;
export const PROJECT_EXTENSION = '.svgedit.json';
const AUTOSAVE_KEY = 'svg-editor:autosave:v1';

// ── serialize / parse ─────────────────────────────────────────────────────────

export function serializeProject(doc: DocumentState): string {
  return JSON.stringify({ format: PROJECT_FORMAT, version: PROJECT_VERSION, doc });
}

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const fin = (v: unknown, d: number) => typeof v === 'number' && Number.isFinite(v) ? v : d;
const str = (v: unknown, d: string) => typeof v === 'string' ? v : d;
const oneOf = <T extends string>(v: unknown, opts: readonly T[], d: T): T => opts.includes(v as T) ? v as T : d;
const color = (v: unknown, d: string) => isValidPaint(v) ? v : d;
const pt = (v: unknown): Point | null => isObj(v) && Number.isFinite(v.x) && Number.isFinite(v.y) ? { x: v.x, y: v.y } : null;

function normalizeNode(v: unknown): PathNode | null {
  const p = pt(v);
  if (!p || !isObj(v)) return null;
  const n: PathNode = { ...p, hin: pt(v.hin), hout: pt(v.hout), smooth: v.smooth === true };
  if (v.sub === true) n.sub = true;
  return n;
}

/** Validates and completes one shape; returns null if it is unusable. Never throws. */
export function normalizeShape(raw: unknown, seen: Set<string>, depth = 1): Shape | null {
  if (!isObj(raw)) return null;
  let id = str(raw.id, '');
  if (!id || seen.has(id)) id = uid();
  seen.add(id);
  const base: BaseProps = {
    id, name: str(raw.name, ''), visible: raw.visible !== false,
    ...(raw.locked === true ? { locked: true as const } : {}),
    ...(isObj(raw.origin) && Number.isFinite(raw.origin.x) && Number.isFinite(raw.origin.y)
      && (raw.origin.x !== 0.5 || raw.origin.y !== 0.5)
      ? { origin: { x: clamp(raw.origin.x as number, -10, 10), y: clamp(raw.origin.y as number, -10, 10) } } : {}),
    fill: color(raw.fill, '#aaaaaa'), stroke: color(raw.stroke, 'none'),
    strokeWidth: Math.max(0, fin(raw.strokeWidth, 1)), opacity: clamp(fin(raw.opacity, 1), 0, 1),
    rotation: normDeg(fin(raw.rotation, 0)),
    strokeLinecap: oneOf(raw.strokeLinecap, ['butt', 'round', 'square'], 'round'),
    strokeLinejoin: oneOf(raw.strokeLinejoin, ['miter', 'round', 'bevel'], 'round'),
    strokeDasharray: str(raw.strokeDasharray, ''),
    ...(fin(raw.strokeDashoffset, 0) ? { strokeDashoffset: fin(raw.strokeDashoffset, 0) } : {}),
  };
  switch (raw.type) {
    case 'line':
      return { ...base, type: 'line', x1: fin(raw.x1, 0), y1: fin(raw.y1, 0), x2: fin(raw.x2, 0), y2: fin(raw.y2, 0) };
    case 'rectangle':
      return { ...base, type: 'rectangle', x: fin(raw.x, 0), y: fin(raw.y, 0),
        width: Math.max(0, fin(raw.width, 0)), height: Math.max(0, fin(raw.height, 0)),
        rx: Math.max(0, fin(raw.rx, 0)), ry: Math.max(0, fin(raw.ry, 0)) };
    case 'image': {
      const href = str(raw.href, '');
      if (!/^data:image\/[\w.+-]+(;[\w=.+-]+)*,/.test(href) && !/^https?:\/\//.test(href)) return null;
      const width = fin(raw.width, 0), height = fin(raw.height, 0);
      if (!(width > 0) || !(height > 0)) return null;
      return { ...base, fill: 'none', stroke: 'none', strokeWidth: 0, type: 'image', x: fin(raw.x, 0), y: fin(raw.y, 0), width, height, href,
        ...(typeof raw.preserveAspectRatio === 'string' && /^[\w\s]{1,40}$/.test(raw.preserveAspectRatio) ? { preserveAspectRatio: raw.preserveAspectRatio } : {}),
        ...(raw.flipX === true ? { flipX: true } : {}), ...(raw.flipY === true ? { flipY: true } : {}) };
    }
    case 'ellipse':
      return { ...base, type: 'ellipse', cx: fin(raw.cx, 0), cy: fin(raw.cy, 0),
        rx: Math.max(0, fin(raw.rx, 0)), ry: Math.max(0, fin(raw.ry, 0)) };
    case 'path': {
      const nodes = Array.isArray(raw.nodes) ? raw.nodes.map(normalizeNode).filter((n): n is PathNode => !!n) : [];
      if (nodes.length < 2) return null;
      if (nodes[0].sub) delete nodes[0].sub;                    // the first contour never carries the flag
      const compound = nodes.some(n => n.sub);
      const path: Shape = { ...base, type: 'path', nodes, closed: raw.closed === true || compound };   // compound ⇒ closed
      if (raw.fillRule === 'evenodd') path.fillRule = 'evenodd';
      return path;
    }
    case 'text': {
      const d = DEFAULT_TEXT_PROPS;
      return { ...base, type: 'text', x: fin(raw.x, 0), y: fin(raw.y, 0), content: str(raw.content, ''),
        fontFamily: str(raw.fontFamily, d.fontFamily) || d.fontFamily,
        fontSize: clamp(fin(raw.fontSize, d.fontSize), MIN_FONT_SIZE, MAX_FONT_SIZE),
        fontWeight: normWeight(raw.fontWeight),
        fontStyle: oneOf(raw.fontStyle, ['normal', 'italic'], 'normal'),
        textDecoration: decorationLines(str(raw.textDecoration, '')).join(' '),
        textAnchor: oneOf(raw.textAnchor, ['start', 'middle', 'end'], 'start'),
        letterSpacing: fin(raw.letterSpacing, 0), wordSpacing: fin(raw.wordSpacing, 0),
        lineHeight: clamp(fin(raw.lineHeight, d.lineHeight), 0.5, 5),
        ...(raw.flipX === true ? { flipX: true } : {}), ...(raw.flipY === true ? { flipY: true } : {}) };
    }
    case 'group': {
      if (depth >= MAX_GROUP_DEPTH || !Array.isArray(raw.children)) return null;
      const children = raw.children.map(c => normalizeShape(c, seen, depth + 1)).filter((c): c is Shape => !!c);
      return children.length ? { ...base, type: 'group', children } : null;       // an empty group has no bounds
    }
    default: return null;
  }
}

/** Throws Error with a user-presentable message for anything that is not a usable project. */
export function parseProject(text: string): DocumentState {
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error('This file is not a valid project file.'); }
  if (!isObj(data) || data.format !== PROJECT_FORMAT || !isObj(data.doc)) throw new Error('This file is not a valid project file.');
  if (fin(data.version, 0) > PROJECT_VERSION) throw new Error('This project was saved by a newer version of the editor.');
  const d = data.doc;
  const seen = new Set<string>();
  const bg = oneOf<BackgroundType>(d.background, ['white', 'black', 'transparent-light', 'transparent-dark', 'custom'], 'white');
  return {
    shapes: Array.isArray(d.shapes) ? d.shapes.map(s => normalizeShape(s, seen)).filter((s): s is Shape => !!s) : [],
    width: clamp(Math.round(fin(d.width, 800)), 1, 20000),
    height: clamp(Math.round(fin(d.height, 600)), 1, 20000),
    background: bg,
    bgImage: typeof d.bgImage === 'string' && d.bgImage.startsWith('data:image/') ? d.bgImage : '',
    ...(typeof d.bgColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(d.bgColor) ? { bgColor: d.bgColor.toLowerCase() } : {}),
    ...(d.bgFit === 'contain' || d.bgFit === 'stretch' ? { bgFit: d.bgFit } : {}),
    ...(Array.isArray(d.guides) ? (() => {
      const guides = d.guides.filter((g: any) => isObj(g) && (g.axis === 'x' || g.axis === 'y') && Number.isFinite(g.pos))
        .slice(0, 200).map((g: any) => ({ axis: g.axis as 'x' | 'y', pos: Math.round(g.pos * 100) / 100 }));
      return guides.length ? { guides } : {};
    })() : {}),
  };
}

// ── dirty flag ────────────────────────────────────────────────────────────────

let savedDoc: DocumentState | null = null;
/** True when the document differs from the last save / load (for the "unsaved changes" prompt). */
export const dirty = writable(false);

documentStore.subscribe(doc => {
  dirty.set(savedDoc ? doc !== savedDoc : doc.shapes.length > 0 || !!doc.bgImage);
});

export function markSaved(doc: DocumentState = documentStore.get()) {
  savedDoc = doc;
  dirty.set(false);
}

// ── autosave ──────────────────────────────────────────────────────────────────

export interface AutosaveState { status: 'idle' | 'saved' | 'error'; time: number | null; message?: string; }
export const autosaveState = writable<AutosaveState>({ status: 'idle', time: null });

export function loadAutosave(): DocumentState | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    return raw ? parseProject(raw) : null;
  } catch { return null; }
}

export function clearAutosave() {
  try { localStorage.removeItem(AUTOSAVE_KEY); } catch { /* ignore */ }
}

/**
 * Debounced autosave to localStorage. Call loadAutosave() FIRST — the initial state is not
 * written, so a restore can never be overwritten by an empty document. Returns a stop function.
 */
export function startAutosave(delayMs = 800): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let first = true;
  const save = (doc: DocumentState) => {
    try {
      localStorage.setItem(AUTOSAVE_KEY, serializeProject(doc));
      autosaveState.set({ status: 'saved', time: Date.now() });
    } catch {
      autosaveState.set({ status: 'error', time: Date.now(), message: 'Autosave failed (storage full?). Save the project to a file.' });
    }
  };
  const unsub = documentStore.subscribe(doc => {
    if (first) { first = false; return; }
    clearTimeout(timer);
    timer = setTimeout(() => save(doc), delayMs);
  });
  return () => { clearTimeout(timer); unsub(); };
}

