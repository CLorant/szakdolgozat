// @vitest-environment jsdom
// Project files, the dirty flag and autosave.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { serializeProject, parseProject, normalizeShape, startAutosave, loadAutosave, clearAutosave, dirty, markSaved, autosaveState } from '../../src/lib/utils/project';
import { emptyDocument } from '../../src/lib/stores/document';
import { editor } from '../../src/lib/stores/editor';
import { makeRect, makePath, makeText } from '../../src/lib/utils/shapes';
import { corner } from '../../src/lib/utils/path';
import { DEFAULT_TEXT_PROPS } from '../../src/lib/utils/text';

const st = { fill: '#336699', stroke: '#000000', strokeWidth: 2 };

describe('project format', () => {
  it('round-trips a document', () => {
    const d = { ...emptyDocument(), width: 321, shapes: [makeRect(1, 2, 3, 4, st), makePath([corner(0, 0), corner(5, 5)], false, st)] };
    expect(parseProject(serializeProject(d))).toEqual(d);
  });
  it('rejects garbage and newer versions', () => {
    expect(() => parseProject('nope')).toThrow(/valid project/);
    expect(() => parseProject('{"a":1}')).toThrow(/valid project/);
    expect(() => parseProject(JSON.stringify({ format: 'svg-editor-project', version: 99, doc: {} }))).toThrow(/newer/);
  });
  it('sanitises broken data instead of crashing the editor later', () => {
    const text = JSON.stringify({ format: 'svg-editor-project', version: 1, doc: {
      width: -5, height: 1e9, background: 'pink', bgImage: 'http://evil', shapes: [
        { type: 'rectangle', id: 'a', x: 'NaN', width: 5, height: 5, fill: 'javascript:1' },
        { type: 'rectangle', id: 'a' },                       // duplicate id
        { type: 'path', nodes: [{ x: 1, y: 1 }] },            // too few nodes
        { type: 'mystery' }, null, 42,
      ] } });
    const d = parseProject(text);
    expect(d.width).toBe(1); expect(d.height).toBe(20000); expect(d.background).toBe('white'); expect(d.bgImage).toBe('');
    expect(d.shapes).toHaveLength(2);
    expect(new Set(d.shapes.map(s => s.id)).size).toBe(2);
    expect(d.shapes[0]).toMatchObject({ x: 0, fill: '#aaaaaa', rotation: 0, strokeLinecap: 'round' });
    expect(normalizeShape({ type: 'text', fontSize: 99999 }, new Set())).toMatchObject({ fontSize: 2000, fontFamily: 'sans-serif' });
  });
});

describe('dirty flag + autosave', () => {
  beforeEach(() => { localStorage.clear(); editor.newDocument(); markSaved(); vi.useFakeTimers(); });

  it('tracks unsaved changes', () => {
    expect(get(dirty)).toBe(false);
    editor.addShape(makeRect(0, 0, 1, 1, st));
    expect(get(dirty)).toBe(true);
    markSaved();
    expect(get(dirty)).toBe(false);
    editor.undo();
    expect(get(dirty)).toBe(true);
  });
  it('debounces, skips the initial state, and restores', () => {
    const stop = startAutosave(500);
    vi.advanceTimersByTime(2000);
    expect(loadAutosave()).toBeNull();                       // nothing written for the untouched start
    for (let i = 0; i < 5; i++) editor.addShape(makeRect(i, 0, 1, 1, st));
    expect(loadAutosave()).toBeNull();                       // still debouncing
    vi.advanceTimersByTime(600);
    expect(loadAutosave()!.shapes).toHaveLength(5);
    expect(get(autosaveState).status).toBe('saved');
    stop(); clearAutosave();
    expect(loadAutosave()).toBeNull();
  });
  it('reports storage failures', () => {
    const stop = startAutosave(10);
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    editor.addShape(makeRect(0, 0, 1, 1, st));
    vi.advanceTimersByTime(50);
    expect(get(autosaveState).status).toBe('error');
    spy.mockRestore(); stop();
  });
});
