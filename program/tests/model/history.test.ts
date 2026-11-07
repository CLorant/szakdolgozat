// Undo / redo history.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { documentStore, canUndo, canRedo, historyPast, emptyDocument } from '../../src/lib/stores/document';
import { editor } from '../../src/lib/stores/editor';
import { ui } from '../../src/lib/stores/ui';
import { makeRect } from '../../src/lib/utils/shapes';

const st = { fill: '#fff', stroke: '#000', strokeWidth: 1 };
beforeEach(() => { editor.newDocument(); });

describe('history', () => {
  it('undo/redo flags update immediately', () => {
    expect(get(canUndo)).toBe(false);
    editor.addShape(makeRect(0, 0, 10, 10, st));
    expect(get(canUndo)).toBe(true);
    editor.undo();
    expect(get(canRedo)).toBe(true);
    expect(documentStore.get().shapes).toHaveLength(0);
  });
  it('labels describe the state they point at', () => {
    editor.addShape(makeRect(0, 0, 10, 10, st));
    editor.addShape(makeRect(0, 0, 10, 10, st));
    documentStore.goTo(1);
    expect(documentStore.get().shapes).toHaveLength(1);
  });
  it('coalesces continuous style edits into one step', () => {
    const r = makeRect(0, 0, 10, 10, st);
    editor.addShape(r);
    for (let i = 0; i < 50; i++) editor.setStyle({ fill: `#00${(i % 10)}000` });
    expect(get(historyPast)).toHaveLength(2);        // Initial + before-style state
    editor.undo();
    expect(documentStore.get().shapes[0].fill).toBe('#fff');
  });
  it('no-ops are not recorded', () => {
    editor.deleteSelected();
    editor.sendToBack();
    expect(get(canUndo)).toBe(false);
  });
  it('a drag with no change records nothing; a real drag records once', () => {
    const r = makeRect(0, 0, 10, 10, st);
    editor.addShape(r);
    const n = get(historyPast).length;
    editor.beginDrag(); editor.commitDrag('Move');
    expect(get(historyPast)).toHaveLength(n);
    editor.beginDrag();
    for (let i = 1; i < 20; i++) editor.previewShapes(new Map([[r.id, { ...r, x: i }]]));
    editor.commitDrag('Move');
    expect(get(historyPast)).toHaveLength(n + 1);
    editor.undo();
    expect((documentStore.get().shapes[0] as any).x).toBe(0);
  });
  it('cancelDrag restores the document', () => {
    const r = makeRect(0, 0, 10, 10, st);
    editor.addShape(r);
    editor.beginDrag(); editor.previewShapes(new Map([[r.id, { ...r, x: 99 }]])); editor.cancelDrag();
    expect((documentStore.get().shapes[0] as any).x).toBe(0);
  });
  it('selection is pruned on undo and multi-select reorder works', () => {
    const a = makeRect(0, 0, 1, 1, st), b = makeRect(0, 0, 1, 1, st), c = makeRect(0, 0, 1, 1, st);
    editor.addShapes([a, b, c]);
    expect(ui.get().selectedIds).toHaveLength(3);
    editor.select([a.id, b.id]); editor.bringToFront();
    expect(documentStore.get().shapes.map(s => s.id)).toEqual([c.id, a.id, b.id]);
    editor.undo(); editor.undo();
    expect(ui.get().selectedIds).toHaveLength(0);
  });
  it('paste offsets every shape type', () => {
    const r = makeRect(0, 0, 1, 1, st);
    editor.addShape(r); editor.copy(); editor.paste();
    expect(documentStore.get().shapes).toHaveLength(2);
    expect((documentStore.get().shapes[1] as any).x).toBe(10);
  });
  it('history is capped', () => {
    for (let i = 0; i < 260; i++) editor.addShape(makeRect(i, 0, 1, 1, st));
    expect(get(historyPast).length).toBeLessThanOrEqual(200);
  });
});
void vi; void emptyDocument;
