/**
 * @file Which color code (HEX / RGB / HSL) the color pickers show.
 *
 * One setting for every picker (fill, stroke, gradient stops, background), kept between panel visits and sessions:
 * it is the user's way of thinking about color, not a property of an object.
 */
import { writable } from 'svelte/store';

export type ColorMode = 'hex' | 'rgb' | 'hsl';
const KEY = 'svge.colorMode';
const MODES: readonly ColorMode[] = ['hex', 'rgb', 'hsl'];

function load(): ColorMode {
  try { const v = localStorage.getItem(KEY); if (MODES.includes(v as ColorMode)) return v as ColorMode; } catch { /* storage blocked */ }
  return 'hex';
}

const store = writable<ColorMode>(load());
export const colorMode = {
  subscribe: store.subscribe,
  set(m: ColorMode) { store.set(m); try { localStorage.setItem(KEY, m); } catch { /* storage blocked */ } },
};
