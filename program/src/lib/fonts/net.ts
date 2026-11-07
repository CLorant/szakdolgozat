/**
 * @file The one place font code touches the network. Tests replace the fetch function (setFontFetch).
 */

export class HttpError extends Error {
  constructor(public status: number, public url: string) { super(`HTTP ${status} for ${url}`); }
}

type Fetcher = (url: string) => Promise<Response>;
const real: Fetcher = url => fetch(url);
let current: Fetcher = real;
let probe: Promise<boolean> | null = null, probeAt = 0;

export const setFontFetch = (fn: Fetcher | null) => { current = fn ?? real; probe = null; };

const CSS2 = 'https://fonts.googleapis.com/css2';
/** Can the CSS2 endpoint be reached at all? (cached for a few seconds) */
function googleReachable(): Promise<boolean> {
  if (!probe || Date.now() - probeAt > 5000) {
    probeAt = Date.now();
    probe = current(`${CSS2}?family=Roboto&text=a`).then(r => r.ok, () => false);
  }
  return probe;
}

async function get(url: string): Promise<Response> {
  let res: Response;
  try { res = await current(url); }
  catch (e) {
    // Google answers a request it rejects (e.g. a style the family does not have) with HTTP 400 and NO CORS header, which a
    // browser reports as a network failure — indistinguishable from being offline. If Google is reachable, it was a 400.
    if (e instanceof TypeError && url.startsWith(CSS2) && await googleReachable()) throw new HttpError(400, url);
    throw e;
  }
  if (!res.ok) throw new HttpError(res.status, url);
  return res;
}
export const fetchText = async (url: string) => (await get(url)).text();
export const fetchJson = async (url: string) => (await get(url)).json();
export const fetchBytes = async (url: string) => (await get(url)).arrayBuffer();

/** Memoises an async function by key; a rejected promise is dropped so the next call retries. */
export function memoAsync<A extends unknown[], R>(key: (...a: A) => string, fn: (...a: A) => Promise<R>, max = 200) {
  const cache = new Map<string, Promise<R>>();
  return (...a: A): Promise<R> => {
    const k = key(...a);
    let p = cache.get(k);
    if (!p) {
      p = fn(...a);
      cache.set(k, p);
      p.catch(() => { if (cache.get(k) === p) cache.delete(k); });
      if (cache.size > max) cache.delete(cache.keys().next().value as string);   // oldest first
    }
    return p;
  };
}
