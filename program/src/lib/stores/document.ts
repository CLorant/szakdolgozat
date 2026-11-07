/**
 * @file The document and its undo / redo history (one store; every change is a commit).
 *
 * History model: a timeline  past[0..n-1] · present · future[0..m-1]  where every
 * entry is the STATE AFTER the action named by its label (the first entry is 'Initial').
 * Jumping to entry i therefore lands exactly on the state its label describes.
 *
 *   commit()                       one atomic change → one history entry
 *   commit(.., {coalesce: key})    consecutive commits with the same key (≤ 1 s apart)
 *                                  collapse into ONE entry (color drags, sliders, typing)
 *   beginPreview/preview/commitPreview/cancelPreview
 *                                  live drags: no history until the drop, and a drop that
 *                                  changed nothing records nothing
 */
import { writable, get } from 'svelte/store';
import type { DocumentState } from '../utils/types';
import { select } from './util';

export const emptyDocument = (): DocumentState => ({
  shapes: [], width: 800, height: 600, background: 'white', bgImage: '',
});

export interface HistoryEntry { doc: DocumentState; label: string; }

interface Core {
  past:     HistoryEntry[];
  present:  HistoryEntry;
  future:   HistoryEntry[];
  base:     HistoryEntry | null;   // non-null while a preview is active
  lastKey:  string | null;
  lastTime: number;
}

export const HISTORY_LIMIT = 200;
const COALESCE_MS = 1000;

const fresh = (doc: DocumentState = emptyDocument(), label = 'Initial'): Core => ({
  past: [], present: { doc, label }, future: [], base: null, lastKey: null, lastTime: 0,
});

const core = writable<Core>(fresh());

const trim = (past: HistoryEntry[]) => past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past;
const cancelled = (c: Core): Core => c.base ? { ...c, present: c.base, base: null } : c;

const current = select(core, c => c.present.doc);

export const documentStore = {
  subscribe: current.subscribe,
  get: (): DocumentState => get(core).present.doc,

  /** Apply `fn` to the document as ONE undoable action. Returning the same object = no-op. */
  commit(label: string, fn: (d: DocumentState) => DocumentState, opts?: { coalesce?: string }) {
    core.update(c0 => {
      const c = cancelled(c0);
      const next = fn(c.present.doc);
      if (next === c.present.doc) return c;
      const now = Date.now();
      const key = opts?.coalesce ?? null;
      if (key && key === c.lastKey && now - c.lastTime < COALESCE_MS && c.past.length) {
        return { ...c, present: { doc: next, label: c.present.label }, future: [], lastTime: now };
      }
      return {
        past: trim([...c.past, c.present]), present: { doc: next, label }, future: [],
        base: null, lastKey: key, lastTime: now,
      };
    });
  },

  // ── live drags ──────────────────────────────────────────────────────────────
  beginPreview() { core.update(c => c.base ? c : { ...c, base: c.present }); },
  preview(fn: (d: DocumentState) => DocumentState) {
    core.update(c => {
      if (!c.base) return c;
      const next = fn(c.present.doc);
      return next === c.present.doc ? c : { ...c, present: { ...c.present, doc: next } };
    });
  },
  commitPreview(label: string) {
    core.update(c => {
      if (!c.base) return c;
      if (c.present.doc === c.base.doc) return { ...c, base: null };
      return {
        past: trim([...c.past, c.base]), present: { doc: c.present.doc, label }, future: [],
        base: null, lastKey: null, lastTime: 0,
      };
    });
  },
  cancelPreview() { core.update(cancelled); },
  isPreviewing: () => get(core).base !== null,

  // ── history navigation ─────────────────────────────────────────────────────
  undo() {
    core.update(c0 => {
      const c = cancelled(c0);
      if (!c.past.length) return c;
      return {
        ...c, past: c.past.slice(0, -1), present: c.past[c.past.length - 1],
        future: [c.present, ...c.future], lastKey: null,
      };
    });
  },
  redo() {
    core.update(c0 => {
      const c = cancelled(c0);
      if (!c.future.length) return c;
      return {
        ...c, past: [...c.past, c.present], present: c.future[0],
        future: c.future.slice(1), lastKey: null,
      };
    });
  },
  /** Jump to timeline index i (0 = oldest; `past.length` = current state). */
  goTo(i: number) {
    core.update(c0 => {
      const c = cancelled(c0);
      const all = [...c.past, c.present, ...c.future];
      if (i < 0 || i >= all.length) return c;
      return { ...c, past: all.slice(0, i), present: all[i], future: all.slice(i + 1), lastKey: null };
    });
  },

  /** Replace the whole document and clear history (New / Open / restore). */
  load(doc: DocumentState, label = 'Open') { core.set(fresh(doc, label)); },
};

export const canUndo       = select(core, c => c.past.length > 0);
export const canRedo       = select(core, c => c.future.length > 0);
export const historyPast   = select(core, c => c.past);      // stable refs → cheap
export const historyFuture = select(core, c => c.future);
export const historyNow    = select(core, c => c.present.label);
export const shapesStore   = select(current, d => d.shapes);
