// @vitest-environment jsdom
// Random action sequences keep the document valid.
//
// Fuzz / random-action tests.
//
// A seeded PRNG drives thousands of random editor actions and tool gestures. After every
// step cheap invariants are checked; every few steps (and at the end) the expensive ones
// (save/load round trips, undo-all). On failure the error names the SEED and prints the
// last actions, so the failure can be replayed exactly:
//
//     FUZZ_SEED=1234 npm test -- fuzz            replay one seed
//     FUZZ_SEEDS=300 FUZZ_STEPS=400 npm test -- fuzz     a longer soak run

import { describe, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { createTools } from '../../src/lib/tools';
import type { PointerInfo, Tool } from '../../src/lib/tools';
import { editor, selectedShapes } from '../../src/lib/stores/editor';
import { documentStore, historyPast, canUndo, canRedo, HISTORY_LIMIT } from '../../src/lib/stores/document';
import { ui } from '../../src/lib/stores/ui';
import { textEdit } from '../../src/lib/stores/interaction';
import {
  makeRect, makeEllipse, makeLine, makePath, makeText, getWorldBounds, getEditNodes, getRotationOrigin, setShapeSize,
  setTextContent, toggleNodeSmooth, deleteNodeAt, insertNodeNear, ungroupShape,
} from '../../src/lib/utils/shapes';
import { walk, leaves, containerAt, maxDepth, MAX_GROUP_DEPTH, pathTo } from '../../src/lib/utils/tree';
import { DASH_KINDS } from '../../src/lib/utils/dash';
import { corner, contours } from '../../src/lib/utils/path';
import { rotatePoint } from '../../src/lib/utils/math';
import { DEFAULT_TEXT_PROPS } from '../../src/lib/utils/text';
import { serializeProject, parseProject } from '../../src/lib/utils/project';
import { buildSvgDocument } from '../../src/lib/utils/serializer';
import { importSvg } from '../../src/lib/utils/svgImport';
import type { Shape, DocumentState, ToolType } from '../../src/lib/utils/types';

// ── seeded PRNG ──────────────────────────────────────────────────────────────

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Rng {
  private next: () => number;
  constructor(seed: number) { this.next = mulberry32(seed); }
  float(a = 0, b = 1) { return a + (b - a) * this.next(); }
  int(a: number, b: number) { return Math.floor(this.float(a, b + 1)); }
  chance(p: number) { return this.next() < p; }
  pick<T>(list: readonly T[]): T { return list[this.int(0, list.length - 1)]; }
  hex() { return '#' + this.int(0, 0xffffff).toString(16).padStart(6, '0'); }
}

// ── helpers ──────────────────────────────────────────────────────────────────

// A long-lived subscriber, like `$selectedShapes` in the mounted Canvas / panels. Catches stores that
// stop updating after some sequence of events (the stale selection box bug, B-02/B-05/B-06).
let liveSelection: readonly Shape[] = [];
selectedShapes.subscribe(v => { liveSelection = v; });

const ctx = { zoom: () => 1, openText: vi.fn() };
const tools = createTools(ctx);
const toolNames = Object.keys(tools) as ToolType[];

const tgt = (attrs: Record<string, string>) => ({
  closest: (sel: string) => {
    const k = /^\[(.+)\]$/.exec(sel)![1];
    return k in attrs ? { getAttribute: () => attrs[k] } : null;
  },
}) as unknown as Element;

const ptr = (x: number, y: number, rng: Rng, target: Element | null = null): PointerInfo => ({
  p: { x, y }, raw: { x, y }, shift: rng.chance(0.2), alt: rng.chance(0.1), ctrl: rng.chance(0.1), target,
});

const STYLE = { fill: '#336699', stroke: '#000000', strokeWidth: 2 };
const HANDLES = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
// (empty text is never committed by the UI — the text editor drops it — so the fuzzer doesn't create it)
const TEXTS = ['a', 'Hello', 'two\nlines', '  spaced  out  ', 'a < b & c', 'x\n\ny', 'ő ű ü ö 日本語'];
const FONTS = [DEFAULT_TEXT_PROPS.fontFamily, 'JetBrains Mono', 'Source Sans 3', 'Roboto'];   // web fonts add an @import to exported SVGs
const KEYS = ['Delete', 'Backspace', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab', 'a', 'Escape'];
const shapes = () => documentStore.get().shapes;

/** Finds the first non-finite number (or negative size) in a value; returns its path. */
function badNumber(v: unknown, path = ''): string | null {
  if (typeof v === 'number') return Number.isFinite(v) ? null : `${path} = ${v}`;
  if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) { const r = badNumber(v[i], `${path}[${i}]`); if (r) return r; } }
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      if (k === 'bgImage') continue;
      const r = badNumber(x, `${path}.${k}`); if (r) return r;
    }
  }
  return null;
}

// ── actions ──────────────────────────────────────────────────────────────────

type Action = { name: string; weight: number; run: (rng: Rng) => string | Promise<string> };

const randomShape = (rng: Rng): Shape => {
  const x = rng.float(0, 700), y = rng.float(0, 500);
  switch (rng.int(0, 5)) {
    case 0: return makeRect(x, y, rng.float(0, 200), rng.float(0, 200), STYLE);
    case 1: return makeEllipse(x, y, rng.float(0, 100), rng.float(0, 100), STYLE);
    case 2: return makeLine({ x, y }, { x: rng.float(0, 800), y: rng.float(0, 600) }, STYLE);
    case 3: return makeText(x, y, rng.pick(TEXTS), { ...DEFAULT_TEXT_PROPS, fontSize: rng.int(4, 120), fontFamily: rng.pick(FONTS) }, STYLE);
    default: {
      const n = rng.int(2, 6);
      const nodes = Array.from({ length: n }, () => {
        const c = corner(rng.float(0, 800), rng.float(0, 600));
        return rng.chance(0.5) ? { ...c, hout: { x: c.x + rng.float(-50, 50), y: c.y + rng.float(-50, 50) }, smooth: rng.chance(0.5) } : c;
      });
      return makePath(nodes, rng.chance(0.5), STYLE);
    }
  }
};

/** Every shape of the tree (groups and leaves, any depth). */
const allShapes = (): Shape[] => { const out: Shape[] = []; walk(shapes(), s => out.push(s)); return out; };
const pickShape = (rng: Rng): Shape | null => { const all = allShapes(); return all.length ? rng.pick(all) : null; };
const pickLeaf = (rng: Rng, type?: string): Shape | null => {
  const l = leaves(shapes()).filter(s => !type || s.type === type);
  return l.length ? rng.pick(l) : null;
};
const pos = (rng: Rng) => [rng.float(-50, 850), rng.float(-50, 650)] as const;

/** A complete pointer gesture with the given tool. */
function gesture(rng: Rng, name: ToolType, target: () => Element | null): string {
  const t: Tool = tools[name];
  const [x0, y0] = pos(rng);
  const tg = target();
  t.down(ptr(x0, y0, rng, tg));
  const moves = rng.int(0, 8);
  let x = x0, y = y0;
  for (let i = 0; i < moves; i++) {
    x += rng.float(-60, 60); y += rng.float(-60, 60);
    t.move(ptr(x, y, rng, tg));
  }
  t.up(ptr(x, y, rng, tg));
  return `${name} drag (${x0.toFixed(1)},${y0.toFixed(1)})→(${x.toFixed(1)},${y.toFixed(1)}) x${moves}${tg ? ' [target]' : ''}`;
}

const ACTIONS: Action[] = [
  // creation
  { name: 'addShape', weight: 6, run: rng => { const s = randomShape(rng); editor.addShape(s); return `addShape ${s.type}`; } },
  ...(['line', 'rectangle', 'ellipse', 'freehand'] as ToolType[]).map((n): Action => ({
    name: `draw:${n}`, weight: 4, run: rng => gesture(rng, n, () => null),
  })),
  { name: 'draw:polygon', weight: 2, run: rng => {
    const t = tools.polygon; const n = rng.int(1, 6);
    for (let i = 0; i < n; i++) { const [x, y] = pos(rng); t.down(ptr(x, y, rng)); t.up(ptr(x, y, rng)); }
    const [x, y] = pos(rng);
    if (rng.chance(0.5)) t.dblclick?.(ptr(x, y, rng)); else t.escape();
    return `draw:polygon ${n} clicks`;
  } },
  { name: 'draw:pen', weight: 2, run: rng => {
    const t = tools.pen; const n = rng.int(1, 5);
    for (let i = 0; i < n; i++) {
      const [x, y] = pos(rng);
      t.down(ptr(x, y, rng)); t.move(ptr(x + rng.float(-40, 40), y + rng.float(-40, 40), rng)); t.up(ptr(x, y, rng));
    }
    if (rng.chance(0.5)) { const [x, y] = pos(rng); t.dblclick?.(ptr(x, y, rng)); } else t.escape();
    return `draw:pen ${n} points`;
  } },
  { name: 'draw:text', weight: 2, run: rng => {
    const [x, y] = pos(rng);
    tools.text.down(ptr(x, y, rng)); tools.text.up(ptr(x, y, rng));
    const st = get(textEdit);
    if (st && rng.chance(0.7)) editor.addShape({ ...st.shape, content: rng.pick(TEXTS) });
    textEdit.set(null);
    return 'draw:text';
  } },

  // select-tool gestures
  { name: 'select:click/move', weight: 8, run: rng => {
    const s = pickShape(rng);
    return 'select ' + gesture(rng, 'transform', () => s && rng.chance(0.85) ? tgt({ 'data-shape-id': s.id }) : null);
  } },
  { name: 'select:resize', weight: 6, run: rng => {
    const s = pickShape(rng); if (!s) return 'resize (no shapes)';
    editor.selectDeep(s.id);
    const h = rng.pick(HANDLES);
    return `resize ${h} ` + gesture(rng, 'transform', () => tgt({ 'data-handle': h }));
  } },
  { name: 'select:rotate', weight: 4, run: rng => {
    const s = pickShape(rng); if (!s) return 'rotate (no shapes)';
    editor.selectDeep(s.id);
    return 'rotate ' + gesture(rng, 'transform', () => tgt({ 'data-rotate': '' }));
  } },
  { name: 'select:key', weight: 3, run: rng => {
    const k = rng.pick(KEYS);
    tools.transform.key?.({ key: k, shiftKey: rng.chance(0.3), ctrlKey: false, metaKey: false });
    return `select key ${k}`;
  } },

  // edit-tool gestures
  { name: 'edit:node', weight: 6, run: rng => {
    const s = pickLeaf(rng, 'path'); if (!s) return 'edit (no paths)';
    editor.selectDeep(s.id);
    const nodes = getEditNodes(s);
    const n = rng.pick(nodes);
    const t = tools.edit;
    t.down(ptr(n.x, n.y, rng, tgt({ 'data-node': n.id, 'data-shape-id': s.id })));
    const [x, y] = pos(rng);
    t.move(ptr(x, y, rng)); t.up(ptr(x, y, rng));
    if (rng.chance(0.3)) t.dblclick?.(ptr(n.x, n.y, rng, tgt({ 'data-node': n.id, 'data-shape-id': s.id })));
    return `edit node ${n.id} of ${s.id}`;
  } },
  { name: 'edit:insert', weight: 2, run: rng => {
    const s = pickLeaf(rng, 'path'); if (!s) return 'edit insert (no paths)';
    editor.selectDeep(s.id);
    const [x, y] = pos(rng);
    tools.edit.dblclick?.(ptr(x, y, rng, tgt({ 'data-shape-id': s.id })));
    return 'edit dblclick on path';
  } },
  { name: 'edit:key', weight: 2, run: rng => {
    const k = rng.pick(KEYS);
    tools.edit.key?.({ key: k, shiftKey: false, ctrlKey: false, metaKey: false });
    return `edit key ${k}`;
  } },

  // selection
  { name: 'selectRandom', weight: 4, run: rng => {
    const level = containerAt(shapes(), ui.get().groupPath) ?? shapes();
    const ids = level.filter(() => rng.chance(0.4)).map(s => s.id);
    editor.select(ids); return `select ${ids.length}`;
  } },
  { name: 'selectAll', weight: 1, run: () => { editor.selectAll(); return 'selectAll'; } },
  { name: 'deselect', weight: 1, run: () => { editor.deselectAll(); return 'deselect'; } },
  { name: 'toggleSelect', weight: 1, run: rng => {
    const level = containerAt(shapes(), ui.get().groupPath) ?? shapes();
    if (level.length) editor.toggleSelect(rng.pick(level).id);
    return 'toggleSelect';
  } },

  // groups
  { name: 'group', weight: 4, run: rng => {
    const level = containerAt(shapes(), ui.get().groupPath) ?? shapes();
    editor.select(level.filter(() => rng.chance(0.5)).map(s => s.id));
    editor.group(); return 'group';
  } },
  { name: 'ungroup', weight: 2, run: () => { editor.ungroup(); return 'ungroup'; } },
  { name: 'selectDeep', weight: 3, run: rng => {
    const s = pickShape(rng); if (!s) return 'selectDeep (none)';
    editor.selectDeep(s.id, rng.chance(0.3)); return `selectDeep ${s.type}`;
  } },
  { name: 'enterGroup', weight: 2, run: rng => {
    const g = allShapes().filter(s => s.type === 'group');
    if (!g.length) return 'enterGroup (none)';
    const pick = rng.pick(g);
    if (!pathTo(shapes(), pick.id)) return 'enterGroup (gone)';
    // enterGroup is only meant for groups of the CURRENT level (the select tool guarantees it); mimic that
    const level = containerAt(shapes(), ui.get().groupPath) ?? shapes();
    const here = level.filter(s => s.type === 'group');
    if (!here.length) return 'enterGroup (none here)';
    const h = rng.pick(here); editor.enterGroup(h.id); return 'enterGroup';
  } },
  { name: 'exitGroup', weight: 2, run: () => { editor.exitGroup(); return 'exitGroup'; } },
  { name: 'select:dblclick', weight: 3, run: rng => {
    const s = pickLeaf(rng); if (!s) return 'dblclick (none)';
    const [x, y] = pos(rng);
    tools.transform.dblclick?.(ptr(x, y, rng, tgt({ 'data-shape-id': s.id }))); return 'select dblclick';
  } },

  // editor actions
  { name: 'delete', weight: 3, run: () => { editor.deleteSelected(); return 'deleteSelected'; } },
  { name: 'copy', weight: 1, run: () => { editor.copy(); return 'copy'; } },
  { name: 'cut', weight: 1, run: () => { editor.cut(); return 'cut'; } },
  { name: 'paste', weight: 2, run: () => { editor.paste(); return 'paste'; } },
  { name: 'duplicate', weight: 2, run: () => { editor.duplicate(); return 'duplicate'; } },
  { name: 'zorder', weight: 3, run: rng => {
    const f = rng.pick(['bringToFront', 'sendToBack', 'moveUp', 'moveDown'] as const);
    editor[f](); return f;
  } },
  { name: 'flip', weight: 2, run: rng => { const a = rng.pick(['h', 'v'] as const); editor.flip(a); return `flip ${a}`; } },
  { name: 'align', weight: 2, run: rng => {
    const a = rng.pick(['left', 'center', 'right', 'top', 'middle', 'bottom'] as const); editor.align(a); return `align ${a}`;
  } },
  { name: 'nudge', weight: 2, run: rng => { const dx = rng.int(-10, 10), dy = rng.int(-10, 10); editor.nudge(dx, dy); return `nudge ${dx},${dy}`; } },
  { name: 'convertToPath', weight: 2, run: async () => { await editor.convertToPath(); return 'convertToPath'; } },
  { name: 'style', weight: 4, run: rng => {
    const k = rng.pick(['fill', 'stroke', 'strokeWidth', 'opacity', 'dash', 'cap', 'join'] as const);
    if (k === 'fill') editor.setStyle({ fill: rng.chance(0.2) ? 'none' : rng.hex() });
    else if (k === 'stroke') editor.setStyle({ stroke: rng.chance(0.2) ? 'none' : rng.hex() });
    else if (k === 'strokeWidth') editor.setStyle({ strokeWidth: rng.pick([0, 0.5, 1, 7, 50]) });
    else if (k === 'opacity') editor.setStyle({ opacity: rng.float(0, 1) });
    else if (k === 'dash') editor.setDashKind(rng.pick(DASH_KINDS));
    else if (k === 'cap') editor.setStyle({ strokeLinecap: rng.pick(['butt', 'round', 'square'] as const) });
    else editor.setStyle({ strokeLinejoin: rng.pick(['miter', 'round', 'bevel'] as const) });
    return `style ${k}`;
  } },
  { name: 'textProp', weight: 2, run: rng => {
    const k = rng.pick(['fontSize', 'fontWeight', 'textAnchor', 'letterSpacing'] as const);
    if (k === 'fontSize') editor.setTextProp('fontSize', rng.int(1, 300));
    else if (k === 'fontWeight') editor.setTextProp('fontWeight', rng.pick([400, 700, 300, 550]));
    else if (k === 'textAnchor') editor.setTextProp('textAnchor', rng.pick(['start', 'middle', 'end'] as const));
    else editor.setTextProp('letterSpacing', rng.float(-5, 20));
    return `textProp ${k}`;
  } },
  { name: 'geometry', weight: 3, run: rng => {
    const s = pickShape(rng); if (!s) return 'geometry (no shapes)';
    const w = rng.chance(0.2) ? null : rng.float(0, 400), h = rng.chance(0.2) ? null : rng.float(0, 400);
    editor.replaceShape(setShapeSize(s, w, h), 'Resize');
    return `setShapeSize ${s.type} ${w?.toFixed(1)}x${h?.toFixed(1)}`;
  } },
  { name: 'textContent', weight: 2, run: rng => {
    const s = pickLeaf(rng, 'text'); if (!s || s.type !== 'text') return 'textContent (none)';
    const c = rng.pick(TEXTS);
    editor.replaceShape(setTextContent(s, c), 'Edit text'); return `textContent ${JSON.stringify(c)}`;
  } },
  { name: 'nodeOps', weight: 3, run: rng => {
    const s = pickLeaf(rng, 'path'); if (!s || s.type !== 'path') return 'nodeOps (none)';
    const op = rng.pick(['smooth', 'delete', 'insert'] as const);
    const i = rng.int(0, s.nodes.length - 1);
    if (op === 'smooth') editor.replaceShape(toggleNodeSmooth(s, i), 'Toggle node');
    else if (op === 'delete') editor.replaceShape(deleteNodeAt(s, i), 'Delete node');
    else { const r = insertNodeNear(s, { x: s.nodes[i].x + 1, y: s.nodes[i].y + 1 }, 50); if (r) editor.replaceShape(r.shape, 'Insert node'); }
    return `nodeOps ${op} ${i}`;
  } },
  { name: 'rename/visible', weight: 2, run: rng => {
    const s = pickShape(rng); if (!s) return 'rename (none)';
    if (rng.chance(0.5)) editor.rename(s.id, rng.pick(['', 'a', 'Layer <1>'])); else editor.setVisible(s.id, rng.chance(0.5));
    return 'rename/visible';
  } },
  { name: 'canvas', weight: 2, run: rng => {
    const k = rng.int(0, 1);
    if (k) editor.setBackground(rng.pick(['white', 'black', 'transparent-light', 'transparent-dark'] as const));
    else editor.setCanvasSize(rng.int(1, 2000), rng.int(1, 2000));
    return 'canvas';
  } },
  { name: 'undo', weight: 4, run: () => { editor.undo(); return 'undo'; } },
  { name: 'redo', weight: 3, run: () => { editor.redo(); return 'redo'; } },
  { name: 'goTo', weight: 1, run: rng => {
    const n = get(historyPast).length; documentStore.goTo(rng.int(0, n + 2)); return 'goTo';
  } },
  { name: 'switchTool', weight: 1, run: rng => {
    const t = rng.pick(toolNames); editor.selectTool(t); return `selectTool ${t}`;
  } },
];

const TOTAL_WEIGHT = ACTIONS.reduce((n, a) => n + a.weight, 0);
function pickAction(rng: Rng): Action {
  let r = rng.float(0, TOTAL_WEIGHT);
  for (const a of ACTIONS) { if ((r -= a.weight) < 0) return a; }
  return ACTIONS[0];
}

// ── invariants ───────────────────────────────────────────────────────────────

function cheapInvariants() {
  const doc = documentStore.get();
  const bad = badNumber(doc);
  if (bad) throw new Error(`non-finite number in document: ${bad}`);

  const all: Shape[] = [];
  walk(doc.shapes, s => all.push(s));
  const ids = all.map(s => s.id);
  if (new Set(ids).size !== ids.length) throw new Error('duplicate shape ids');
  if (maxDepth(doc.shapes) > MAX_GROUP_DEPTH) throw new Error(`groups nested deeper than ${MAX_GROUP_DEPTH}`);
  for (const s of all) if (s.type === 'group' && !s.children.length) throw new Error(`empty group ${s.id}`);

  // the entered group path must exist, and the selection must live in exactly that level
  const gp = ui.get().groupPath;
  const level = containerAt(doc.shapes, gp);
  if (!level) throw new Error(`entered group path no longer exists: ${gp.join(' > ')}`);
  const alive = new Set(level.map(s => s.id));
  const missing = ui.get().selectedIds.filter(id => !alive.has(id));
  if (missing.length) throw new Error(`selection holds ids that are not in the current level: ${missing.join(', ')}`);

  const expectedSel = level.filter(s => ui.get().selectedIds.includes(s.id));
  if (liveSelection.length !== expectedSel.length || liveSelection.some((s, i) => s !== expectedSel[i])) {
    throw new Error('selectedShapes (long-lived subscriber) is out of sync with the document and selection');
  }

  if (get(historyPast).length > HISTORY_LIMIT) throw new Error('history cap exceeded');
  if (documentStore.isPreviewing()) throw new Error('a drag preview is still open after the gesture ended');
  if (get(canUndo) !== get(historyPast).length > 0) throw new Error('canUndo out of sync');

  for (const s of all) {
    const b = getWorldBounds(s);
    const bb = badNumber(b);
    if (bb) throw new Error(`bad bounds for ${s.type} ${s.id}: ${bb}`);
    if (b.width < 0 || b.height < 0) throw new Error(`negative bounds for ${s.type} ${s.id}`);
    if (s.type === 'rectangle' && (s.width < 0 || s.height < 0)) throw new Error(`negative rect size ${s.id}`);
    if (s.type === 'ellipse' && (s.rx < 0 || s.ry < 0)) throw new Error(`negative ellipse radius ${s.id}`);
    if (s.type === 'path' && s.nodes.length < 2) throw new Error(`path ${s.id} has ${s.nodes.length} node(s)`);
  }
}

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

function sameWorldBounds(a: Shape, b: Shape, tol: number): string | null {
  const x = getWorldBounds(a), y = getWorldBounds(b);
  for (const k of ['x', 'y', 'width', 'height'] as const) {
    if (!near(x[k], y[k], tol)) return `${k}: ${x[k]} vs ${y[k]}`;
  }
  return null;
}

/**
 * Anchor points of a line/path in WORLD coordinates (the importer bakes rotation into them) — as the
 * file will contain them: the exporter writes local coordinates rounded to 0.01, and the importer
 * folds the last node of a closed contour into the first when they are the same point.
 */
function exportedAnchors(s: Shape) {
  const o = getRotationOrigin(s);
  const world = (p: { x: number; y: number }) => rotatePoint(p, o, s.rotation);
  if (s.type !== 'path') return getEditNodes(s).filter(n => n.kind === 'anchor').map(n => world({ x: n.x, y: n.y }));
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const out: { x: number; y: number }[] = [];
  for (const c of contours(s.nodes)) {
    const pts = c.map(world);
    const f = c[0], l = c[c.length - 1];
    if (s.closed && c.length > 1 && !l.hout && !f.hin && r2(f.x) === r2(l.x) && r2(f.y) === r2(l.y)) pts.pop();   // only a STRAIGHT closing side is written as a bare Z
    out.push(...pts);
  }
  return out;
}

function sameAnchors(a: Shape, b: Shape, tol: number): string | null {
  const p = exportedAnchors(a), q = exportedAnchors(b);
  if (p.length !== q.length) return `${p.length} anchors vs ${q.length}`;
  for (let i = 0; i < p.length; i++) {
    if (!near(p[i].x, q[i].x, tol) || !near(p[i].y, q[i].y, tol)) {
      return `anchor ${i}: (${p[i].x}, ${p[i].y}) vs (${q[i].x}, ${q[i].y})`;
    }
  }
  return null;
}

/** Visible leaves in DOCUMENT space: group rotation / opacity / visibility baked in (what is actually drawn). */
function flatten(list: readonly Shape[]): Shape[] {
  return list.filter(s => s.visible).flatMap(s => s.type === 'group' ? flatten(ungroupShape(s)) : [s]);
}
/** SVG does not draw a rectangle / ellipse of size 0, and the exporter rounds sizes to 0.01 — so "drawable" is judged after rounding. */
const r2 = (n: number) => Math.round(n * 100) / 100;
const tinyPath = (s: Shape) => s.type === 'path' && getWorldBounds(s).width < 0.1 && getWorldBounds(s).height < 0.1;   // collapsed to a dot: rounding makes its nodes coincide
const drawable = (s: Shape) =>
  !tinyPath(s) && !((s.type === 'rectangle' && (r2(s.width) <= 0 || r2(s.height) <= 0)) || (s.type === 'ellipse' && (r2(s.rx) <= 0 || r2(s.ry) <= 0)));
/** Groups that the exporter writes: visible and holding at least one visible leaf. */
function exportedGroups(list: readonly Shape[]): number {
  let n = 0;
  for (const s of list) {
    if (!s.visible || s.type !== 'group') continue;
    if (flatten(s.children).filter(drawable).length) n += 1 + exportedGroups(s.children);
  }
  return n;
}
const countGroups = (list: readonly Shape[]) => { let n = 0; walk(list, s => { if (s.type === 'group') n++; }); return n; };
const sameTree = (a: readonly Shape[], b: readonly Shape[], path = ''): string | null => {
  if (a.length !== b.length) return `${path}: ${a.length} vs ${b.length} shapes`;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (x.id !== y.id || x.type !== y.type) return `${path}[${i}] identity changed`;
    if (x.type === 'group' && y.type === 'group') {
      const r = sameTree(x.children, y.children, `${path}[${i}]`); if (r) return r;
      if (Math.abs(x.rotation - y.rotation) > 1e-9 || x.opacity !== y.opacity) return `${path}[${i}] group props changed (rotation ${x.rotation} → ${y.rotation}, opacity ${x.opacity} → ${y.opacity})`;
    } else {
      const d = sameWorldBounds(x, y, 1e-6); if (d) return `${path}[${i}] ${x.type} bounds changed (${d})`;
    }
  }
  return null;
};

function roundTripInvariants() {
  const doc = documentStore.get();

  // project file: tree structure, identity, type and geometry survive; parsing is idempotent
  const text = serializeProject(doc);
  const back = parseProject(text);
  const diff = sameTree(doc.shapes, back.shapes);
  if (diff) throw new Error(`project round trip: ${diff}`);
  if (serializeProject(parseProject(serializeProject(back))) !== serializeProject(back)) throw new Error('project parse is not idempotent');

  // SVG export → import: the same visible leaves in document space, the same number of groups
  const svg = buildSvgDocument(doc as DocumentState);
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (parsed.querySelector('parsererror')) throw new Error(`exported SVG is not well-formed XML: ${parsed.querySelector('parsererror')!.textContent!.slice(0, 160)}`);
  const imp = importSvg(svg);
  const opaque = doc.background === 'white' || doc.background === 'black';
  const gotTree = opaque ? imp.shapes.slice(1) : imp.shapes;
  if (imp.width !== doc.width || imp.height !== doc.height) throw new Error(`svg round trip: canvas ${doc.width}x${doc.height} → ${imp.width}x${imp.height}`);
  const visible = flatten(doc.shapes).filter(drawable);
  const got = flatten(gotTree).filter(drawable);
  if (got.length !== visible.length) {
    throw new Error(`svg round trip: ${visible.length} visible shapes (${visible.map(s => s.type).join(',')}) → ${got.length} (${got.map(s => s.type).join(',')})`);
  }
  if (exportedGroups(doc.shapes) !== countGroups(gotTree)) {
    throw new Error(`svg round trip: ${exportedGroups(doc.shapes)} groups → ${countGroups(gotTree)}`);
  }
  got.forEach((s, i) => {
    const o = visible[i];
    if (s.type !== o.type) throw new Error(`svg round trip: shape ${i} ${o.type} → ${s.type}`);
    if (o.type === 'text') return;                   // text bounds depend on font metrics
    const tol = 0.01 * Math.max(1, getWorldBounds(o).width, getWorldBounds(o).height);
    const d = o.type === 'line' || o.type === 'path' ? sameAnchors(o, s, tol) : sameWorldBounds(o, s, tol);
    if (d) throw new Error(`svg round trip: ${o.type} ${o.id} geometry changed (${d})`);
  });
}

/** Undo everything → initial doc; redo everything → same doc as before. */
function historyInvariants(initial: DocumentState, trimmed: boolean) {
  let guard = 0;
  while (get(canRedo) && guard++ < HISTORY_LIMIT + 5) editor.redo();   // start from the newest state
  const before = documentStore.get();
  guard = 0;
  while (get(canUndo) && guard++ < HISTORY_LIMIT + 5) editor.undo();
  if (!trimmed && JSON.stringify(documentStore.get()) !== JSON.stringify(initial)) {
    throw new Error('undoing every action did not return to the initial document');
  }
  guard = 0;
  while (get(canRedo) && guard++ < HISTORY_LIMIT + 5) editor.redo();
  if (documentStore.get() !== before) throw new Error('redoing every undone action did not return to the same document');
  cheapInvariants();
}

// ── runner ───────────────────────────────────────────────────────────────────

function reset() {
  Object.values(tools).forEach(t => t.deactivate());
  textEdit.set(null);
  ctx.openText.mockClear();
  // make the module-level clipboard identical for every run
  editor.newDocument();
  editor.addShape(makeRect(0, 0, 10, 10, STYLE));
  editor.copy();
  editor.newDocument();
  ui.set({ snapEnabled: false, gridEnabled: false, polygonClosed: true, fill: '#336699', stroke: '#000000', strokeWidth: 2, tool: 'transform', dashKind: 'solid' });
}

async function runFuzz(seed: number, steps: number) {
  const rng = new Rng(seed);
  reset();
  const initial = documentStore.get();
  const log: string[] = [];
  let trimmed = false;
  let step = 0;
  const fail = (e: unknown, where: string): never => {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error && e.stack ? '\n' + e.stack.split('\n').slice(1, 6).join('\n') : '';
    throw new Error(
      `FUZZ FAILURE  seed=${seed}  step=${step}/${steps}  (${where})\n  ${msg}${stack}\n` +
      `  last actions:\n${log.slice(-25).map((l, i, a) => `    ${step - a.length + i + 1}. ${l}`).join('\n')}\n` +
      `  replay: FUZZ_SEED=${seed} FUZZ_STEPS=${steps} npm test -- fuzz`);
  };

  for (step = 1; step <= steps; step++) {
    const a = pickAction(rng);
    try {
      log.push(await a.run(rng));
      // tools must never stay stuck mid-gesture
      for (const t of Object.values(tools)) if (t.busy()) { t.escape(); if (t.busy()) throw new Error('a tool is still busy after Escape'); }
      textEdit.set(null);
    } catch (e) { log.push(`${a.name} THREW`); fail(e, `action ${a.name}`); }
    try {
      cheapInvariants();
      if (get(historyPast).length >= HISTORY_LIMIT) trimmed = true;
      if (step % 15 === 0) roundTripInvariants();
    } catch (e) { fail(e, 'invariant'); }
  }
  (globalThis as any).__fuzzStats = ((globalThis as any).__fuzzStats ?? 0) + (maxDepth(documentStore.get().shapes) >= 2 ? 1 : 0);
  try { roundTripInvariants(); historyInvariants(initial, trimmed); } catch (e) { step = steps; fail(e, 'final invariants'); }
}

const ENV: Record<string, string | undefined> = (globalThis as any).process?.env ?? {};
const envInt = (k: string, d: number) => { const v = Number(ENV[k]); return Number.isFinite(v) && v > 0 ? v : d; };

describe('fuzz: random actions keep the document valid', () => {
  const steps = envInt('FUZZ_STEPS', 150);
  if (ENV.FUZZ_SEED) {
    it(`replay seed ${ENV.FUZZ_SEED}`, async () => { await runFuzz(Number(ENV.FUZZ_SEED), steps); });
  } else {
    const n = envInt('FUZZ_SEEDS', 40);
    for (let seed = 1; seed <= n; seed++) {
      it(`seed ${seed} (${steps} steps)`, async () => { await runFuzz(seed, steps); }, 60_000);
    }
  }
});

describe('fuzz: coverage', () => {
  it('groups actually occur in the random runs', () => {
    if (ENV.FUZZ_SEED) return;
    const n = (globalThis as any).__fuzzStats ?? 0;
    if (n < 3) throw new Error(`only ${n} runs ended with nested groups — the fuzzer is not exercising groups`);
  });
});

describe('fuzz: long run past the history cap', () => {
  it('stays valid with more than HISTORY_LIMIT commits', async () => {
    await runFuzz(9001, envInt('FUZZ_LONG_STEPS', 700));
  }, 120_000);
});
