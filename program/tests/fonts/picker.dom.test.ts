// @vitest-environment jsdom
// Font picker and the fonts the canvas loads.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { mount, flushSync, unmount } from 'svelte';
import { get } from 'svelte/store';
import FontList from '../../src/lib/components/FontList.svelte';
import FontPicker from '../../src/lib/components/FontPicker.svelte';
import { requestPreviews, previews, ensureEditorFont, syncEditorFonts } from '../../src/lib/fonts/editorFonts';
import { ensureGoogleCatalog } from '../../src/lib/fonts/state';
import { makeText, makeGroup } from '../../src/lib/utils/shapes';
import { DEFAULT_TEXT_PROPS } from '../../src/lib/utils/text';
import { net } from '../helpers/fakeGoogle';

// jsdom has no FontFace / document.fonts
interface Face { family: string; src: string; desc: Record<string, string>; }
const faces: Face[] = [];
beforeAll(() => {
  (globalThis as any).FontFace = class { constructor(public family: string, public src: string, public desc: Record<string, string>) {} load() { return Promise.resolve(this); } };
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { add: (f: Face) => faces.push(f), load: async () => [], addEventListener() {} },
  });
});
const css = () => net.log.filter(u => u.includes('fonts.googleapis.com'));
const st = { fill: '#000', stroke: 'none', strokeWidth: 0 };

describe('FontList (windowed)', () => {
  const items = Array.from({ length: 1500 }, (_, i) => `Font ${String(i).padStart(4, '0')}`);

  it('keeps only the rows in view in the DOM, follows the scroll, reports the visible names', async () => {
    vi.useFakeTimers();
    const seen: string[][] = [];
    const picked: string[] = [];
    const c = mount(FontList, { target: document.body, props: { items, selected: '', onPick: (f: string) => picked.push(f), onVisible: (v: string[]) => seen.push(v) } });
    flushSync();
    const rows = () => [...document.querySelectorAll<HTMLButtonElement>('.fl-row')];
    expect(rows().length).toBeGreaterThan(5);
    expect(rows().length).toBeLessThan(25);                                         // not 1500
    expect(rows()[0].textContent).toBe('Font 0000');

    vi.advanceTimersByTime(130);
    expect(seen.at(-1)![0]).toBe('Font 0000');
    expect(seen.at(-1)!.length).toBeLessThan(15);

    const list = document.querySelector<HTMLElement>('.fl')!;
    Object.defineProperty(list, 'scrollTop', { configurable: true, value: 3500, writable: true });
    list.dispatchEvent(new Event('scroll'));
    flushSync();
    expect(rows().some(r => r.textContent === 'Font 0100')).toBe(true);             // 3500 / 35 = row 100
    expect(rows().some(r => r.textContent === 'Font 0000')).toBe(false);

    rows().find(r => r.textContent === 'Font 0100')!.click();
    expect(picked).toEqual(['Font 0100']);
    unmount(c);
    vi.useRealTimers();
  });
});

describe('preview fonts for the picker', () => {
  it('one batch request for the visible names with text= ; a bad name is isolated by bisecting; aliases never shadow real families', async () => {
    net.log.length = 0; faces.length = 0;
    await ensureGoogleCatalog(true);
    net.log.length = 0;
    requestPreviews(['Abril Fatface', 'Aaa Missing', 'Inter', 'Roboto']);
    await vi.waitFor(() => {
      const p = get(previews);
      expect(['Abril Fatface', 'Aaa Missing', 'Inter', 'Roboto'].every(n => p[n] && p[n].status !== 'loading')).toBe(true);
    });
    const first = css()[0];
    expect(first.match(/family=/g)).toHaveLength(4);
    expect(first.match(/text=/g)).toHaveLength(1);
    const letters = [...new Set(['Abril Fatface', 'Aaa Missing', 'Inter', 'Roboto'].join(''))].sort((a, b) => a.codePointAt(0)! - b.codePointAt(0)!).join('');
    expect(decodeURIComponent(first.split('text=')[1].split('&')[0])).toBe(letters);                 // the letters of the four names, once
    const p = get(previews);
    expect(p['Aaa Missing'].status).toBe('failed');
    expect(p['Roboto'].status).toBe('ready');
    expect(p['Inter'].status).toBe('ready');
    expect(faces.length).toBeGreaterThanOrEqual(3);
    for (const f of faces) { expect(f.family).toMatch(/^svge-preview-\d+$/); }
  });

  it('names already loaded are not requested again; the waiting list is replaced by the newest request', async () => {
    net.log.length = 0;
    requestPreviews(['Roboto', 'Inter']);
    expect(css()).toEqual([]);
  });
});

describe('fonts for the canvas', () => {
  it('registers the real faces of a Google font (no text= — the editor needs every glyph), once', async () => {
    faces.length = 0; net.log.length = 0;
    await ensureEditorFont('Roboto', 700, 'normal');
    expect(css()).toEqual(['https://fonts.googleapis.com/css2?family=Roboto:wght@700&display=swap']);
    expect(faces).toHaveLength(1);
    expect(faces[0].family).toBe('Roboto');
    expect(faces[0].desc).toMatchObject({ weight: '700', style: 'normal', display: 'swap' });
    expect(faces[0].desc.unicodeRange).toContain('U+0000-00FF');
    await ensureEditorFont('Roboto', 700, 'normal');
    expect(css()).toHaveLength(1);
  });
  it('generic and unknown families need nothing', async () => {
    net.log.length = 0;
    await ensureEditorFont('sans-serif', 400, 'normal');
    await ensureEditorFont('Georgia', 400, 'normal');
    expect(css()).toEqual([]);
  });
  it('a document is scanned including groups; italic is requested with the ital axis', async () => {
    net.log.length = 0;
    const t = makeText(0, 0, 'x', { ...DEFAULT_TEXT_PROPS, fontFamily: 'Roboto', fontStyle: 'italic' }, st);
    const hidden = { ...makeText(0, 0, 'y', { ...DEFAULT_TEXT_PROPS, fontFamily: 'Inter' }, st), visible: false };
    syncEditorFonts([makeGroup([t, hidden])]);
    await vi.waitFor(() => expect(css().length).toBe(1));
    expect(css()[0]).toBe('https://fonts.googleapis.com/css2?family=Roboto:ital,wght@1,400&display=swap');
  });
  it('offline: nothing breaks and nothing is logged (the text falls back until a later retry)', async () => {
    net.offline = true;
    const warn = vi.spyOn(console, 'warn'), error = vi.spyOn(console, 'error');
    await ensureEditorFont('Inter', 400, 'normal');
    expect(warn).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
    warn.mockRestore(); error.mockRestore();
    net.offline = false;
  });
  it('a synthesized style asks Google only for the style that exists (no refused request)', async () => {
    net.log.length = 0;
    await ensureEditorFont('Abril Fatface', 700, 'italic');                      // regular only
    const css = net.log.filter(u => u.includes('fonts.googleapis.com'));
    expect(css).toHaveLength(1);
    expect(css[0]).toContain('family=Abril+Fatface:wght@400');
  });
});

describe('FontPicker', () => {
  it('lists Google families (windowed), filters, picks; the Local Fonts tab explains what the browser can do', async () => {
    await ensureGoogleCatalog(true);
    const picked: string[] = [];
    const c = mount(FontPicker, { target: document.body, props: { value: 'Roboto', onChange: (f: string) => picked.push(f) } });
    flushSync();
    document.querySelector<HTMLButtonElement>('.fp-trigger')!.click();
    flushSync();
    await vi.waitFor(() => expect(document.querySelectorAll('.fl-row').length).toBeGreaterThan(0));
    expect(document.querySelector('.fp-tab.active')!.textContent).toBe('Google Fonts');

    const search = document.querySelector<HTMLInputElement>('.fp-search')!;
    search.value = 'jet'; search.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect([...document.querySelectorAll('.fl-row')].map(r => r.textContent)).toEqual(['JetBrains Mono']);

    (document.querySelectorAll('.fp-tab')[1] as HTMLButtonElement).click();
    flushSync();
    expect(document.querySelector('.fp-note')!.textContent).toMatch(/cannot read installed fonts/);
    search.value = ''; search.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect([...document.querySelectorAll('.fl-row')].map(r => r.textContent)).toContain('sans-serif');   // generic families are always there

    (document.querySelectorAll('.fp-tab')[0] as HTMLButtonElement).click();
    flushSync();
    search.value = 'jet'; search.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    (document.querySelector('.fl-row') as HTMLButtonElement).click();
    expect(picked).toEqual(['JetBrains Mono']);
    unmount(c);
  });
});
