/**
 * @file UI state that is not part of the document: the tool, the selection, defaults for new shapes, panels, grid and snapping.
 */
import { writable, get } from 'svelte/store';
import type { ToolType, PropertyType, TextProps, LineCap, LineJoin } from '../utils/types';
import { select } from './util';
import { DEFAULT_TEXT_PROPS } from '../utils/text';
import type { DashKind } from '../utils/dash';

export { DEFAULT_TEXT_PROPS };

export const PANEL_MIN_WIDTH = 224;
export const PANEL_MAX_WIDTH = 560;
/** Narrow screens: the panel is a sheet at the bottom; it opens at this height and cannot be made lower. */
export const PANEL_MIN_HEIGHT = 300;
/** …and it always leaves this much of the drawing area above it. */
export const PANEL_HEIGHT_RESERVE = 160;

export interface UiState {
  tool:          ToolType;
  selectedIds:   string[];
  /** Groups that were entered (double-click), outermost first. Selection lives in the innermost one. */
  groupPath:     string[];
  // defaults for NEW shapes
  fill:          string;
  /** Fill for NEW text (black); picking a color while text is selected changes this, not `fill`. */
  textFill:      string;
  stroke:        string;
  strokeWidth:   number;
  strokeLinecap: LineCap;
  strokeLinejoin: LineJoin;
  /** Dash preset for NEW shapes; the actual dasharray is generated from it, the stroke width and cap. */
  dashKind:      DashKind;
  textProps:     TextProps;
  polygonClosed: boolean;
  /** Diameter of the Blob tool's brush, px. */
  blobSize:      number;
  // panels
  property:      PropertyType;
  panelOpen:     boolean;
  /** Width of the property panel in px (resizable by dragging its left edge). */
  panelWidth:    number;
  /** Height of the panel on narrow screens, px (resizable by dragging its top edge). */
  panelHeight:   number;
  /** Geometry panel: changing W or H keeps the proportions (the chain button). */
  keepAspect:    boolean;
  /** Virtual Shift key (touch screens): constrain proportions / 45° angles, add to selection. */
  shiftLock:     boolean;
  // grid / snap
  gridEnabled:   boolean;
  gridSizeX:     number;
  gridSizeY:     number;
  snapEnabled:   boolean;
  /** Snap to other objects, the canvas and ruler guides (magenta lines show what it snapped to). */
  snapObjects:   boolean;
  /** Show the ruler guides. */
  guidesVisible: boolean;
}

export const DEFAULT_UI: UiState = {
  tool: 'transform', selectedIds: [], groupPath: [],
  fill: '#aaaaaa', textFill: '#000000', stroke: '#000000', strokeWidth: 2,
  strokeLinecap: 'round', strokeLinejoin: 'round', dashKind: 'solid',
  textProps: { ...DEFAULT_TEXT_PROPS }, polygonClosed: true, blobSize: 16,
  property: '', panelOpen: false, panelWidth: 224, panelHeight: PANEL_MIN_HEIGHT, keepAspect: false, shiftLock: false,
  gridEnabled: false, gridSizeX: 20, gridSizeY: 20, snapEnabled: false,
  snapObjects: false, guidesVisible: true,
};

// ── Preferences: the part of the UI state that is remembered between sessions (this browser only) ──────────
// How the user likes to work, not what they drew: so it is kept in localStorage, not in the project file. A file
// opened on another computer looks the same; only the grid, snapping and panel sizes follow the person.
const PREFS_KEY = 'svge.preferences.v1';
export const PREF_KEYS = [
  'gridEnabled', 'gridSizeX', 'gridSizeY', 'snapEnabled', 'snapObjects', 'guidesVisible',
  'panelWidth', 'panelHeight', 'keepAspect', 'blobSize', 'polygonClosed',
] as const satisfies ReadonlyArray<keyof UiState>;
type Prefs = Pick<UiState, typeof PREF_KEYS[number]>;

/** Stored preferences → a valid patch (unknown keys, wrong types and absurd numbers are dropped). */
export function sanitizePrefs(raw: unknown): Partial<Prefs> {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>, out: Partial<Prefs> = {};
  const num = (k: keyof Prefs, lo: number, hi: number) => {
    const v = r[k];
    if (typeof v === 'number' && Number.isFinite(v)) (out as Record<string, number>)[k] = Math.min(hi, Math.max(lo, v));
  };
  const bool = (k: keyof Prefs) => { if (typeof r[k] === 'boolean') (out as Record<string, boolean>)[k] = r[k] as boolean; };
  (['gridEnabled', 'snapEnabled', 'snapObjects', 'guidesVisible', 'keepAspect', 'polygonClosed'] as const).forEach(bool);
  num('gridSizeX', 1, 1000); num('gridSizeY', 1, 1000);
  num('panelWidth', PANEL_MIN_WIDTH, PANEL_MAX_WIDTH); num('panelHeight', PANEL_MIN_HEIGHT, 4000);
  num('blobSize', 1, 200);
  return out;
}
function loadPrefs(): Partial<Prefs> {
  try { return sanitizePrefs(JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null')); } catch { return {}; }
}
const prefsOf = (s: UiState) => JSON.stringify(Object.fromEntries(PREF_KEYS.map(k => [k, s[k]])));

const store = writable<UiState>({ ...DEFAULT_UI, ...loadPrefs() });
let savedPrefs = prefsOf(get(store));
store.subscribe(s => {                         // the UI state changes all the time (selection): write only real changes
  const p = prefsOf(s);
  if (p === savedPrefs) return;
  savedPrefs = p;
  try { localStorage.setItem(PREFS_KEY, p); } catch { /* storage blocked: kept for this session */ }
});

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

export const ui = {
  subscribe: store.subscribe,
  get: () => get(store),
  set: (patch: Partial<UiState>) => store.update(s => ({ ...s, ...patch })),

  selectTool: (tool: ToolType) => store.update(s => ({ ...s, tool })),
  setSelection: (ids: string[]) => store.update(s => sameIds(s.selectedIds, ids) ? s : { ...s, selectedIds: ids }),
  /** Selection together with the group level it lives in (one update, so nothing sees a half state). */
  setSelectionIn: (ids: string[], groupPath: string[]) =>
    store.update(s => sameIds(s.selectedIds, ids) && sameIds(s.groupPath, groupPath) ? s : { ...s, selectedIds: ids, groupPath }),

  selectProperty: (property: PropertyType) =>
    store.update(s => ({ ...s, property, panelOpen: s.property !== property || !s.panelOpen })),
  setPanelOpen: (panelOpen: boolean) => store.update(s => ({ ...s, panelOpen })),
  setPanelWidth: (w: number) => store.update(s => ({ ...s, panelWidth: Math.round(Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, w))) })),
  /** `max`: the tallest the sheet may get on this screen (window height minus the bars and the reserve). */
  setPanelHeight: (h: number, max: number) =>
    store.update(s => ({ ...s, panelHeight: Math.round(Math.max(PANEL_MIN_HEIGHT, Math.min(max, h))) })),

  setTextDefault<K extends keyof TextProps>(key: K, value: TextProps[K]) {
    store.update(s => ({ ...s, textProps: { ...s.textProps, [key]: value } }));
  },
};

export const tool        = select(ui, s => s.tool);
export const selectedIds = select(ui, s => s.selectedIds);
export const groupPath   = select(ui, s => s.groupPath);
