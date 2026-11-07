// Derived stores stay in sync.
import { describe, it, expect, beforeEach } from 'vitest';
import { editor, selectedShapes } from '../../src/lib/stores/editor';
import { documentStore } from '../../src/lib/stores/document';
import { ui } from '../../src/lib/stores/ui';
import { makeRect } from '../../src/lib/utils/shapes';

const st = { fill: '#336699', stroke: '#000000', strokeWidth: 2 };

/** What a mounted component sees: ONE long-lived subscription, like `$selectedShapes` in Canvas. */
let seen: readonly any[] = [];
const expected = () => documentStore.get().shapes.filter(s => ui.get().selectedIds.includes(s.id));
const inSync = () => {
  const e = expected();
  return seen.length === e.length && seen.every((s, i) => s === e[i]);
};

beforeEach(() => { editor.newDocument(); });
selectedShapes.subscribe(v => { seen = v; });

describe('selectedShapes stays in sync for a long-lived subscriber', () => {
  it('after a drag that changed nothing (beginDrag without any preview)', () => {
    const r = makeRect(0, 0, 10, 10, st); editor.addShape(r);
    editor.beginDrag(); editor.commitDrag('Move');          // click without moving
    editor.nudge(5, 0);
    expect(inSync()).toBe(true);
    editor.deselectAll();
    expect(inSync()).toBe(true);
  });
  it('after unrelated ui changes (tool switch, defaults) and then a document change', () => {
    const r = makeRect(0, 0, 10, 10, st); editor.addShape(r);
    ui.selectTool('rectangle'); ui.selectTool('transform'); ui.set({ fill: '#ff0000' });
    editor.nudge(5, 0);
    expect(inSync()).toBe(true);
    ui.selectTool('edit');
    editor.deselectAll();
    expect(inSync()).toBe(true);
  });
  it('through a live drag', () => {
    const r = makeRect(0, 0, 10, 10, st); editor.addShape(r);
    editor.beginDrag();
    editor.previewShapes(new Map([[r.id, { ...r, x: 50 }]]));
    expect(inSync()).toBe(true);
    editor.previewShapes(new Map([[r.id, { ...r, x: 80 }]]));
    expect(inSync()).toBe(true);
    editor.commitDrag('Move');
    expect(inSync()).toBe(true);
  });
});
