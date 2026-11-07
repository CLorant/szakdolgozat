/**
 * @file The Hand tool. Panning itself is done by Canvas (Space-drag and the middle button use the same code); the
 * tool exists so that it can be selected and so that nothing else reacts to the pointer while it is active.
 */
import type { Tool } from './types';

export function createPanTool(): Tool {
  return { down() {}, move() {}, up() {}, escape: () => false, deactivate() {}, busy: () => false };
}
