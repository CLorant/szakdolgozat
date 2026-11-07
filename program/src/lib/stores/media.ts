/**
 * @file Screen-size state. On narrow screens the property panel becomes a sheet that slides up from the bottom
 * and a few command bar controls are left out.
 */
import { readable } from 'svelte/store';

/** Must match the `@media (max-width: 640px)` rules in the components. */
export const NARROW_QUERY = '(max-width: 640px)';

export const narrow = readable(false, set => {
  const mq = typeof window !== 'undefined' ? window.matchMedia?.(NARROW_QUERY) : undefined;
  if (!mq) return;
  set(mq.matches);
  const on = (e: MediaQueryListEvent) => set(e.matches);
  mq.addEventListener('change', on);
  return () => mq.removeEventListener('change', on);
});

/** A finger is the main pointer (phones, tablets): handles get larger invisible grab areas. */
export const coarse = readable(false, set => {
  const mq = typeof window !== 'undefined' ? window.matchMedia?.('(pointer: coarse)') : undefined;
  if (!mq) return;
  set(mq.matches);
  const on = (e: MediaQueryListEvent) => set(e.matches);
  mq.addEventListener('change', on);
  return () => mq.removeEventListener('change', on);
});

/** Radius of those grab areas, screen px (a fingertip is ~10 mm, ~40 px). */
export const TOUCH_HIT_R = 14;
