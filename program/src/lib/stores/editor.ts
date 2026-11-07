/**
 * @file The editing actions (select, add, change, group, convert, paste …): every change of the document goes through here.
 *
 * Components call `editor.*` and never touch the stores' internals. Every method is ONE undoable action (or a live drag, see below).
 */

import { derived, get } from 'svelte/store';
import type { Shape, ShapePatch, TextProps, BackgroundType, BgFit, DocumentState, BoundingBox, Point } from '../utils/types';
import {
  translateShape, mirrorShape, getWorldBounds, unionBounds, centerOf, makeGroup, ungroupShape,
} from '../utils/shapes';
import {
  mapTree, removeFromTree, withContainer, updateSiblings, pruneEmpty, containerAt, validGroupPath,
  pathTo, moveInTree, type DropWhere, cloneWithNewIds, mapLeaves, MAX_GROUP_DEPTH, maxDepth, findShape,
} from '../utils/tree';
import { convertToPaths, isConvertible } from '../utils/convert';
import { strokeToPath, hasStroke } from '../utils/strokeToPath';
import { saveSharedClip, loadSharedClip, clipSvg } from '../utils/clipboard';
import { importSvg } from '../utils/svgImport';
import { contentBounds } from '../utils/exportArea';
import { MAX_FONT_SIZE, MIN_FONT_SIZE, normWeight } from '../utils/text';
import { dashFor, reflowDash, type DashKind } from '../utils/dash';
import { notify, notifyError } from './notify';
import { documentStore, shapesStore, emptyDocument } from './document';
import { ui, selectedIds, groupPath } from './ui';
import { leaves, walk } from '../utils/tree';
import { booleanShapes, BOOLEAN_LABEL, type BooleanOp } from '../utils/boolean';

export const MAX_CANVAS = 8000;

export type { AlignAxis as Axis } from '../utils/actionLists';
import type { AlignAxis as Axis } from '../utils/actionLists';

/** The shapes at the level the user is working in (the document, or the innermost entered group). */
export const currentLevel = derived([shapesStore, groupPath], ([shapes, path]) => containerAt(shapes, path) ?? shapes);

// Selected shapes (at the current level), in z-order.
export const selectedShapes = derived([currentLevel, selectedIds], ([level, ids]) => {
  const set = new Set(ids);
  return level.filter(s => set.has(s.id));
});

// Keep group path and selection valid after undo / delete / load.
documentStore.subscribe(d => {
  const u = ui.get();
  if (!u.selectedIds.length && !u.groupPath.length) return;
  const path = validGroupPath(d.shapes, u.groupPath);
  const level = containerAt(d.shapes, path) ?? d.shapes;
  const alive = new Set(level.map(s => s.id));
  const kept = u.selectedIds.filter(id => alive.has(id));
  if (path.length !== u.groupPath.length || kept.length !== u.selectedIds.length) ui.setSelectionIn(kept, path);
});

/** Every shape (any depth) → fn. Same document object when nothing changed. */
const mapShapes = (d: DocumentState, fn: (s: Shape) => Shape): DocumentState => {
  const shapes = mapTree(d.shapes, fn);
  return shapes === d.shapes ? d : { ...d, shapes };
};

const label = (s: Shape) => s.name || s.type[0].toUpperCase() + s.type.slice(1);

let clipboard: Shape[] = [];
/** Context menu → Paste: where the pasted shapes are centred (current level's frame); null = the usual offset. */
let pasteAnchor: Point | null = null;
/** Moves shapes so that their bounds are centred on `p`. */
const centreOn = (shapes: Shape[], p: Point): Shape[] => {
  const b = unionBounds(shapes.map(getWorldBounds));
  return b ? shapes.map(s => translateShape(s, p.x - (b.x + b.width / 2), p.y - (b.y + b.height / 2))) : shapes;
};
let clipboardTime = 0;          // when `clipboard` was copied; a newer copy in another tab wins (see paste)
let pasteCount = 0;

const STYLE_KEYS = new Set(['strokeLinecap', 'strokeLinejoin', 'strokeDasharray', 'stroke', 'strokeWidth']);

/** Insert `shapes` at the end of the level the user is in. */
/** Edit the sibling list of the level the user is in. Same document when nothing changed. */
const editLevel = (d: DocumentState, fn: (level: Shape[]) => Shape[]): DocumentState => {
  const shapes = withContainer(d.shapes, validGroupPath(d.shapes, ui.get().groupPath), fn);
  return shapes === d.shapes ? d : { ...d, shapes };
};
const addToLevel = (d: DocumentState, shapes: Shape[]) => editLevel(d, l => [...l, ...shapes]);

function setOnSelection(what: 'locked' | 'hidden') {
  const ids = new Set(ui.get().selectedIds);
  if (!ids.size) return;
  const n = ids.size > 1 ? ` ${ids.size} shapes` : ' shape';
  documentStore.commit(what === 'locked' ? `Lock${n}` : `Hide${n}`, d => editLevel(d, level => level.map(s =>
    !ids.has(s.id) ? s : what === 'locked' ? ({ ...s, locked: true } as Shape) : ({ ...s, visible: false } as Shape))));
  ui.setSelection([]);
}

export const editor = {
  // ── selection / tools ──────────────────────────────────────────────────────
  selectTool: ui.selectTool,
  /** Back to the top level (selection is dropped). */
  leaveGroups() { if (ui.get().groupPath.length) ui.setSelectionIn([], []); },
  select: (ids: string[]) => ui.setSelection(ids),
  selectOnly: (id: string | null) => ui.setSelection(id ? [id] : []),
  deselectAll: () => ui.setSelection([]),
  selectAll: () => ui.setSelection(get(currentLevel).filter(s => s.visible && !s.locked).map(s => s.id)),
  toggleSelect(id: string) {
    const ids = ui.get().selectedIds;
    ui.setSelection(ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id]);
  },
  /** Select a shape at ANY depth (Layers panel): enters its groups as needed. */
  selectDeep(id: string, additive = false) {
    const path = pathTo(documentStore.get().shapes, id);
    if (!path || path.some(p => findShape(documentStore.get().shapes, p)?.locked)) return;   // locked (or inside a locked group)
    const gp = path.slice(0, -1);
    const u = ui.get();
    const same = gp.length === u.groupPath.length && gp.every((g, i) => g === u.groupPath[i]);
    if (additive && same) editor.toggleSelect(id);
    else ui.setSelectionIn([id], gp);
  },
  enterGroup(id: string, select?: string) {
    const u = ui.get();
    ui.setSelectionIn(select ? [select] : [], [...u.groupPath, id]);
  },
  exitGroup() {
    const u = ui.get();
    if (!u.groupPath.length) return;
    const gid = u.groupPath[u.groupPath.length - 1];
    ui.setSelectionIn([gid], u.groupPath.slice(0, -1));
  },

  // ── create / edit / delete ─────────────────────────────────────────────────
  /** Replaces one shape of the current level by `pieces`, in its place in the stacking order (Scissors). */
  replaceWithPieces(id: string, pieces: Shape[], actionLabel: string) {
    documentStore.commit(actionLabel, d => editLevel(d, level => level.flatMap(s => s.id === id ? pieces : [s])));
    ui.setSelection(pieces.map(p => p.id));
  },
  /** Replaces several shapes of the current level, each by its pieces, as ONE undo step (Scissors with a knife). */
  replaceManyWithPieces(pieces: ReadonlyMap<string, Shape[]>, actionLabel: string) {
    if (!pieces.size) return;
    documentStore.commit(actionLabel, d => editLevel(d, level => level.flatMap(s => pieces.get(s.id) ?? [s])));
    ui.setSelection([...pieces.values()].flat().map(p => p.id));
  },
  /** Adds a painted blob, removing the shapes it absorbed; it takes the place of the topmost of them (Blob tool). */
  addBlob(shape: Shape, merged: readonly string[]) {
    const gone = new Set(merged);
    documentStore.commit(merged.length ? 'Blob (merged)' : 'Blob', d => editLevel(d, level => {
      const top = level.reduce((m, s, i) => gone.has(s.id) ? i : m, -1);
      if (top < 0) return [...level, shape];
      return level.flatMap((s, i) => i === top ? [shape] : gone.has(s.id) ? [] : [s]);
    }));
    ui.setSelection([shape.id]);
  },

  addShape(shape: Shape, actionLabel?: string) { editor.addShapes([shape], actionLabel); },
  addShapes(shapes: Shape[], actionLabel?: string) {
    if (!shapes.length) return;
    documentStore.commit(
      actionLabel ?? (shapes.length === 1 ? `Add ${label(shapes[0]).toLowerCase()}` : `Add ${shapes.length} shapes`),
      d => addToLevel(d, shapes),
    );
    ui.setSelection(shapes.map(s => s.id));
  },

  /** Patch one shape (any depth). Pass `coalesce` for continuous edits (typing, sliders). */
  updateShape(id: string, patch: ShapePatch, opts?: { label?: string; coalesce?: string }) {
    documentStore.commit(
      opts?.label ?? 'Edit shape',
      d => mapShapes(d, s => s.id === id ? ({ ...s, ...patch } as Shape) : s),
      opts?.coalesce ? { coalesce: opts.coalesce } : undefined,
    );
  },

  /** Replace whole shapes (same ids) as one action — e.g. text edits, node insertion. */
  replaceShape(next: Shape, actionLabel = 'Edit shape', coalesce?: string) {
    documentStore.commit(actionLabel, d => mapShapes(d, s => s.id === next.id ? next : s), coalesce ? { coalesce } : undefined);
  },

  /** Several whole shapes at once (Geometry panel with a multi-selection): one action. */
  replaceShapes(next: readonly Shape[], actionLabel = 'Edit shapes', coalesce?: string) {
    const byId = new Map(next.map(s => [s.id, s]));
    documentStore.commit(actionLabel, d => mapShapes(d, s => byId.get(s.id) ?? s), coalesce ? { coalesce } : undefined);
  },

  /**
   * Style change from the property panel: updates the defaults for new shapes AND every
   * selected shape (a group passes the change on to everything inside it). Continuous inputs
   * are coalesced into one history entry.
   */
  setStyle(patch: ShapePatch, actionLabel = 'Change style') {
    const def: Record<string, unknown> = {};
    // A color picked for text (selected text, or the text tool with nothing selected) is the TEXT color default:
    // it must not turn the next rectangle black, nor the next text gray.
    const picked = get(selectedShapes);
    const forText = picked.length ? leaves(picked).every(s => s.type === 'text') : ui.get().tool === 'text';
    if ('fill' in patch) def[forText ? 'textFill' : 'fill'] = patch.fill;
    if ('stroke' in patch) def.stroke = patch.stroke;
    if ('strokeWidth' in patch) def.strokeWidth = patch.strokeWidth;
    if ('strokeLinecap' in patch) def.strokeLinecap = patch.strokeLinecap;
    if ('strokeLinejoin' in patch) def.strokeLinejoin = patch.strokeLinejoin;
    if (Object.keys(def).length) ui.set(def);

    const ids = new Set(ui.get().selectedIds);
    if (!ids.size) return;
    const keys = Object.keys(patch).sort().join(',');
    const applyLeaf = (p: ShapePatch) => (s: Shape): Shape => {
      // Text has no stroke; an image has neither fill nor stroke (only its opacity changes).
      const q = s.type === 'text' ? Object.fromEntries(Object.entries(p).filter(([k]) => !STYLE_KEYS.has(k)))
        : s.type === 'image' ? Object.fromEntries(Object.entries(p).filter(([k]) => k === 'opacity'))
        : p;
      if (!Object.keys(q).length) return s;
      const next = { ...s, ...q } as Shape;
      // The dash pattern follows the stroke: presets are regenerated, other patterns scaled.
      if (s.type !== 'text' && s.strokeDasharray && !('strokeDasharray' in q) && ('strokeWidth' in q || 'strokeLinecap' in q)) {
        next.strokeDasharray = reflowDash(s.strokeDasharray,
          { width: s.strokeWidth, cap: s.strokeLinecap }, { width: next.strokeWidth, cap: next.strokeLinecap });
      }
      return next;
    };
    // Opacity belongs to the group itself (it fades the group as a whole); everything else is passed down.
    const apply = (s: Shape): Shape => {
      if (s.type !== 'group') return applyLeaf(patch)(s);
      const { opacity, ...rest } = patch;
      const g = opacity !== undefined && opacity !== s.opacity ? { ...s, opacity } : s;
      return Object.keys(rest).length ? mapLeaves(g, applyLeaf(rest)) : g;
    };
    documentStore.commit(
      actionLabel,
      d => editLevel(d, level => level.map(s => ids.has(s.id) ? apply(s) : s)),
      { coalesce: `style:${keys}:${[...ids].join(',')}` },
    );
  },

  /**
   * Dash preset for the selection (each shape gets the pattern for ITS stroke width and cap) and
   * for new shapes. 'solid' removes the dash.
   */
  setDashKind(kind: DashKind) {
    ui.set({ dashKind: kind });
    const ids = new Set(ui.get().selectedIds);
    if (!ids.size) return;
    const apply = (s: Shape): Shape => {
      if (s.type === 'text') return s;
      const dash = dashFor(kind, s.strokeWidth, s.strokeLinecap);
      return dash === s.strokeDasharray && !s.strokeDashoffset ? s : { ...s, strokeDasharray: dash, strokeDashoffset: undefined };
    };
    documentStore.commit('Change dash', d => editLevel(d, level => level.map(s => ids.has(s.id) ? mapLeaves(s, apply) : s)));
  },

  /**
   * A custom dash pattern (absolute units, '' = solid) and / or the dash offset for the selection. Typing
   * produces many calls; they are coalesced into one history entry.
   */
  setDash(patch: { dasharray?: string; offset?: number }) {
    const ids = new Set(ui.get().selectedIds);
    if (!ids.size) return;
    const apply = (s: Shape): Shape => {
      if (s.type === 'text') return s;
      const next: Shape = { ...s };
      if (patch.dasharray !== undefined) next.strokeDasharray = patch.dasharray;
      if (patch.offset !== undefined) next.strokeDashoffset = patch.offset || undefined;
      return next;
    };
    documentStore.commit('Change dash', d => editLevel(d, level => level.map(s => ids.has(s.id) ? mapLeaves(s, apply) : s)),
      { coalesce: `dash:${[...ids].join(',')}` });
  },

  /** Text property change: defaults + selected text shapes (also inside selected groups). */
  setTextProp<K extends keyof TextProps>(key: K, value: TextProps[K]) {
    if (key === 'fontSize') value = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, value as number)) as TextProps[K];
    if (key === 'fontWeight') value = normWeight(value) as TextProps[K];
    if (key === 'lineHeight') value = Math.min(5, Math.max(0.5, value as number)) as TextProps[K];
    ui.setTextDefault(key, value);
    const ids = new Set(ui.get().selectedIds);
    const apply = (s: Shape): Shape => s.type === 'text' && s[key] !== value ? { ...s, [key]: value } : s;
    documentStore.commit(
      'Change text',
      d => editLevel(d, level => level.map(s => ids.has(s.id) ? mapLeaves(s, apply) : s)),
      { coalesce: `text:${String(key)}:${[...ids].join(',')}` },
    );
  },

  rename: (id: string, name: string) => editor.updateShape(id, { name }, { label: 'Rename', coalesce: `rename:${id}` }),
  setVisible: (id: string, visible: boolean) =>
    editor.updateShape(id, { visible }, { label: visible ? 'Show shape' : 'Hide shape' }),

  /** Locks (or hides) every selected shape as ONE step; they leave the selection. */
  lockSelected: () => setOnSelection('locked'),
  hideSelected: () => setOnSelection('hidden'),

  /** Is anything locked, at any depth? */
  hasLocked(): boolean {
    let any = false;
    walk(documentStore.get().shapes, s => { if (s.locked) any = true; });
    return any;
  },
  unlockAll() {
    if (!editor.hasLocked()) return;
    documentStore.commit('Unlock all', d => ({ ...d, shapes: mapTree(d.shapes, s => {
      if (!s.locked) return s;
      const next = { ...s } as Shape;
      delete next.locked;
      return next;
    }) }));
  },

  /** Lock / unlock. A shape that gets locked leaves the selection (with anything selected inside it). */
  setLocked(id: string, locked: boolean) {
    const shape = findShape(documentStore.get().shapes, id);
    if (!shape || !!shape.locked === locked) return;
    documentStore.commit(locked ? 'Lock shape' : 'Unlock shape', d => mapShapes(d, s => {
      if (s.id !== id) return s;
      const next = { ...s } as Shape;
      if (locked) next.locked = true; else delete next.locked;
      return next;
    }));
    if (!locked) return;
    const u = ui.get();
    if (u.groupPath.includes(id)) { ui.setSelectionIn([], []); return; }
    const inside = new Set<string>([id]);
    walk([shape], s => inside.add(s.id));
    if (u.selectedIds.some(s => inside.has(s))) ui.setSelection(u.selectedIds.filter(s => !inside.has(s)));
  },

  deleteShapes(ids: string[]) {
    const set = new Set(ids);
    documentStore.commit(
      ids.length > 1 ? `Delete ${ids.length} shapes` : 'Delete shape',
      d => {
        const shapes = pruneEmpty(removeFromTree(d.shapes, set));
        return shapes === d.shapes ? d : { ...d, shapes };
      },
    );
  },
  deleteSelected() { editor.deleteShapes(ui.get().selectedIds); },

  // ── grouping ───────────────────────────────────────────────────────────────
  /** Wrap the selection (≥ 2 shapes of the same level) in a <g>. The group takes the top-most slot. */
  group() {
    const ids = new Set(ui.get().selectedIds);
    if (ids.size < 2) return;
    const gp = ui.get().groupPath;
    const level = get(currentLevel);
    const members = level.filter(s => ids.has(s.id));
    if (members.length < 2) return;
    if (gp.length + 1 + Math.max(...members.map(m => maxDepth([m]))) > MAX_GROUP_DEPTH) {
      notify(`Groups can be nested at most ${MAX_GROUP_DEPTH} levels deep.`, 'warn');
      return;
    }
    const g = makeGroup(members);
    const top = Math.max(...members.map(m => level.indexOf(m)));
    documentStore.commit('Group', d => editLevel(d, l => {
      const out: Shape[] = [];
      l.forEach((s, i) => { if (i === top) out.push(g); else if (!ids.has(s.id)) out.push(s); });
      return out;
    }));
    ui.setSelection([g.id]);
  },

  /** Dissolve the selected groups; the picture does not change. The children become the selection. */
  ungroup() {
    const groups = get(selectedShapes).filter(s => s.type === 'group');
    if (!groups.length) return;
    const ids = new Set(groups.map(g => g.id));
    const freed: string[] = [];
    documentStore.commit('Ungroup', d => editLevel(d, l => l.flatMap(s => {
      if (!ids.has(s.id) || s.type !== 'group') return [s];
      const kids = ungroupShape(s);
      freed.push(...kids.map(k => k.id));
      return kids;
    })));
    ui.setSelection([...get(selectedShapes).filter(s => s.type !== 'group').map(s => s.id), ...freed]);
  },

  /** Is the single selected shape a group (for "enter group")? */
  selectedGroup(): Shape | null {
    const sel = get(selectedShapes);
    return sel.length === 1 && sel[0].type === 'group' ? sel[0] : null;
  },

  // ── convert to path ────────────────────────────────────────────────────────
  canConvertToPath: (shapes: readonly Shape[]) => shapes.some(isConvertible),

  /**
   * Convert the selection to editable paths: rectangles, ellipses and lines exactly; text via the
   * font outlines (needs the font files, hence async); groups convert their children.
   * ONE undo step. Resolves to the warnings (also shown as a toast).
   */
  /** Fill rule of the selected paths (other shapes have no use for it). 'nonzero' is stored as no property. */
  setFillRule(rule: 'nonzero' | 'evenodd') {
    const ids = new Set(ui.get().selectedIds);
    const apply = (s: Shape): Shape => {
      if (s.type !== 'path' || (s.fillRule ?? 'nonzero') === rule) return s;
      const next = { ...s };
      if (rule === 'evenodd') next.fillRule = 'evenodd'; else delete next.fillRule;
      return next;
    };
    documentStore.commit('Change fill rule', d => editLevel(d, level => level.map(s => ids.has(s.id) ? mapLeaves(s, apply) : s)));
  },

  /** Can the selection be combined (Unite, Subtract …)? Two or more visible shapes, no images. */
  canBoolean(sel: readonly Shape[]): boolean {
    const vis = sel.filter(s => s.visible);
    return vis.length >= 2 && !leaves(vis).some(l => l.type === 'image');
  },

  /**
   * Unite / Subtract / Intersect / Exclude / Divide the selected shapes (utils/boolean.ts). Text is outlined first.
   * The result takes the place of the topmost selected shape and is selected. ONE undo step.
   */
  async booleanOp(op: BooleanOp): Promise<void> {
    const ids = new Set(ui.get().selectedIds);
    const picked = get(currentLevel).filter(s => ids.has(s.id) && s.visible);
    if (!editor.canBoolean(picked)) return;
    const operands: Shape[] = [];
    for (const s of picked) {
      if (!leaves([s]).some(l => l.type === 'text')) { operands.push(s); continue; }
      const r = await convertToPaths(s);
      if (leaves([r.shape]).some(l => l.type === 'text')) { notify(r.warnings.join(' ') || 'This text could not be converted to paths.', 'warn', 9000); return; }
      operands.push(r.shape);
    }
    let result: Shape[];
    try { result = await booleanShapes(op, operands); } catch (e) { notifyError(e); return; }
    if (!result.length) { notify(op === 'intersect' ? 'These shapes do not overlap, so nothing would be left.' : 'Nothing would be left of these shapes.', 'warn'); return; }
    const used = new Set(picked.map(s => s.id));
    documentStore.commit(BOOLEAN_LABEL[op], d => editLevel(d, level => {
      const top = level.reduce((m, s, i) => used.has(s.id) ? i : m, -1);
      return level.flatMap((s, i) => i === top ? result : used.has(s.id) ? [] : [s]);
    }));
    ui.setSelection(result.map(s => s.id));
  },

  async convertToPath(): Promise<string[]> {
    const sel = get(selectedShapes).filter(isConvertible);
    if (!sel.length) return [];
    const done = new Map<string, { from: Shape; to: Shape }>();
    const warnings = new Set<string>();
    try {
      for (const s of sel) {
        const r = await convertToPaths(s);
        if (r.changed) done.set(s.id, { from: s, to: r.shape });
        r.warnings.forEach(w => warnings.add(w));
      }
    } catch (e) { notifyError(e); return []; }
    if (done.size) {
      // Fonts are fetched asynchronously: a shape the user changed meanwhile is left alone (not overwritten by a stale copy).
      documentStore.commit('Convert to path', d => mapShapes(d, s => {
        const c = done.get(s.id);
        return c && c.from === s ? c.to : s;
      }));
    }
    if (warnings.size) notify([...warnings].join(' '), 'warn', 9000);
    return [...warnings];
  },

  // ── stroke to path ─────────────────────────────────────────────────────────
  canStrokeToPath: (shapes: readonly Shape[]) => shapes.some(hasStroke),

  /** The stroke of every selected shape becomes a filled path (a shape with a fill becomes fill + stroke in a group). ONE undo step. */
  strokeToPath() {
    const done = new Map<string, Shape>();
    for (const s of get(selectedShapes)) { const r = strokeToPath(s); if (r) done.set(s.id, r); }
    if (!done.size) return false;
    documentStore.commit('Stroke to path', d => mapShapes(d, s => done.get(s.id) ?? s));
    return true;
  },

  // ── clipboard ──────────────────────────────────────────────────────────────
  /** Copies the selection: kept in memory and shared with other tabs of the editor (utils/clipboard.ts). Returns the SVG text for the system clipboard. */
  copy(): string | null {
    const sel = get(selectedShapes);
    if (!sel.length) return null;
    clipboard = sel;
    pasteCount = 0;
    const entry = saveSharedClip(sel);
    clipboardTime = entry.time;
    return clipSvg(sel, entry.nonce);
  },
  /** Pastes SVG text that came from another program (or tab, without our tag): through the SVG importer. */
  pasteSvg(text: string): boolean {
    let r;
    try { r = importSvg(text); } catch (e) { notifyError(e); return false; }
    if (!r.shapes.length) { notify('Nothing in that SVG could be pasted.', 'warn'); return false; }
    const b = unionBounds(r.shapes.map(getWorldBounds));
    const d = documentStore.get();
    let shapes = r.shapes;
    if (pasteAnchor) shapes = centreOn(shapes, pasteAnchor);
    else if (b && (b.x > d.width || b.y > d.height || b.x + b.width < 0 || b.y + b.height < 0))      // far from the page: bring it in
      shapes = shapes.map(s => translateShape(s, d.width / 2 - (b.x + b.width / 2), d.height / 2 - (b.y + b.height / 2)));
    editor.addShapes(shapes, 'Paste SVG');
    if (r.warnings.length) notify(r.warnings.join(' '), 'warn', 9000);
    return true;
  },
  /** Layers panel drag & drop: puts a layer above / below another one, or into a group. */
  moveLayer(id: string, targetId: string, where: DropWhere) {
    const next = moveInTree(documentStore.get().shapes, id, targetId, where);
    if (!next) return false;
    documentStore.commit('Move layer', d => ({ ...d, shapes: next }));
    const path = pathTo(next, id);
    if (path) ui.setSelectionIn([id], path.slice(0, -1));
    return true;
  },
  cut(): string | null { const text = editor.copy(); if (text !== null) editor.deleteSelected(); return text; },
  paste(): boolean {
    const shared = loadSharedClip();                      // copied in another tab since? then that one is meant
    if (shared && shared.time > clipboardTime) { clipboard = shared.shapes; clipboardTime = shared.time; pasteCount = 0; }
    if (!clipboard.length) return false;
    if (pasteAnchor) { editor.addShapes(centreOn(clipboard.map(cloneWithNewIds), pasteAnchor), 'Paste'); return true; }
    pasteCount++;
    const off = 10 * pasteCount;
    editor.addShapes(clipboard.map(s => cloneWithNewIds(translateShape(s, off, off))), 'Paste');
    return true;
  },
  /** Runs a paste with its result centred on `p` (context menu: paste where the menu was opened). */
  async pasteAt<T>(p: Point, paste: () => T | Promise<T>): Promise<T> {
    pasteAnchor = p;
    try { return await paste(); } finally { pasteAnchor = null; }
  },
  duplicate() {
    const sel = get(selectedShapes);
    if (!sel.length) return;
    editor.addShapes(sel.map(s => cloneWithNewIds(translateShape(s, 10, 10))), 'Duplicate');
  },

  // ── z-order (multi-select aware, within the shapes' own level) ─────────────
  bringToFront: () => reorder('Bring to front', (list, sel) => [...list.filter(s => !sel.has(s.id)), ...list.filter(s => sel.has(s.id))]),
  sendToBack:   () => reorder('Send to back',   (list, sel) => [...list.filter(s => sel.has(s.id)), ...list.filter(s => !sel.has(s.id))]),
  moveUp:       (ids?: string[]) => reorder('Move forward', (list, sel) => {
    const a = list.slice();
    for (let i = a.length - 2; i >= 0; i--) if (sel.has(a[i].id) && !sel.has(a[i + 1].id)) [a[i], a[i + 1]] = [a[i + 1], a[i]];
    return a;
  }, ids),
  moveDown:     (ids?: string[]) => reorder('Move backward', (list, sel) => {
    const a = list.slice();
    for (let i = 1; i < a.length; i++) if (sel.has(a[i].id) && !sel.has(a[i - 1].id)) [a[i], a[i - 1]] = [a[i - 1], a[i]];
    return a;
  }, ids),

  // ── transform ──────────────────────────────────────────────────────────────
  /** Flip the selection about the centre of its combined bounds. */
  flip(axis: 'h' | 'v') {
    const sel = get(selectedShapes);
    const ub = unionBounds(sel.map(getWorldBounds));
    if (!ub) return;
    const g = centerOf(ub);
    const ids = new Set(sel.map(s => s.id));
    documentStore.commit(axis === 'h' ? 'Flip horizontal' : 'Flip vertical', d => mapShapes(d, s => {
      if (!ids.has(s.id)) return s;
      const c = centerOf(getWorldBounds(s));          // rotation preserves the centre
      const m = mirrorShape(s, axis);
      return axis === 'h' ? translateShape(m, 2 * (g.x - c.x), 0) : translateShape(m, 0, 2 * (g.y - c.y));
    }));
  },

  align(axis: Axis) {
    const sel = get(selectedShapes);
    if (sel.length < 2) return;
    const ub = unionBounds(sel.map(getWorldBounds))!;
    const ids = new Set(sel.map(s => s.id));
    documentStore.commit(`Align ${axis}`, d => mapShapes(d, s => {
      if (!ids.has(s.id)) return s;
      const b: BoundingBox = getWorldBounds(s);
      let dx = 0, dy = 0;
      if (axis === 'left')   dx = ub.x - b.x;
      if (axis === 'right')  dx = ub.x + ub.width - (b.x + b.width);
      if (axis === 'center') dx = ub.x + ub.width / 2 - (b.x + b.width / 2);
      if (axis === 'top')    dy = ub.y - b.y;
      if (axis === 'bottom') dy = ub.y + ub.height - (b.y + b.height);
      if (axis === 'middle') dy = ub.y + ub.height / 2 - (b.y + b.height / 2);
      return dx || dy ? translateShape(s, dx, dy) : s;
    }));
  },

  /** Arrow-key nudge, coalesced so a held key is one undo step. */
  nudge(dx: number, dy: number) {
    const ids = new Set(ui.get().selectedIds);
    if (!ids.size) return;
    documentStore.commit('Nudge', d => mapShapes(d, s => ids.has(s.id) ? translateShape(s, dx, dy) : s), { coalesce: 'nudge' });
  },

  // ── live drags (move / resize / rotate / node edit) ────────────────────────
  beginDrag: () => documentStore.beginPreview(),
  /** Replace shapes (matched by id, any depth) without touching history. */
  previewShapes(next: Map<string, Shape>) {
    documentStore.preview(d => mapShapes(d, s => next.get(s.id) ?? s));
  },
  commitDrag: (actionLabel: string) => documentStore.commitPreview(actionLabel),
  cancelDrag: () => documentStore.cancelPreview(),

  // ── document ───────────────────────────────────────────────────────────────
  setCanvasSize: (width: number, height: number) =>
    documentStore.commit('Resize canvas', d => d.width === width && d.height === height ? d : { ...d, width, height }, { coalesce: 'canvas-size' }),
  setBackground: (background: BackgroundType) =>
    documentStore.commit('Change background', d => d.background === background ? d : { ...d, background }),
  /** Picks the custom background color (and switches to it). Dragging the picker is ONE history entry. */
  setBgColor: (bgColor: string) =>
    documentStore.commit('Change background color', d => d.background === 'custom' && d.bgColor === bgColor ? d : { ...d, background: 'custom', bgColor }, { coalesce: 'bg-color' }),
  // ── ruler guides ───────────────────────────────────────────────────────────
  addGuide: (axis: 'x' | 'y', pos: number) =>
    documentStore.commit('Add guide', d => ({ ...d, guides: [...(d.guides ?? []), { axis, pos: Math.round(pos * 100) / 100 }] })),
  moveGuide: (index: number, pos: number) =>
    documentStore.commit('Move guide', d => {
      const g = d.guides?.[index];
      return g ? { ...d, guides: d.guides!.map((x, i) => i === index ? { ...x, pos: Math.round(pos * 100) / 100 } : x) } : d;
    }),
  removeGuide: (index: number) =>
    documentStore.commit('Remove guide', d => {
      if (!d.guides?.[index]) return d;
      const guides = d.guides.filter((_, i) => i !== index);
      const { guides: _drop, ...rest } = d;
      return guides.length ? { ...d, guides } : rest;
    }),
  clearGuides: () =>
    documentStore.commit('Clear guides', d => { if (!d.guides?.length) return d; const { guides: _drop, ...rest } = d; return rest; }),

  setBgFit: (bgFit: BgFit) =>
    documentStore.commit('Background image fit', d => (d.bgFit ?? 'cover') === bgFit ? d : { ...d, bgFit }),
  /**
   * Shrinks / grows the canvas to the visible content plus `padding` and moves the content so it sits
   * inside it (ONE undo step). Refuses when the result would exceed the canvas limit.
   */
  fitCanvasToContent(padding = 20) {
    const d = documentStore.get();
    const b = contentBounds(d.shapes);
    if (!b) { notify('There is nothing to fit the canvas around.', 'warn'); return; }
    const w = Math.ceil(b.width + 2 * padding), h = Math.ceil(b.height + 2 * padding);
    if (w > MAX_CANVAS || h > MAX_CANVAS) { notify(`The content is larger than the maximum canvas (${MAX_CANVAS} px).`, 'warn'); return; }
    const dx = padding - b.x, dy = padding - b.y;
    documentStore.commit('Fit canvas to content', doc => ({
      ...doc, width: Math.max(16, w), height: Math.max(16, h), shapes: doc.shapes.map(s => translateShape(s, dx, dy)),
    }));
  },
  setBgImage: (bgImage: string) =>
    documentStore.commit(bgImage ? 'Set background image' : 'Remove background image', d => d.bgImage === bgImage ? d : { ...d, bgImage }),
  newDocument(width = 800, height = 600) {
    documentStore.load({ ...emptyDocument(), width, height }, 'New document');
    ui.setSelectionIn([], []);
  },
  loadDocument(doc: DocumentState, actionLabel = 'Open') {
    documentStore.load(doc, actionLabel);
    ui.setSelectionIn([], []);
  },

  undo: () => documentStore.undo(),
  redo: () => documentStore.redo(),
};

/** Re-orders the siblings of the given ids (default: the selection) — each level on its own. */
function reorder(actionLabel: string, fn: (list: Shape[], sel: Set<string>) => Shape[], ids?: string[]) {
  const wanted = ids ?? ui.get().selectedIds;
  if (!wanted.length) return;
  documentStore.commit(actionLabel, d => {
    let shapes = d.shapes;
    const done = new Set<string>();
    for (const id of wanted) {
      if (done.has(id)) continue;
      shapes = updateSiblings(shapes, id, list => {
        const siblings = new Set(list.map(s => s.id));
        const sel = new Set(wanted.filter(w => siblings.has(w)));
        sel.forEach(x => done.add(x));
        const next = fn(list, sel);
        return next.every((s, i) => s === list[i]) ? list : next;
      });
    }
    return shapes === d.shapes ? d : { ...d, shapes };
  });
}
