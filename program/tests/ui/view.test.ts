// @vitest-environment jsdom
// The view: rulers, zoom anchoring, panning, toasts.
import { describe, it, expect, beforeEach } from 'vitest';
import { niceStep, rulerTicks } from '../../src/lib/utils/ruler';
import { anchoredScroll, panBy } from '../../src/lib/utils/zoom';
import { makeRect, makeText, setShapeSize, getLocalBounds, getRotationOrigin, makePath, makeLine, makeImage, mirrorShape, getWorldBounds, toPathShape, shapeTransform } from '../../src/lib/utils/shapes';
import { rotatePoint } from '../../src/lib/utils/math';
import { DEFAULT_TEXT_PROPS, normWeight, decorationLines, toggleDecoration, textBounds, svgFontFamily, cssFontFamily } from '../../src/lib/utils/text';
import { notify, toasts, dismiss } from '../../src/lib/stores/notify';
import { get } from 'svelte/store';
import { cutPathAt } from '../../src/lib/utils/scissors';
import { paintBlob, mergeable } from '../../src/lib/utils/blob';
import { corner, contours, pathBounds } from '../../src/lib/utils/path';
import { buildSvgDocument } from '../../src/lib/utils/serializer';
import { parseProject, serializeProject } from '../../src/lib/utils/project';
import { emptyDocument, documentStore } from '../../src/lib/stores/document';
import { editor } from '../../src/lib/stores/editor';
import { ui } from '../../src/lib/stores/ui';
import { placeImage } from '../../src/lib/utils/imageImport';
import { viewport, CANVAS_PADDING } from '../../src/lib/stores/viewport';
import { nearestWeight, hasRealBold, weightLabel, fontsourceId, fontStyles, UNKNOWN_STYLES } from '../../src/lib/fonts/styles';
import { bundledFamily, bundledStyles } from '../../src/lib/fonts/bundled';
import { outlineText } from '../../src/lib/utils/textOutline';
import { ensureGoogleCatalog } from '../../src/lib/fonts/state';
import type { PathShape, ImageShape, TextShape } from '../../src/lib/utils/types';

const st = { fill: '#fff', stroke: '#000', strokeWidth: 1 };


const square = () => makePath([corner(0, 0), corner(100, 0), corner(100, 100), corner(0, 100)], true, st);
const T = (extra: Record<string, unknown> = {}) => makeText(100, 200, 'Hi there', { ...DEFAULT_TEXT_PROPS, fontSize: 40, ...extra } as any, st);
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';

describe('ruler ticks', () => {
  it('niceStep picks 1/2/5 × 10ⁿ', () => {
    expect([0.3, 1, 1.5, 3, 7, 70, 130, 450, 5001].map(niceStep)).toEqual([0.5, 1, 2, 5, 10, 100, 200, 500, 10000]);
  });
  it('labels are never closer than ~70px, at any zoom', () => {
    for (const z of [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20]) {
      const t = rulerTicks(0, 3000 / z, z).filter(x => x.label !== null);
      for (let i = 1; i < t.length; i++) expect(t[i].pos - t[i - 1].pos).toBeGreaterThanOrEqual(69);
    }
  });
  it('covers ANY visible range (the old ruler went blank after scrolling/zooming far)', () => {
    const t = rulerTicks(50000, 50800, 1);
    expect(t.length).toBeGreaterThan(5);
    expect(t[0].value).toBeLessThanOrEqual(50000); expect(t[t.length - 1].value).toBeGreaterThanOrEqual(50800);
    expect(rulerTicks(-500, -100, 2).length).toBeGreaterThan(3);              // negative (left of the canvas)
  });
  it('major ticks sit on whole multiples; minor ticks are ≥ 12px apart', () => {
    const t = rulerTicks(0, 1000, 1);
    expect(t.filter(x => x.major).map(x => x.value).slice(0, 3)).toEqual([0, 100, 200]);
    for (let i = 1; i < t.length; i++) expect(t[i].pos - t[i - 1].pos).toBeGreaterThanOrEqual(12);
    expect(rulerTicks(0, 0, 1)).toEqual([]);
  });
});

describe('zoom anchoring', () => {
  it('keeps the point under the cursor fixed', () => {
    const pad = 40, z0 = 1, z1 = 2.5, scroll = 120, anchor = 300;
    const docBefore = (scroll + anchor - pad) / z0;
    const s1 = anchoredScroll(scroll, anchor, z0, z1, pad);
    expect((s1 + anchor - pad) / z1).toBeCloseTo(docBefore, 9);
  });
});

describe('toasts', () => {
  it('queues, caps at 4 and dismisses', () => {
    toasts.set([]);
    const ids = Array.from({ length: 6 }, (_, i) => notify('m' + i, 'info', 0));
    expect(get(toasts)).toHaveLength(4);
    dismiss(ids[5]);
    expect(get(toasts)).toHaveLength(3);
  });
});

describe('panning without limits', () => {
  it('the view offset can go anywhere, also past the top-left of the page', () => {
    viewport.setScroll(0, 0);
    panBy(-500, -300);
    expect([viewport.get().scrollLeft, viewport.get().scrollTop]).toEqual([-500, -300]);
    expect(anchoredScroll(-500, 200, 1, 2, CANVAS_PADDING)).toBe((-500 + 200 - CANVAS_PADDING) * 2 + CANVAS_PADDING - 200);
  });
});
