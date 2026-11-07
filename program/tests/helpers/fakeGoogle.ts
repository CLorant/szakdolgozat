// A stand-in for Google Fonts + the catalog, used by the tests (nothing touches the real network).
//   catalog  https://cdn.jsdelivr.net/gh/hasinhayder/google-fonts/fonts.json
//   css      https://fonts.googleapis.com/css2?family=…&text=…
//   files    https://fonts.gstatic.com/s/<slug>/<file>.woff2      (bytes from tests/fixtures/fonts)
//   metadata https://api.fontsource.org/v1/fonts/<id>             (weights / styles / variable)
// Behaviour copied from the real API where it matters: a style the family lacks makes the WHOLE request
// HTTP 400; `text=` answers with ONE block; a plain request answers with one block per script subset
// (each with a unicode-range); variable families answer with the requested weight on the same file.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CATALOG_URL } from '../../src/lib/fonts/catalog';

const dir = resolve(process.cwd(), 'tests', 'fixtures', 'fonts') + '/';
export const fixture = (name: string): ArrayBuffer => {
  const b = readFileSync(dir + name);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

interface FakeFamily {
  statics?: Record<string, string>;              // "<weight>-<italic 0|1>" → file
  variable?: { file: string; min: number; max: number };
  ext?: string;                                   // latin-ext file for the regular style
}
const ROBOTO: FakeFamily = {
  statics: { '400-0': 'roboto-400.woff2', '700-0': 'roboto-700.woff2', '400-1': 'roboto-400-italic.woff2' },
  ext: 'roboto-ext-400.woff2',
};
export const FAKE_FAMILIES: Record<string, FakeFamily> = {
  'Roboto': ROBOTO,
  'JetBrains Mono': ROBOTO,
  'Source Sans 3': ROBOTO,
  'Noto Sans': ROBOTO,
  'Inter': { variable: { file: 'inter-var-wght.woff2', min: 100, max: 900 } },
  'Abril Fatface': { statics: { '400-0': 'roboto-400.woff2' } },      // regular only: bold / italic requests → 400
};
/** Catalog entries that Google lists but this fake cannot serve (→ 400 / not found). */
const UNSERVED = ['Aaa Missing', 'Zzz Missing'];
export const FAKE_CATALOG = [...Object.keys(FAKE_FAMILIES), ...UNSERVED, 'Lobster', 'Open Sans'].sort();

const LATIN = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+20AC, U+2122';
const LATIN_EXT = 'U+0100-02BA, U+02BD-02C5, U+1E00-1EFF, U+2C60-2C7F, U+A720-A7FF';

export interface FakeNet { log: string[]; offline: boolean; failCatalog: boolean; corsHides400: boolean; }
export const net: FakeNet = { log: [], offline: false, failCatalog: false, corsHides400: false };
export const resetNet = () => { net.log.length = 0; net.offline = false; net.failCatalog = false; net.corsHides400 = false; };

const res = (body: BodyInit | null, status = 200, type = 'text/css') =>
  new Response(body, { status, headers: { 'content-type': type } });

interface Wanted { family: string; styles: { weight: number; italic: boolean }[] | null; }

function parseFamilies(u: URL): Wanted[] {
  return u.searchParams.getAll('family').map(spec => {
    const [family, axes] = spec.split(':');
    if (!axes) return { family, styles: null };
    const [tags, tuples] = axes.split('@');
    const names = tags.split(',');
    return {
      family,
      styles: tuples.split(';').map(t => {
        const v = t.split(',').map(Number);
        return { weight: v[names.indexOf('wght')], italic: names.includes('ital') ? v[names.indexOf('ital')] === 1 : false };
      }),
    };
  });
}

const url = (file: string) => `https://fonts.gstatic.com/s/x/${file}`;
const block = (family: string, style: string, weight: string, file: string, range?: string, label?: string) =>
  `${label ? `/* ${label} */\n` : ''}@font-face {\n  font-family: '${family}';\n  font-style: ${style};\n  font-weight: ${weight};\n  font-display: swap;\n`
  + `  src: url(${url(file)}) format('woff2');\n${range ? `  unicode-range: ${range};\n` : ''}}\n`;

function css(u: URL): Response {
  const text = u.searchParams.get('text');
  let out = '';
  for (const w of parseFamilies(u)) {
    const fam = FAKE_FAMILIES[w.family];
    if (!fam) return res('Invalid family', 400);
    const want = w.styles ?? (fam.variable ? [{ weight: 400, italic: false }] : [{ weight: 400, italic: false }]);
    for (const s of want) {
      let file: string, weightText = String(s.weight);
      if (fam.variable) {
        if (s.italic || s.weight < fam.variable.min || s.weight > fam.variable.max) return res('Invalid style', 400);
        file = fam.variable.file;
        if (!w.styles) weightText = `${fam.variable.min} ${fam.variable.max}`;
      } else {
        const f = fam.statics?.[`${s.weight}-${+s.italic}`];
        if (!f) return res('Invalid style', 400);
        file = f;
      }
      const style = s.italic ? 'italic' : 'normal';
      if (text !== null) {
        // text= : one block, the file that has the characters (latin-ext only when nothing but ext letters is asked)
        const onlyExt = [...text].every(c => c === ' ' || (c.codePointAt(0)! >= 0x100 && c.codePointAt(0)! <= 0x24f));
        out += block(w.family, style, weightText, onlyExt && fam.ext && !s.italic && s.weight === 400 ? fam.ext : file);
      } else if (fam.ext && s.weight === 400 && !s.italic) {
        out += block(w.family, style, weightText, fam.ext, LATIN_EXT, 'latin-ext') + block(w.family, style, weightText, file, LATIN, 'latin');
      } else {
        out += block(w.family, style, weightText, file, LATIN, 'latin');
      }
    }
  }
  return res(out);
}

/** The fetch function to hand to setFontFetch(). */
export async function fakeGoogleFetch(input: string): Promise<Response> {
  net.log.push(input);
  if (net.offline) throw new TypeError('Failed to fetch');
  const u = new URL(input);
  if (input === CATALOG_URL) return net.failCatalog ? res('nope', 503) : res(JSON.stringify({ fonts: FAKE_CATALOG }), 200, 'application/json');
  if (u.hostname === 'fonts.googleapis.com') {
    const r = await css(u);
    if (net.corsHides400 && r.status === 400) throw new TypeError('Failed to fetch');   // browsers hide a CORS-less error response
    return r;
  }
  if (u.hostname === 'api.fontsource.org') {
    // Fontsource's per-family metadata (weights, styles, variable), derived from the fake families.
    const id = u.pathname.split('/').pop()!;
    const name = Object.keys(FAKE_FAMILIES).find(n => n.toLowerCase().replace(/[^a-z0-9]+/g, '-') === id);
    if (!name) return res('not found', 404, 'application/json');
    const f = FAKE_FAMILIES[name];
    const weights = f.variable ? Array.from({ length: (f.variable.max - f.variable.min) / 100 + 1 }, (_, i) => f.variable!.min + i * 100)
      : [...new Set(Object.keys(f.statics ?? {}).filter(k => k.endsWith('-0')).map(k => +k.split('-')[0]))];
    const styles = Object.keys(f.statics ?? {}).some(k => k.endsWith('-1')) ? ['normal', 'italic'] : ['normal'];
    return res(JSON.stringify({ id, family: name, weights, styles, variable: !!f.variable, type: 'google' }), 200, 'application/json');
  }
  if (u.hostname === 'fonts.gstatic.com') {
    const file = u.pathname.split('/').pop()!;
    try { return res(fixture(file), 200, 'font/woff2'); } catch { return res('not found', 404); }
  }
  return res('forbidden', 403);
}
