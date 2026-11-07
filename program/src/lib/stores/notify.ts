/**
 * @file Toast notifications: a short queue shown by components/Toasts.svelte. Keep them for what the user must know
 * (a refused action, lost data, a problem with a file), not for things they can see.
 */
import { writable } from 'svelte/store';

export type ToastKind = 'info' | 'warn' | 'error';
export interface Toast { id: number; kind: ToastKind; message: string; }

export const toasts = writable<Toast[]>([]);
let next = 1;

export function dismiss(id: number) { toasts.update(t => t.filter(x => x.id !== id)); }

export function notify(message: string, kind: ToastKind = 'info', ms = 4500): number {
  const id = next++;
  toasts.update(t => [...t.slice(-3), { id, kind, message }]);     // at most 4 visible
  if (ms > 0 && typeof setTimeout !== 'undefined') setTimeout(() => dismiss(id), ms);
  return id;
}

export const notifyError = (e: unknown) => notify(e instanceof Error ? e.message : String(e), 'error', 8000);
