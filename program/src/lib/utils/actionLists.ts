/**
 * @file Button lists shared by the command bar, the Object menu and the context menu, so they name and order
 * the same actions in the same way.
 */
import type { BooleanOp } from './boolean';

export type AlignAxis = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

/** [axis, icon character, title] */
export const ALIGN_ACTIONS: ReadonlyArray<readonly [AlignAxis, string, string]> = [
  ['left',   '⊣', 'Align left edges'],
  ['center', '⊼', 'Centre horizontally'],
  ['right',  '⊢', 'Align right edges'],
  ['top',    '⊤', 'Align top edges'],
  ['middle', '⊻', 'Centre vertically'],
  ['bottom', '⊥', 'Align bottom edges'],
];

/** [operation, title that says what it does] */
export const BOOLEAN_ACTIONS: ReadonlyArray<readonly [BooleanOp, string]> = [
  ['unite',     'Unite: one shape from all of them'],
  ['subtract',  'Subtract: cut the shapes in front out of the bottom one'],
  ['intersect', 'Intersect: keep only where all of them overlap'],
  ['exclude',   'Exclude: keep where an odd number overlap'],
  ['divide',    'Divide: split into the pieces the outlines make'],
];
