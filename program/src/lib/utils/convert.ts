/**
 * @file "Convert to path" for every shape type (text and groups included).
 */
import type { Shape } from './types';
import { toPathShape } from './shapes';
import { textToPathShape } from './textOutline';
import { FontUnavailable } from '../fonts/outlineFont';

export interface ConvertResult { shape: Shape; changed: boolean; warnings: string[]; }

/** Is there anything left to convert in `s` (a non-path leaf somewhere inside)? */
export function isConvertible(s: Shape): boolean {
  return s.type === 'group' ? s.children.some(isConvertible) : s.type !== 'path' && s.type !== 'image';
}

/**
 * Converts `s` to editable paths, keeping id, name, style and position. Rectangles, ellipses and
 * lines are exact; text uses the font outlines (async: font files are fetched; if the font is not available the text is left as it is, with a warning); a group converts
 * every child and stays a group.
 */
export async function convertToPaths(s: Shape): Promise<ConvertResult> {
  switch (s.type) {
    case 'path': return { shape: s, changed: false, warnings: [] };
    case 'group': {
      const warnings: string[] = [];
      let changed = false;
      const children: Shape[] = [];
      for (const c of s.children) {
        const r = await convertToPaths(c);
        children.push(r.shape); changed ||= r.changed; warnings.push(...r.warnings);
      }
      return { shape: changed ? { ...s, children } : s, changed, warnings };
    }
    case 'text': {
      try {
        const r = await textToPathShape(s);
        if (!r) return { shape: s, changed: false, warnings: ['Empty text was left as it is.'] };
        return { shape: r.shape, changed: true, warnings: r.warnings };
      } catch (e) {
        if (e instanceof FontUnavailable) return { shape: s, changed: false, warnings: [e.message] };   // text stays text
        throw e;
      }
    }
    default: {
      const p = toPathShape(s);
      return { shape: p ?? s, changed: !!p, warnings: [] };
    }
  }
}
