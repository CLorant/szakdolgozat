/**
 * @file Where does a family name come from?
 *
 *   google   → in the Google Fonts catalog: loadable in the editor, embeddable, outlinable
 *   local    → installed on this machine (user allowed access): outlinable when the files are readable
 *   generic  → CSS generic family (sans-serif …): only the browser knows the real font
 *   unknown  → neither (e.g. a project opened on another machine)
 * A name in BOTH lists is treated as Google: that is what the editor renders (a web font wins over an
 * installed one) and it is the only one that is the same on every machine.
 */
import { googleName, googleLoaded, localName } from './registry';
import { ensureGoogleCatalog } from './state';
import { isGeneric } from './generic';

export type FontSource = 'google' | 'local' | 'generic' | 'unknown';

export function sourceOf(family: string): FontSource {
  if (isGeneric(family)) return 'generic';
  if (googleName(family)) return 'google';
  if (localName(family)) return 'local';
  return 'unknown';
}

/** Like sourceOf, but waits for the catalog first (it comes from the local cache after the first visit). */
export async function resolveSource(family: string): Promise<FontSource> {
  if (isGeneric(family)) return 'generic';
  if (!googleLoaded()) await ensureGoogleCatalog();
  return sourceOf(family);
}
