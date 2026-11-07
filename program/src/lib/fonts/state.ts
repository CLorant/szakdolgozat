/**
 * @file Reactive font state (for the picker) + the actions that fill it.
 */
import { registerBundledFonts } from './bundled';
import { writable } from 'svelte/store';
import { loadCatalog } from './catalog';
import { setGoogleFamilies, googleLoaded, setLocalFaces, setLocalFamilies, localFamilyList } from './registry';
import {
  COMMON_FONTS, detectInstalled, localFontsPermission, queryFaces, supportsLocalFonts, type LocalStatus,
} from './local';

export interface CatalogState { status: 'idle' | 'loading' | 'ready' | 'error'; names: string[]; stale: boolean; error?: string; }
export interface SystemState { status: LocalStatus; families: string[]; /** true = font files are readable (outlines possible). */ hasFiles: boolean; error?: string; }

export const googleCatalog = writable<CatalogState>({ status: 'idle', names: [], stale: false });
export const localFonts = writable<SystemState>({
  status: supportsLocalFonts() ? 'idle' : 'unsupported', families: [], hasFiles: false,
});

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

let failedAt = 0;
const COOLDOWN_MS = 30_000;

/** Makes sure the Google catalog is loaded. Resolves to false (never throws) when it cannot be — offline, blocked. */
export async function ensureGoogleCatalog(force = false): Promise<boolean> {
  if (!force && googleLoaded()) return true;
  if (!force && Date.now() - failedAt < COOLDOWN_MS) return false;
  googleCatalog.update(s => ({ ...s, status: 'loading', error: undefined }));
  try {
    const r = await loadCatalog(force);
    setGoogleFamilies(r.names);
    googleCatalog.set({ status: 'ready', names: r.names, stale: r.stale });
    failedAt = 0;
    return true;
  } catch (e) {
    failedAt = Date.now();
    googleCatalog.set({ status: 'error', names: [], stale: false, error: message(e) });
    return false;
  }
}

/**
 * Reads the installed fonts. Must be called from a click handler the FIRST time (the browser asks
 * for permission then); afterwards the grant is remembered.
 */
export async function enableLocalFonts(): Promise<void> {
  if (!supportsLocalFonts()) { useDetection(); return; }
  localFonts.update(s => ({ ...s, status: 'loading', error: undefined }));
  try {
    const faces = await queryFaces();
    setLocalFaces(faces);
    localFonts.set({ status: 'ready', families: localFamilyList(), hasFiles: true });
  } catch (e) {
    const name = (e as any)?.name;
    localFonts.set({
      status: name === 'NotAllowedError' ? 'denied' : 'error', families: [], hasFiles: false,
      error: name === 'NotAllowedError' ? 'Permission to read installed fonts was denied.' : message(e),
    });
  }
}

function useDetection() {
  setLocalFamilies(detectInstalled(COMMON_FONTS));
  localFonts.set({ status: 'unsupported', families: localFamilyList(), hasFiles: false });
}

let started = false;
/** Start-up: catalog from cache / network in the background, local fonts if the user already allowed them. */
export async function initFonts(): Promise<void> {
  if (started) return;
  started = true;
  registerBundledFonts();
  void ensureGoogleCatalog();
  if (!supportsLocalFonts()) { useDetection(); return; }
  if (await localFontsPermission() === 'granted') await enableLocalFonts();
}
