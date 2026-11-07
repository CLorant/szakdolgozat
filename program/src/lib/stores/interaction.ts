/**
 * @file Transient interaction state: drawing previews, overlay primitives, the in-canvas text editor and snap
 * guides. None of it is part of the document or the undo history.
 */
import { writable } from 'svelte/store';
import type { Point, Shape, TextShape } from '../utils/types';

/** Rubber-band / preview shape while drawing. */
export const tempShape = writable<Shape | null>(null);

/**
 * Overlay primitives a tool wants drawn (polygon rubber band, pen handles, selection rectangle…).
 * Sizes marked "screen px" are divided by the zoom when drawn, so they stay constant on screen.
 */
export type Guide =
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; color?: string; dash?: boolean }
  | { kind: 'dot';  x: number; y: number; r?: number; color?: string; fill?: string }   // r: screen px
  | { kind: 'ring'; x: number; y: number; r?: number; color?: string }                  // r: screen px
  | { kind: 'rect'; x: number; y: number; width: number; height: number; color?: string }
  | { kind: 'poly'; points: Point[]; closed?: boolean; color?: string; dash?: boolean };
export const guides = writable<Guide[]>([]);

/** Edit-node id ('a3', 'i3', 'o3', …) currently highlighted in the edit tool (its Bézier handles are shown). */
export const activeNode = writable<string | null>(null);

/** Anchors picked together in the Edit tool (click, Shift-click, drag a rectangle); they move and delete together. */
export const pickedNodes = writable<{ shapeId: string; ids: string[] } | null>(null);

/**
 * The in-canvas text editor session. A NEW text shape is not in the document until the
 * session is committed with non-empty content (so cancelling leaves no history entries).
 */
export interface TextEditState { shape: TextShape; isNew: boolean; }
export const textEdit = writable<TextEditState | null>(null);

/** Magenta alignment lines shown while something snaps to another object (kept apart from `guides`: tools reset those). */
export const snapGuides = writable<Guide[]>([]);

/** A ruler guide being dragged out of a ruler or moved (document units); null when none. */
export const guidePreview = writable<{ axis: 'x' | 'y'; pos: number; /** index of the stored guide being moved (hidden while it is dragged) */ index?: number } | null>(null);

/**
 * The canvas context menu: where it opens (client px) and the point under it (current level's frame, for Paste).
 * null when closed.
 */
export const contextMenu = writable<{ x: number; y: number; at: Point } | null>(null);
