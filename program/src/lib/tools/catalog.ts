/**
 * @file The drawing tools as the user sees them: name, icon and keyboard shortcut.
 * Shared by the toolbar and the Help dialog so both always list the same keys.
 */
import type { ToolType } from '../utils/types';

export interface ToolInfo {
  type: ToolType;
  label: string;
  icon: string;
  shortcut: string;
  /** Draws a separator after this tool in the toolbar. */
  groupEnd?: boolean;
}

export const TOOLS: readonly ToolInfo[] = [
  // select and reshape
  { type: 'transform', label: 'Select / Transform', icon: 'pointer',  shortcut: 'V' },
  { type: 'edit',      label: 'Edit Nodes',         icon: 'edit',     shortcut: 'E', groupEnd: true },
  // draw lines and curves
  { type: 'pen',       label: 'Pen (Bézier)',       icon: 'pen',      shortcut: 'B' },
  { type: 'arc',       label: 'Arc',                icon: 'arc',      shortcut: 'A' },
  { type: 'freehand',  label: 'Freehand',           icon: 'freehand', shortcut: 'F' },
  { type: 'line',      label: 'Line',               icon: 'line',     shortcut: 'L', groupEnd: true },
  // draw shapes
  { type: 'rectangle', label: 'Rectangle',          icon: 'square',   shortcut: 'R' },
  { type: 'ellipse',   label: 'Ellipse',            icon: 'circle',   shortcut: 'O' },
  { type: 'polygon',   label: 'Polygon',            icon: 'polygon',  shortcut: 'P', groupEnd: true },
  { type: 'text',      label: 'Text',               icon: 'text',     shortcut: 'T', groupEnd: true },
  // build and cut shapes
  { type: 'blob',      label: 'Blob',               icon: 'blob',     shortcut: 'Shift+B' },
  { type: 'scissors',  label: 'Scissors',           icon: 'scissors', shortcut: 'C', groupEnd: true },
  // view
  { type: 'pan',       label: 'Pan',         icon: 'hand',     shortcut: 'H' },
];

/** The tool for a key press ("b", or "shift+b" when Shift is held), if any. */
export function toolForKey(key: string, shift: boolean): ToolType | undefined {
  const k = (shift ? 'shift+' : '') + key.toLowerCase();
  return TOOLS.find(t => t.shortcut.toLowerCase() === k)?.type
    ?? (shift ? TOOLS.find(t => t.shortcut.toLowerCase() === key.toLowerCase())?.type : undefined);
}
