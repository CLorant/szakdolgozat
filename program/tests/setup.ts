// Vitest setup. jsdom has no canvas — return null quietly so text measurement
// uses its character-count fallback, instead of printing "Not implemented: getContext" traces.
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
}

// jsdom has no layout, so no ResizeObserver (Svelte's bind:clientHeight uses one): a stub that never reports.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
}

// No test may reach the real network: Google Fonts (catalog, CSS2, font files) is replaced by tests/helpers/fakeGoogle.ts.
import { beforeEach } from 'vitest';
import { setFontFetch } from '../src/lib/fonts/net';
import { fakeGoogleFetch, resetNet } from './helpers/fakeGoogle';

setFontFetch(fakeGoogleFetch);
beforeEach(() => { resetNet(); setFontFetch(fakeGoogleFetch); });

// The bundled generic-family fonts are read from disk (the dev server would serve them by URL).
import { readFile } from 'node:fs/promises';
import { setBundledFontLoader } from '../src/lib/fonts/bundled';
setBundledFontLoader(async file => { const b = await readFile(`src/assets/fonts/${file}`); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; });
