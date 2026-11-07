/**
 * @file What font families exist right now (plain data, no network, no stores).
 */
import type { LocalFace } from './local';

// ── Google families ───────────────────────────────────────────────────────────
let google = new Map<string, string>();                  // lower-case → canonical name

export function setGoogleFamilies(names: readonly string[]) {
  google = new Map(names.map(n => [n.toLowerCase(), n]));
}
export const googleLoaded = () => google.size > 0;
/** Canonical Google name for a family (case-insensitive), or undefined. */
export const googleName = (family: string) => google.get(family.trim().toLowerCase());

// ── local families ───────────────────────────────────────────────────────────
let faces = new Map<string, LocalFace[]>();             // canonical family → faces
let names = new Map<string, string>();                   // lower-case → canonical
let files = false;

/** Full access: every installed face, with its data handle. */
export function setLocalFaces(list: readonly LocalFace[]) {
  faces = new Map();
  for (const f of list) {
    const a = faces.get(f.family); if (a) a.push(f); else faces.set(f.family, [f]);
  }
  names = new Map([...faces.keys()].map(n => [n.toLowerCase(), n]));
  files = true;
}
/** Detection only: family names without font files. */
export function setLocalFamilies(list: readonly string[]) {
  faces = new Map(); names = new Map(list.map(n => [n.toLowerCase(), n])); files = false;
}
export const localName = (family: string) => names.get(family.trim().toLowerCase());
export const localFacesOf = (family: string): LocalFace[] => faces.get(localName(family) ?? '') ?? [];
export const localHasFiles = () => files;
export const localFamilyList = () => [...names.values()].sort((a, b) => a.localeCompare(b));
