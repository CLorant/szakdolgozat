/**
 * @file Adaptive ruler ticks for any visible range and zoom.
 */

export interface Tick { /** px from the document origin */ pos: number; value: number; major: boolean; label: string | null; }

/** Smallest 1·10ⁿ / 2·10ⁿ / 5·10ⁿ that is ≥ min. */
export function niceStep(min: number): number {
  if (!(min > 0)) return 1;
  const pow = 10 ** Math.floor(Math.log10(min));
  for (const m of [1, 2, 5, 10]) if (m * pow >= min - 1e-12) return m * pow;
  return 10 * pow;
}

/**
 * Ticks covering the document range [startDoc, endDoc] at `zoom`.
 * Labelled (major) ticks are at least `minLabelPx` apart; minor ticks subdivide the major step.
 * Only visible ticks are generated, so scrolling or zooming far never leaves the ruler blank.
 */
export function rulerTicks(startDoc: number, endDoc: number, zoom: number, minLabelPx = 70): Tick[] {
  if (!(zoom > 0) || !(endDoc > startDoc)) return [];
  const major = niceStep(minLabelPx / zoom);
  const lead = Math.round(major / 10 ** Math.floor(Math.log10(major)));
  const div = lead === 2 ? 4 : 5;                       // 1→/5, 2→/4, 5→/5  (always whole units at our zoom range)
  const minor = major / div;
  const first = Math.floor(startDoc / minor), last = Math.ceil(endDoc / minor);
  const out: Tick[] = [];
  for (let i = first; i <= last && out.length < 2000; i++) {
    const value = Math.round(i * minor * 1e6) / 1e6;
    const isMajor = ((i % div) + div) % div === 0;
    out.push({ pos: value * zoom, value, major: isMajor, label: isMajor ? String(value) : null });
  }
  return out;
}
