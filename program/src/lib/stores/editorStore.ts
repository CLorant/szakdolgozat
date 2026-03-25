import { writable, get } from 'svelte/store';
import type { Shape, ToolType, PropertyType, BackgroundType, Point, CurveSubType, TextProps } from '../utils/types';

export interface EditorState {
  shapes:           Shape[];
  selectedTool:     ToolType;
  selectedShapeIds: string[];
  currentFill:      string;
  currentStroke:    string;
  currentStrokeWidth: number;
  background:       BackgroundType;
  isDrawing:        boolean;
  tempShape:        Shape | null;
  polygonPoints:    Point[];
  polygonClosed:    boolean;
  cursor:           Point;
  zoom:             number;
  curveSubTool:     CurveSubType;
  textEditingId:    string | null;
  textProps:        TextProps;
  selectedProperty: PropertyType;
  panelOpen:        boolean;
  clipboard:        Shape[];
  gridEnabled:      boolean;
  gridSizeX:        number;
  gridSizeY:        number;
  snapEnabled:      boolean;
  canUndo:          boolean;
  canRedo:          boolean;
  canvasScrollLeft: number;
  canvasScrollTop:  number;
  canvasPadding:    number;
  canvasWidth:      number;
  canvasHeight:     number;
  /** Base64 data URL for canvas background image. Empty string = none. */
  canvasBgImage:    string;
  /** Labels for past history entries — parallel to history.past, for display only */
  historyLabels:    string[];
  /** Labels for future (redo) entries */
  futureLabels:     string[];
}

interface HistoryEntry {
  shapes: Shape[];
  label:  string;
}

interface HistoryState {
  past:    HistoryEntry[];
  present: HistoryEntry;
  future:  HistoryEntry[];
}

function uid(): string {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const DEFAULT_TEXT_PROPS: TextProps = {
  fontFamily:     'sans-serif',
  fontSize:       16,
  fontWeight:     'normal',
  fontStyle:      'normal',
  textDecoration: 'none',
  textAnchor:     'start',
  letterSpacing:  0,
};

function createEditorStore() {
  const initial: EditorState = {
    shapes:             [],
    selectedTool:       'transform',
    selectedShapeIds:   [],
    currentFill:        '#aaaaaa',
    currentStroke:      '#000000',
    currentStrokeWidth: 2,
    background:         'white',
    isDrawing:          false,
    tempShape:          null,
    polygonPoints:      [],
    polygonClosed:      true,
    cursor:             { x: 0, y: 0 },
    zoom:               1,
    curveSubTool:       'cubic-bezier',
    textEditingId:      null,
    textProps:          { ...DEFAULT_TEXT_PROPS },
    selectedProperty:   '',
    panelOpen:          false,
    clipboard:          [],
    gridEnabled:        false,
    gridSizeX:           10,
    gridSizeY:           10,
    snapEnabled:        false,
    canUndo:            false,
    canRedo:            false,
    canvasScrollLeft:   0,
    canvasScrollTop:    0,
    canvasPadding:      40,
    canvasWidth:        800,
    canvasHeight:       600,
    canvasBgImage:      '',
    historyLabels:      [],
    futureLabels:       [],
  };

  const store   = writable<EditorState>(initial);
  const history = writable<HistoryState>({
    past:    [],
    present: { shapes: [], label: 'Initial' },
    future:  [],
  });
  const { subscribe, update } = store;

  let _dragSnapshot:      Shape[] | null = null;
  let _dragSnapshotLabel: string         = 'Move';

  function syncFlags() {
    const h = get(history);
    update(s => ({
      ...s,
      canUndo:       h.past.length > 0,
      canRedo:       h.future.length > 0,
      historyLabels: h.past.map(e => e.label),
      futureLabels:  h.future.map(e => e.label),
    }));
  }

  function pushEntry(prev: HistoryEntry, next: HistoryEntry) {
    history.update(h => ({
      past:    [...h.past, prev],
      present: next,
      future:  [],
    }));
    syncFlags();
  }

  function withHistory(fn: (s: EditorState) => EditorState, label = 'Edit') {
    update(s => {
      const prevEntry: HistoryEntry = { shapes: s.shapes, label };
      const next = fn(s);
      pushEntry(prevEntry, { shapes: next.shapes, label });
      return next;
    });
  }

  return {
    subscribe,
    getState: () => get(store),

    // ── Tool / property ───────────────────────────────────────────────────
    selectTool(tool: ToolType) {
      update(s => ({
        ...s,
        selectedTool:  tool,
        polygonPoints: [],
        tempShape:     null,
        textEditingId: null,
        isDrawing:     false,
      }));
    },
    setCurveSubTool(sub: CurveSubType) {
      update(s => ({ ...s, curveSubTool: sub, selectedTool: 'curve', polygonPoints: [], tempShape: null }));
    },
    selectProperty(prop: PropertyType) {
      update(s => {
        const opening = s.selectedProperty !== prop || !s.panelOpen;
        return { ...s, selectedProperty: prop, panelOpen: opening };
      });
    },
    setPanelOpen: (open: boolean) => update(s => ({ ...s, panelOpen: open })),

    // ── Viewport ──────────────────────────────────────────────────────────
    setZoom:          (z: number)  => update(s => ({ ...s, zoom: Math.min(Math.max(0.05, z), 20) })),
    updateCursor:     (x: number, y: number) => update(s => ({ ...s, cursor: { x, y } })),
    setCanvasScroll:  (left: number, top: number) => update(s => ({ ...s, canvasScrollLeft: left, canvasScrollTop: top })),
    setCanvasPadding: (p: number)  => update(s => ({ ...s, canvasPadding: p })),
    setCanvasSize:    (w: number, h: number) => update(s => ({ ...s, canvasWidth: Math.max(100, w), canvasHeight: Math.max(100, h) })),
    setCanvasBgImage: (url: string) => update(s => ({ ...s, canvasBgImage: url })),

    // ── Appearance ────────────────────────────────────────────────────────
    setFill:         (fill: string)       => update(s => ({ ...s, currentFill:        fill   })),
    setStroke:       (stroke: string)     => update(s => ({ ...s, currentStroke:      stroke })),
    setStrokeWidth:  (w: number)          => update(s => ({ ...s, currentStrokeWidth: w      })),
    setBackground:   (bg: BackgroundType) => update(s => ({ ...s, background: bg })),
    setGridEnabled:  (v: boolean)         => update(s => ({ ...s, gridEnabled: v })),
    setGridSizeX:    (v: number)          => update(s => ({ ...s, gridSizeX: v })),
    setGridSizeY:    (v: number)          => update(s => ({ ...s, gridSizeY: v })),
    setSnapEnabled:  (v: boolean)         => update(s => ({ ...s, snapEnabled: v })),
    setPolygonClosed:(v: boolean)         => update(s => ({ ...s, polygonClosed: v })),

    // ── Text props ────────────────────────────────────────────────────────
    setTextProp<K extends keyof TextProps>(key: K, value: TextProps[K]) {
      update(s => ({ ...s, textProps: { ...s.textProps, [key]: value } }));
    },

    // ── Drawing state ─────────────────────────────────────────────────────
    setDrawing:           (v: boolean)     => update(s => ({ ...s, isDrawing:     v  })),
    setTempShape:         (sh: Shape|null) => update(s => ({ ...s, tempShape:     sh })),
    addPolygonPoint:      (pt: Point)      => update(s => ({ ...s, polygonPoints: [...s.polygonPoints, pt] })),
    clearPolygonPoints:   ()               => update(s => ({ ...s, polygonPoints: [], tempShape: null })),

    // ── Selection ─────────────────────────────────────────────────────────
    selectShape:  (id: string|null) => update(s => ({ ...s, selectedShapeIds: id ? [id] : [] })),
    selectShapes: (ids: string[])   => update(s => ({ ...s, selectedShapeIds: ids })),
    toggleSelect: (id: string)      => update(s => {
      const ids = s.selectedShapeIds.includes(id)
        ? s.selectedShapeIds.filter(x => x !== id)
        : [...s.selectedShapeIds, id];
      return { ...s, selectedShapeIds: ids };
    }),
    deselectAll:  () => update(s => ({ ...s, selectedShapeIds: [] })),
    selectAll:    () => update(s => ({ ...s, selectedShapeIds: s.shapes.map(sh => sh.id) })),

    // ── Shape CRUD ────────────────────────────────────────────────────────
    addShape(shape: Shape) {
      const label = `Add ${shape.type}`;
      withHistory(s => ({
        ...s,
        shapes:           [...s.shapes, shape],
        selectedShapeIds: [shape.id],
        polygonPoints:    [],
        tempShape:        null,
      }), label);
    },

    updateShape(id: string, updates: Partial<Shape>) {
      const s = get(store);
      const shp = s.shapes.find(sh => sh.id === id);
      const label = shp ? `Edit ${shp.type}` : 'Edit';
      withHistory(st => ({
        ...st,
        shapes: st.shapes.map(sh => sh.id === id ? { ...sh, ...updates } as Shape : sh),
      }), label);
    },

    updateShapes(updates: Array<{ id: string; patch: Partial<Shape> }>, label = 'Align') {
      if (!updates.length) return;
      withHistory(s => ({
        ...s,
        shapes: s.shapes.map(sh => {
          const upd = updates.find(u => u.id === sh.id);
          return upd ? { ...sh, ...upd.patch } as Shape : sh;
        }),
      }), label);
    },

    previewShape(id: string, updates: Partial<Shape>) {
      update(s => ({
        ...s,
        shapes: s.shapes.map(sh => sh.id === id ? { ...sh, ...updates } as Shape : sh),
      }));
    },

    beginDrag(label = 'Move') {
      _dragSnapshot      = get(store).shapes;
      _dragSnapshotLabel = label;
    },

    commitChange() {
      if (_dragSnapshot === null) return;
      const after = get(store).shapes;
      const prev: HistoryEntry  = { shapes: _dragSnapshot, label: _dragSnapshotLabel };
      const next: HistoryEntry  = { shapes: after,         label: _dragSnapshotLabel };
      history.update(h => ({ past: [...h.past, prev], present: next, future: [] }));
      syncFlags();
      _dragSnapshot = null;
    },

    cancelDrag() {
      if (_dragSnapshot === null) return;
      update(s => ({ ...s, shapes: _dragSnapshot! }));
      _dragSnapshot = null;
    },

    deleteSelectedShapes() {
      withHistory(s => ({
        ...s,
        shapes:           s.shapes.filter(sh => !s.selectedShapeIds.includes(sh.id)),
        selectedShapeIds: [],
      }), 'Delete');
    },

    deleteShape(id: string) {
      withHistory(s => ({
        ...s,
        shapes:           s.shapes.filter(sh => sh.id !== id),
        selectedShapeIds: s.selectedShapeIds.filter(x => x !== id),
      }), 'Delete');
    },

    // ── Clipboard ─────────────────────────────────────────────────────────
    copySelected() {
      update(s => ({
        ...s,
        clipboard: s.shapes.filter(sh => s.selectedShapeIds.includes(sh.id)).map(sh => ({ ...sh })),
      }));
    },
    cutSelected() {
      update(s => {
        const copied = s.shapes.filter(sh => s.selectedShapeIds.includes(sh.id)).map(sh => ({ ...sh }));
        return { ...s, clipboard: copied,
          shapes: s.shapes.filter(sh => !s.selectedShapeIds.includes(sh.id)), selectedShapeIds: [] };
      });
    },
    paste() {
      const s = get(store);
      if (!s.clipboard.length) return;
      const pasted = s.clipboard.map(sh => {
        const copy: any = { ...sh, id: uid() };
        if (copy.x  != null) copy.x  += 10;
        if (copy.y  != null) copy.y  += 10;
        if (copy.x1 != null) { copy.x1 += 10; copy.x2 += 10; }
        if (copy.cx != null) copy.cx += 10;
        if (copy.cy != null) copy.cy += 10;
        if (Array.isArray(copy.points))
          copy.points = copy.points.map((p: Point) => ({ x: p.x+10, y: p.y+10 }));
        if (copy.pathData)
          copy.pathData = copy.pathData.replace(/(-?[\d.]+),(-?[\d.]+)/g,
            (_: string, x: string, y: string) => `${parseFloat(x)+10},${parseFloat(y)+10}`);
        return copy as Shape;
      });
      withHistory(st => ({ ...st, shapes: [...st.shapes, ...pasted], selectedShapeIds: pasted.map(sh => sh.id) }), 'Paste');
    },

    // ── Layer ops ─────────────────────────────────────────────────────────
    setShapeVisibility: (id: string, v: boolean) =>
      update(s => ({ ...s, shapes: s.shapes.map(sh => sh.id === id ? { ...sh, visible: v } : sh) })),
    renameShape: (id: string, name: string) =>
      update(s => ({ ...s, shapes: s.shapes.map(sh => sh.id === id ? { ...sh, name } : sh) })),

    moveShapeUp(id: string) {
      withHistory(s => {
        const i = s.shapes.findIndex(sh => sh.id === id);
        if (i >= s.shapes.length - 1) return s;
        const a = [...s.shapes]; [a[i], a[i+1]] = [a[i+1], a[i]];
        return { ...s, shapes: a };
      }, 'Reorder');
    },
    moveShapeDown(id: string) {
      withHistory(s => {
        const i = s.shapes.findIndex(sh => sh.id === id);
        if (i <= 0) return s;
        const a = [...s.shapes]; [a[i], a[i-1]] = [a[i-1], a[i]];
        return { ...s, shapes: a };
      }, 'Reorder');
    },
    bringToFront(id: string) {
      withHistory(s => {
        const sh = s.shapes.find(sh => sh.id === id);
        if (!sh) return s;
        return { ...s, shapes: [...s.shapes.filter(x => x.id !== id), sh] };
      }, 'Bring to Front');
    },
    sendToBack(id: string) {
      withHistory(s => {
        const sh = s.shapes.find(sh => sh.id === id);
        if (!sh) return s;
        return { ...s, shapes: [sh, ...s.shapes.filter(x => x.id !== id)] };
      }, 'Send to Back');
    },

    // ── Text editing ──────────────────────────────────────────────────────
    startTextEdit: (id: string) => update(s => ({ ...s, textEditingId: id })),
    endTextEdit:   ()           => update(s => ({ ...s, textEditingId: null })),
    updateTextContent(id: string, content: string) {
      withHistory(s => ({
        ...s,
        shapes: s.shapes.map(sh => sh.id === id ? { ...sh, content } as Shape : sh),
      }), 'Edit text');
    },

    // ── History navigation ────────────────────────────────────────────────
    undo() {
      const h = get(history);
      if (!h.past.length) return;
      const prev = h.past[h.past.length - 1];
      history.set({ past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] });
      update(s => ({ ...s, shapes: prev.shapes, selectedShapeIds: [] }));
      syncFlags();
    },
    redo() {
      const h = get(history);
      if (!h.future.length) return;
      const next = h.future[0];
      history.set({ past: [...h.past, h.present], present: next, future: h.future.slice(1) });
      update(s => ({ ...s, shapes: next.shapes, selectedShapeIds: [] }));
      syncFlags();
    },
    /**
     * Jump to a specific history index (0 = oldest past entry).
     * Used by the history panel's click-to-jump feature.
     */
    jumpToHistory(index: number) {
      const h = get(history);
      const all = [...h.past, h.present, ...h.future];
      // target index in the full flattened array is index + 1 (past[0] = step 1)
      // index here refers to position in h.past array (0-based)
      if (index < 0 || index >= h.past.length) return;
      const target = h.past[index];
      history.set({
        past:    h.past.slice(0, index),
        present: target,
        future:  [...h.past.slice(index + 1), h.present, ...h.future],
      });
      update(s => ({ ...s, shapes: target.shapes, selectedShapeIds: [] }));
      syncFlags();
    },
  };
}

export const editorStore = createEditorStore();