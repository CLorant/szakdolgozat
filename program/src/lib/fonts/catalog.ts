/**
 * @file The list of Google Fonts family names (for the picker and for "is this a Google font?").
 */

import { fetchJson } from './net';

export const CATALOG_URL = 'https://cdn.jsdelivr.net/gh/hasinhayder/google-fonts/fonts.json';

const CACHE_KEY = 'svge.googleFontCatalog.v1';
export const CATALOG_TTL_MS = 7 * 24 * 3600 * 1000;       // the catalog changes a few times a year

/** Any of the known response shapes → sorted, de-duplicated family names. */
export function parseCatalog(json: unknown): string[] {
  const list: unknown =
    Array.isArray(json) ? json :
    Array.isArray((json as any)?.fonts) ? (json as any).fonts :
    Array.isArray((json as any)?.items) ? (json as any).items : null;
  if (!list) throw new Error('Unexpected font catalog format.');
  const names = (list as unknown[])
    .map(x => (typeof x === 'string' ? x : (x as any)?.family))
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map(x => x.trim());
  if (!names.length) throw new Error('The font catalog is empty.');
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

interface Cached { at: number; names: string[]; }

function readCache(): Cached | null {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(CACHE_KEY) : null;
    if (!raw) return null;
    const c = JSON.parse(raw) as Cached;
    return typeof c?.at === 'number' && Array.isArray(c.names) && c.names.length ? c : null;
  } catch { return null; }
}
function writeCache(names: string[]) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), names } satisfies Cached)); } catch { /* private mode / quota */ }
}
export const clearCatalogCache = () => { try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ } };

export interface CatalogResult { names: string[]; /** true = served from an expired cache because the network failed. */ stale: boolean; }

let inflight: Promise<CatalogResult> | null = null;

/**
 * Fresh cache → no request. Otherwise fetch; if that fails an expired cache is still better than
 * nothing (offline). Concurrent callers share one request.
 */
export function loadCatalog(force = false): Promise<CatalogResult> {
  if (inflight) return inflight;
  const cached = readCache();
  if (!force && cached && Date.now() - cached.at < CATALOG_TTL_MS) return Promise.resolve({ names: cached.names, stale: false });
  inflight = (async () => {
    try {
      const names = parseCatalog(await fetchJson(CATALOG_URL));
      writeCache(names);
      return { names, stale: false };
    } catch (e) {
      if (cached) return { names: cached.names, stale: true };
      throw e;
    } finally { inflight = null; }
  })();
  return inflight;
}
