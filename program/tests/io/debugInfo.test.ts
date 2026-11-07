// @vitest-environment jsdom
// Help → Copy debug info.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { editor } from '../../src/lib/stores/editor';
import { documentStore } from '../../src/lib/stores/document';
import { makeRect } from '../../src/lib/utils/shapes';
import { buildDebugReport, copyDebugInfo, recentErrors, clearRecentErrors } from '../../src/lib/utils/debugInfo';
import { parseProject } from '../../src/lib/utils/project';

const st = { fill: '#336699', stroke: '#000000', strokeWidth: 2 };

beforeEach(() => { editor.newDocument(); clearRecentErrors(); });

describe('debug info', () => {
  it('contains environment, history labels, and a document that parses back', () => {
    editor.addShape(makeRect(1, 2, 30, 40, st));
    editor.flip('h');
    const r = buildDebugReport();
    expect(r).toContain('--- Environment ---');
    expect(r).toContain('Add rectangle');
    expect(r).toContain('> Flip horizontal');
    const json = r.slice(r.lastIndexOf('{"format"'));
    expect(parseProject(json.trim()).shapes).toHaveLength(1);
    expect(parseProject(json.trim()).shapes[0].id).toBe(documentStore.get().shapes[0].id);
  });

  it('leaves out a huge background image but says so', () => {
    editor.setBgImage('data:image/png;base64,' + 'A'.repeat(5000));
    const r = buildDebugReport();
    expect(r).not.toContain('AAAAAAAAAA');
    expect(r).toContain('background image omitted');
  });

  it('captures console.error and uncaught errors', () => {
    console.error('boom', { a: 1 });
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('uncaught!') }));
    expect(recentErrors().map(e => e.kind)).toEqual(['console.error', 'error']);
    const r = buildDebugReport();
    expect(r).toContain('boom {"a":1}');
    expect(r).toContain('uncaught!');
  });

  it('uses the clipboard when available and falls back to a download otherwise', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true });
    expect(await copyDebugInfo()).toBe('clipboard');
    expect(write).toHaveBeenCalledOnce();

    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, configurable: true });
    (document as any).execCommand = vi.fn().mockReturnValue(false);
    URL.createObjectURL = vi.fn().mockReturnValue('blob:x'); URL.revokeObjectURL = vi.fn();
    expect(await copyDebugInfo()).toBe('download');
  });
});
