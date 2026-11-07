/**
 * @file CSS generic font families.
 * In an exported SVG the viewer picks the real font for a generic family. The editor itself draws the main ones
 * with bundled fonts (fonts/bundled.ts), so that converting such text to paths gives exactly what is on screen.
 */
export const GENERIC_FAMILIES = [
  'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
] as const;

const SET = new Set<string>([
  ...GENERIC_FAMILIES, 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong',
]);
export const isGeneric = (name: string) => SET.has(name.trim().toLowerCase());

/** Generic families that have no bundled font of their own but a close equivalent. */
const ALIASES: Record<string, string> = {
  'ui-sans-serif': 'sans-serif', 'ui-rounded': 'sans-serif', 'ui-serif': 'serif', 'ui-monospace': 'monospace',
};
const BUNDLED = new Set<string>(GENERIC_FAMILIES);

/** The bundled generic family that draws `name` ('ui-serif' → 'serif'), or null (not generic, or not bundled). */
export function bundledGeneric(name: string): string | null {
  const g = name.trim().toLowerCase();
  const b = ALIASES[g] ?? g;
  return BUNDLED.has(b) ? b : null;
}

/** The font-family name the bundled faces of a generic family are registered under in the editor. */
export const bundledAlias = (generic: string) => `SVGE ${generic}`;

/**
 * The editor's CSS font-family for a generic family: its bundled font first; Comic Neue and Anton cover fewer
 * scripts, so their missing characters come from the bundled sans-serif, as in a text-to-path conversion.
 */
export function editorGenericCss(name: string): string {
  const b = bundledGeneric(name);
  if (!b) return name;
  const extra = b === 'cursive' || b === 'fantasy' ? `, '${bundledAlias('sans-serif')}'` : '';
  return `'${bundledAlias(b)}'${extra}, ${name}`;
}
