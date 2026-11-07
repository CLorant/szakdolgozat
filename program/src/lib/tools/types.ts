/**
 * @file The tool interface: what a tool receives from the canvas and what it must implement.
 */
import type { Point, TextShape } from '../utils/types';

export interface PointerInfo {
  /** Document coordinates, grid-snapped when snapping is on. */
  p:      Point;
  /** Document coordinates, never snapped. */
  raw:    Point;
  shift:  boolean;
  alt:    boolean;
  ctrl:   boolean;
  /** Element under the pointer (used to find handles / shapes via data-* attributes). */
  target: Element | null;
}

export interface ToolContext {
  zoom(): number;
  openText(shape: TextShape, isNew: boolean): void;
}

/**
 * One interaction mode. A tool talks to the world only through the stores
 * (editor.*, tempShape, guides), so it can be unit-tested without a DOM.
 */
export interface Tool {
  down(i: PointerInfo): void;
  move(i: PointerInfo): void;
  up(i: PointerInfo): void;
  dblclick?(i: PointerInfo): void;
  /** Return true if the key was consumed (Canvas then skips its own handling). */
  key?(e: { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): boolean;
  /** Esc. Return true if something was cancelled / finished; false → Canvas deselects. */
  escape(): boolean;
  /** Tool switched away: finish or discard whatever is pending. */
  deactivate(): void;
  /** True while a pointer operation or a multi-click creation is in progress. */
  busy(): boolean;
}
