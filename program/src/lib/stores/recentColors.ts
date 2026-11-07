/**
 * @file The colors behind the color picker's swatch: the ones picked last (kept between sessions, like the color
 * mode) and the ones the drawing already uses.
 */
import { writable, derived } from 'svelte/store';
import { documentStore } from './document';
import { walk } from '../utils/tree';
import { parseGradient } from '../utils/gradient';

const KEY = 'svge.recentColors';
export const MAX_RECENT = 16;
const MAX_DOC = 24;
const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/;

function load(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (Array.isArray(v)) return v.filter(c => typeof c === 'string' && HEX.test(c)).slice(0, MAX_RECENT);
  } catch { /* storage blocked or junk */ }
  return [];
}

const store = writable<string[]>(load());
export const recentColors = { subscribe: store.subscribe };

/** Puts a color first in the recent list (once; the oldest falls off). */
export function rememberColor(hex: string) {
  const c = hex.toLowerCase();
  if (!HEX.test(c)) return;
  store.update(list => {
    if (list[0] === c) return list;
    const next = [c, ...list.filter(x => x !== c)].slice(0, MAX_RECENT);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage blocked: kept for this session */ }
    return next;
  });
}

/** Solid colors and gradient stop colors used in the drawing, in drawing order, without repeats. */
export const documentColors = derived(documentStore, d => {
  const seen = new Set<string>();
  const add = (paint: string) => {
    const g = parseGradient(paint);
    for (const c of g ? g.stops.map(s => s.color) : [paint]) {
      const l = c.toLowerCase();
      if (HEX.test(l) && seen.size < MAX_DOC) seen.add(l);
    }
  };
  walk(d.shapes, s => { if (s.type !== 'group' && s.type !== 'image') { add(s.fill); add(s.stroke); } });
  return [...seen];
});
