/**
 * @file Making fonts available to the EDITOR's own rendering (the canvas).
 *
 *  • ensureEditorFont: registers the Google faces a text needs with the browser (FontFace API; the
 *    files load lazily, per unicode-range subset, when a character needs them). Local fonts need
 *    nothing — the browser already has them.
 *  • requestPreviews: the picker shows every family NAME in its own typeface. One CSS2 request per batch
 *    of visible families, with text=<the letters of those names>, so each preview font is ~1–3 KB.
 *    Previews are registered under an alias family so these tiny fonts can never shadow the real one.
 */

import { writable, get } from 'svelte/store';
import type { Shape } from '../utils/types';
import { fontEpoch } from '../utils/text';
import { cssUrl, parseFontFaces, textParam, type FaceRule } from './googleCss';
import { fetchCss, fetchStyle } from './google';
import { HttpError } from './net';
import { resolveSource } from './sources';

const canLoad = () => typeof document !== 'undefined' && !!document.fonts && typeof FontFace !== 'undefined';

function addFaces(family: string, rules: readonly FaceRule[], added: Set<string>, alias?: string): FontFace[] {
  const out: FontFace[] = [];
  for (const r of rules) {
    const id = `${alias ?? family}|${r.url}|${r.weight}|${r.style}`;
    if (added.has(id)) continue;
    added.add(id);
    const src = `url("${r.url}")${r.format ? ` format("${r.format}")` : ''}`;
    const face = new FontFace(alias ?? family, src, {
      style: r.style, weight: r.weight, display: 'swap', ...(r.unicodeRange ? { unicodeRange: r.unicodeRange } : {}),
    });
    document.fonts.add(face);
    out.push(face);
  }
  return out;
}

// ── real fonts ────────────────────────────────────────────────────────────────

const registered = new Set<string>();                      // family|weight|style done
const added = new Set<string>();                           // individual faces
const inflight = new Map<string, Promise<void>>();
const failedAt = new Map<string, number>();
const RETRY_MS = 30_000;

export function ensureEditorFont(family: string, weight: number, style: 'normal' | 'italic'): Promise<void> {
  if (!canLoad() || !family.trim()) return Promise.resolve();
  const key = `${family.trim().toLowerCase()}|${weight}|${style}`;
  if (registered.has(key)) return Promise.resolve();
  if (Date.now() - (failedAt.get(key) ?? 0) < RETRY_MS) return Promise.resolve();
  let p = inflight.get(key);
  if (p) return p;
  p = (async () => {
    try {
      if (await resolveSource(family) !== 'google') return;           // generic / local / unknown: the browser decides
      const w = weight;
      const r = await fetchStyle(family, { weight: w, italic: style === 'italic' });
      addFaces(r.family, r.rules, added);
      registered.add(key);
      await document.fonts.load(`${style} ${w} 16px "${r.family}"`).catch(() => []);   // the most likely subset, now
      fontEpoch.update(n => n + 1);
    } catch {
      // Offline or unknown family: the text is drawn with the fallback font, and the load is retried later.
      failedAt.set(key, Date.now());
    } finally { inflight.delete(key); }
  })();
  inflight.set(key, p);
  return p;
}

/** Loads every font style the visible texts use. Cheap to call often. */
export function syncEditorFonts(shapes: readonly Shape[]) {
  const walk = (list: readonly Shape[]) => {
    for (const s of list) {
      if (s.type === 'group') walk(s.children);
      else if (s.type === 'text' && s.visible) void ensureEditorFont(s.fontFamily, s.fontWeight, s.fontStyle);
    }
  };
  walk(shapes);
}

// ── previews for the picker ───────────────────────────────────────────────────

export interface Preview { alias: string; status: 'loading' | 'ready' | 'failed'; }
export const previews = writable<Record<string, Preview>>({});

const BATCH = 12, PARALLEL = 2;
let queue: string[] = [];
let running = 0;
let counter = 0;
const aliasAdded = new Set<string>();

const setPreview = (name: string, p: Preview) => previews.update(m => ({ ...m, [name]: p }));

async function loadBatch(names: string[]): Promise<void> {
  const aliasOf = new Map(names.map(n => [n, `svge-preview-${++counter}`]));
  names.forEach(n => setPreview(n, { alias: aliasOf.get(n)!, status: 'loading' }));
  try {
    const css = await fetchCss(cssUrl(names.map(family => ({ family })), { text: textParam(names.join('')) ?? undefined }));
    const rules = parseFontFaces(css);
    await Promise.all(names.map(async name => {
      const mine = rules.filter(r => r.family.toLowerCase() === name.toLowerCase());
      if (!mine.length) { setPreview(name, { alias: aliasOf.get(name)!, status: 'failed' }); return; }
      const faces = addFaces(name, mine, aliasAdded, aliasOf.get(name)!);
      await Promise.all(faces.map(f => f.load().catch(() => undefined)));
      setPreview(name, { alias: aliasOf.get(name)!, status: 'ready' });
    }));
  } catch (e) {
    if (e instanceof HttpError && e.status === 400 && names.length > 1) {      // one bad name poisons the batch: bisect
      const mid = names.length >> 1;
      await loadBatch(names.slice(0, mid));
      await loadBatch(names.slice(mid));
    } else names.forEach(n => setPreview(n, { alias: aliasOf.get(n)!, status: 'failed' }));
  }
}

function pump() {
  while (running < PARALLEL && queue.length) {
    const batch = queue.splice(0, BATCH);
    running++;
    loadBatch(batch).finally(() => { running--; pump(); });
  }
}

/** The families currently visible in the picker. Replaces the waiting list (scrolled-past rows are not worth loading). */
export function requestPreviews(names: readonly string[]) {
  if (!canLoad()) return;
  const known = get(previews);
  queue = names.filter(n => !known[n]);
  pump();
}
