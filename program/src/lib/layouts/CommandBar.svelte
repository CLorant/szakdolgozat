<script lang="ts">
  import { editorStore } from '../stores/editorStore';
  import { flipShape, getShapeBounds } from '../utils/bounds';
  import { translateShape } from '../utils/geometry';
  import FontPicker from '../components/FontPicker.svelte';
  import type { ToolType, TextProps } from '../utils/types';

  let selectedTool:     ToolType = 'transform';
  let selectedShapeIds: string[] = [];
  let zoom             = 1;
  let canUndo          = false;
  let canRedo          = false;
  let shapes           = editorStore.getState().shapes;
  let polygonClosed    = true;
  let textProps        = editorStore.getState().textProps;
  let curveSubTool     = editorStore.getState().curveSubTool;

  editorStore.subscribe(s => {
    selectedTool     = s.selectedTool;
    selectedShapeIds = s.selectedShapeIds;
    zoom             = s.zoom;
    canUndo          = s.canUndo;
    canRedo          = s.canRedo;
    shapes           = s.shapes;
    polygonClosed    = s.polygonClosed;
    textProps        = s.textProps;
    curveSubTool     = s.curveSubTool;
  });

  $: primaryId    = selectedShapeIds[0] ?? null;
  $: primaryShape = primaryId ? shapes.find(s => s.id === primaryId) ?? null : null;

  /**
   * FIX: When a text shape is selected, display its own formatting props in
   * the command bar buttons rather than the global textProps defaults.
   * This is why buttons appeared to update with a "delay" — they were showing
   * a different source of truth than the selected shape.
   */
  $: activeTextShape = (primaryShape?.type === 'text' ? primaryShape : null) as any;
  $: displayTp = (activeTextShape ?? textProps) as TextProps;

  /** Update a text prop on both the global defaults and the selected shape. */
  function setDisplayTp<K extends keyof TextProps>(key: K, value: TextProps[K]) {
    editorStore.setTextProp(key, value);
    if (activeTextShape) editorStore.updateShape(activeTextShape.id, { [key]: value } as any);
  }

  // ── Rotation ──────────────────────────────────────────────────────────────
  function setRotation(deg: number) {
    if (!primaryId) return;
    editorStore.updateShape(primaryId, { rotation: ((deg % 360) + 360) % 360 } as any);
  }
  function rotateDelta(delta: number) {
    setRotation(((primaryShape as any)?.rotation ?? 0) + delta);
  }

  // ── Opacity ───────────────────────────────────────────────────────────────
  function setOpacity(v: number) {
    if (!primaryId) return;
    editorStore.updateShape(primaryId, { opacity: v });
  }

  // ── Flip ──────────────────────────────────────────────────────────────────
  function flipH() {
    if (!primaryShape) return;
    const upd = flipShape(primaryShape, 'h');
    if (Object.keys(upd).length) editorStore.updateShape(primaryShape.id, upd as any);
  }
  function flipV() {
    if (!primaryShape) return;
    const upd = flipShape(primaryShape, 'v');
    if (Object.keys(upd).length) editorStore.updateShape(primaryShape.id, upd as any);
  }

  // ── Alignment ─────────────────────────────────────────────────────────────
  function alignShapes(axis: string) {
    if (selectedShapeIds.length < 2) return;

    const selected  = shapes.filter(s => selectedShapeIds.includes(s.id));
    const allBounds = selected.map(s => ({ id: s.id, b: getShapeBounds(s), shape: s }));

    const gx  = Math.min(...allBounds.map(({b}) => b.x));
    const gy  = Math.min(...allBounds.map(({b}) => b.y));
    const gx2 = Math.max(...allBounds.map(({b}) => b.x + b.width));
    const gy2 = Math.max(...allBounds.map(({b}) => b.y + b.height));
    const gcx = (gx + gx2) / 2;
    const gcy = (gy + gy2) / 2;

    const updates = allBounds.map(({id, b, shape}) => {
      let dx = 0, dy = 0;
      switch (axis) {
        case 'left':     dx = gx  - b.x;                      break;
        case 'right':    dx = gx2 - (b.x + b.width);          break;
        case 'top':      dy = gy  - b.y;                      break;
        case 'bottom':   dy = gy2 - (b.y + b.height);         break;
        case 'center-h': dx = gcx - (b.x + b.width  / 2);    break;
        case 'center-v': dy = gcy - (b.y + b.height / 2);    break;
      }
      return { id, patch: translateShape(shape, dx, dy) as any };
    }).filter(u => u.patch && (u.patch.x !== undefined || u.patch.x1 !== undefined || u.patch.cx !== undefined || u.patch.points !== undefined));

    editorStore.updateShapes(updates);
  }

  // ── Zoom ──────────────────────────────────────────────────────────────────
  function zoomIn()    { editorStore.setZoom(zoom * 1.25); }
  function zoomOut()   { editorStore.setZoom(zoom / 1.25); }
  function zoomReset() { editorStore.setZoom(1); }

  $: rotation = (primaryShape as any)?.rotation ?? 0;
  $: opacity  = primaryShape?.opacity ?? 1;
</script>

<div class="svge-cmdbar">
  <!-- Always: undo/redo + zoom -->
  <div class="svge-cmd-group">
    <button class="svge-cmd-btn" disabled={!canUndo} on:click={() => editorStore.undo()} title="Undo [Ctrl+Z]">
      <img src="/src/assets/icons/undo.svg" alt="Undo" class="icon">
    </button>
    <button class="svge-cmd-btn" disabled={!canRedo} on:click={() => editorStore.redo()} title="Redo [Ctrl+Y]">
      <img src="/src/assets/icons/redo.svg" alt="Redo" class="icon">
    </button>
  </div>

  <div class="svge-cmd-sep"></div>

  <div class="svge-cmd-group">
    <button class="svge-cmd-btn" on:click={zoomOut} title="Zoom out">－</button>
    <button class="svge-zoom-pill" on:click={zoomReset} title="Reset zoom">{Math.round(zoom * 100)}%</button>
    <button class="svge-cmd-btn" on:click={zoomIn}  title="Zoom in">＋</button>
  </div>

  <div class="svge-cmd-sep"></div>

  <!-- ── Transform context ──────────────────────────────────────────────── -->
  {#if selectedTool === 'transform'}
    {#if primaryShape}
      <div class="svge-cmd-group svge-cmd-labeled">
        <span class="svge-cmd-label">Rotate</span>
        <input type="number" class="svge-cmd-num" value={rotation} min="-360" max="360" step="1"
          on:change={e => setRotation(parseFloat((e.target as HTMLInputElement).value))} />
        <span class="svge-cmd-unit">°</span>
        <button class="svge-cmd-btn" on:click={() => rotateDelta(-90)} title="Rotate −90°">↺</button>
        <button class="svge-cmd-btn" on:click={() => rotateDelta(90)}  title="Rotate +90°">↻</button>
      </div>
      <div class="svge-cmd-sep"></div>
      <div class="svge-cmd-group svge-cmd-labeled">
        <span class="svge-cmd-label">Opacity</span>
        <input type="range" min="0" max="1" step="0.01" value={opacity} class="svge-cmd-slider"
          on:input={e => setOpacity(parseFloat((e.target as HTMLInputElement).value))} />
        <span class="svge-cmd-unit">{Math.round(opacity * 100)}%</span>
      </div>
      <div class="svge-cmd-sep"></div>
      <div class="svge-cmd-group">
        <button class="svge-cmd-btn" on:click={flipH} title="Flip horizontal">⇆</button>
        <button class="svge-cmd-btn" on:click={flipV} title="Flip vertical">⇅</button>
        <button class="svge-cmd-btn danger" on:click={() => editorStore.deleteSelectedShapes()} title="Delete [Del]">✕</button>
      </div>

    {:else if selectedShapeIds.length >= 2}
      <div class="svge-cmd-group">
        <span class="svge-cmd-label">{selectedShapeIds.length} selected</span>
      </div>
      <div class="svge-cmd-sep"></div>
      <div class="svge-cmd-group">
        <span class="svge-cmd-label">Align</span>
        {#each [
          ['left',     '⊣', 'Align left edges'],
          ['top',      '⊤', 'Align top edges'],
          ['right',    '⊢', 'Align right edges'],
          ['bottom',   '⊥', 'Align bottom edges'],
          ['center-h', '⊼', 'Centre horizontally'],
          ['center-v', '⊻', 'Centre vertically'],
        ] as [axis, icon, title]}
          <button class="svge-cmd-btn" {title} on:click={() => alignShapes(axis)}>{icon}</button>
        {/each}
      </div>
      <div class="svge-cmd-sep"></div>
      <div class="svge-cmd-group">
        <button class="svge-cmd-btn danger" on:click={() => editorStore.deleteSelectedShapes()} title="Delete [Del]">✕</button>
      </div>

    {:else}
      <span class="svge-cmd-hint">Select a shape to transform it</span>
    {/if}
  {/if}

  <!-- ── Edit context ─────────────────────────────────────────────────────── -->
  {#if selectedTool === 'edit'}
    {#if primaryShape}
      <span class="svge-cmd-hint">
        Drag nodes to reshape · <strong>{primaryShape.type}</strong>
        {#if primaryShape.type === 'rectangle'} · orange ◆ = corner radius{/if}
        {#if primaryShape.type === 'arc'} · orange ◆ = arc curvature{/if}
      </span>
    {:else}
      <span class="svge-cmd-hint">Click a shape to edit its nodes</span>
    {/if}
  {/if}

  <!-- ── Text context ─────────────────────────────────────────────────────── -->
  {#if selectedTool === 'text'}
    <div class="svge-cmd-group">
      <!--
        FontPicker uses position:fixed for its dropdown, so it escapes
        the CommandBar's overflow-y:hidden clipping.
      -->
      <FontPicker
        value={displayTp.fontFamily}
        compact={true}
        onChange={f => setDisplayTp('fontFamily', f)}
      />
      <input type="number" class="svge-cmd-num" value={displayTp.fontSize} min="6" max="300"
        on:change={e => setDisplayTp('fontSize', parseFloat((e.target as HTMLInputElement).value))} />
      <span class="svge-cmd-unit">px</span>
    </div>
    <div class="svge-cmd-sep"></div>
    <div class="svge-cmd-group">
      <!--
        FIX: buttons use displayTp (selected shape's props OR global defaults)
        so they reflect the actual active state immediately without delay.
      -->
      <button class="svge-cmd-btn" class:active={displayTp.fontWeight==='bold'}
        on:click={() => setDisplayTp('fontWeight', displayTp.fontWeight==='bold'?'normal':'bold')}
        title="Bold"><strong>B</strong></button>
      <button class="svge-cmd-btn" class:active={displayTp.fontStyle==='italic'}
        on:click={() => setDisplayTp('fontStyle', displayTp.fontStyle==='italic'?'normal':'italic')}
        title="Italic"><em>I</em></button>
      <button class="svge-cmd-btn" class:active={displayTp.textDecoration==='underline'}
        on:click={() => setDisplayTp('textDecoration', displayTp.textDecoration==='underline'?'none':'underline')}
        title="Underline"><u>U</u></button>
    </div>
    <div class="svge-cmd-sep"></div>
    <div class="svge-cmd-group">
      {#each [['start','⊣'],['middle','⊼'],['end','⊢']] as [val, icon]}
        <button class="svge-cmd-btn" class:active={displayTp.textAnchor===val}
          on:click={() => setDisplayTp('textAnchor', val as any)}
          title="Align {val}">{icon}</button>
      {/each}
    </div>
    <div class="svge-cmd-sep"></div>
    <span class="svge-cmd-hint">Click canvas to place · double-click text to edit · <kbd>Ctrl+Enter</kbd> to confirm</span>
  {/if}

  <!-- ── Curve context ─────────────────────────────────────────────────────── -->
  {#if selectedTool === 'curve'}
    <div class="svge-cmd-group">
      {#each [['quadratic-bezier','Quad Bézier'],['cubic-bezier','Cubic Bézier'],['arc','Arc']] as [val, label]}
        <button class="svge-cmd-pill" class:active={curveSubTool===val}
          on:click={() => editorStore.setCurveSubTool(val as any)}>{label}</button>
      {/each}
    </div>
    <div class="svge-cmd-sep"></div>
    <span class="svge-cmd-hint">
      {#if curveSubTool === 'arc'}Click start · move to preview arc · click to place end{:else}Click start · click+drag end to pull handles{/if}
      · <kbd>Esc</kbd> to stop
    </span>
  {/if}

  <!-- ── Polygon / polyline context ──────────────────────────────────────── -->
  {#if selectedTool === 'polygon'}
    <div class="svge-cmd-group">
      <button class="svge-cmd-pill" class:active={polygonClosed}
        on:click={() => editorStore.setPolygonClosed(true)}
        title="Draw closed polygons">Polygon</button>
      <button class="svge-cmd-pill" class:active={!polygonClosed}
        on:click={() => editorStore.setPolygonClosed(false)}
        title="Draw open polylines">Polyline</button>
    </div>
    <div class="svge-cmd-sep"></div>
    <span class="svge-cmd-hint">
      Click to add points ·
      {#if polygonClosed}snap to start or double-click to close{:else}double-click or <kbd>Esc</kbd> to finish{/if}
    </span>
  {/if}

  <!-- ── Line context ──────────────────────────────────────────────────────── -->
  {#if selectedTool === 'line'}
    <span class="svge-cmd-hint">Click and drag · <kbd>Shift</kbd> to snap to 45°</span>
  {/if}

  <!-- ── Rectangle context ─────────────────────────────────────────────────── -->
  {#if selectedTool === 'rectangle'}
    <span class="svge-cmd-hint">Click and drag · <kbd>Shift</kbd> for square · use Edit tool to adjust corner radius</span>
  {/if}

  <!-- ── Ellipse context ───────────────────────────────────────────────────── -->
  {#if selectedTool === 'ellipse'}
    <span class="svge-cmd-hint">Click and drag · <kbd>Shift</kbd> for circle</span>
  {/if}

  <!-- ── Freehand context ──────────────────────────────────────────────────── -->
  {#if selectedTool === 'freehand'}
    <span class="svge-cmd-hint">Click and drag to draw freely</span>
  {/if}

  <!-- ── Zoom context ──────────────────────────────────────────────────────── -->
  {#if selectedTool === 'zoom'}
    <span class="svge-cmd-hint">LMB zoom in · RMB zoom out · <kbd>Ctrl</kbd>+scroll anywhere</span>
  {/if}
</div>

<style>
  .svge-cmdbar {
    display: flex; align-items: center; gap: 0; padding: 0 6px; height: 38px;
    background: var(--toolbar-bg); border-bottom: 1px solid var(--border-color);
    flex-shrink: 0; overflow-x: auto; overflow-y: visible; scrollbar-width: none;
  }
  .svge-cmdbar::-webkit-scrollbar { display: none; }

  .svge-cmd-group { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }
  .svge-cmd-sep { width: 1px; height: 20px; background: var(--border-color); margin: 0 5px; flex-shrink: 0; }

  .svge-cmd-btn {
    width: 42px; height: 28px; display: flex; align-items: center; justify-content: center;
    background: transparent; border: 1px solid transparent; border-radius: 4px;
    cursor: pointer; font-size: 0.9rem; color: var(--text-color); padding: 0; transition: background 0.12s; flex-shrink: 0;
  }
  .svge-cmd-btn:hover:not(:disabled) { background: var(--ruler-bg); border-color: var(--border-color); }
  .svge-cmd-btn:disabled             { opacity: 0.3; cursor: not-allowed; }
  .svge-cmd-btn.active               { background: var(--tool-active); border-color: var(--tool-border-active); }
  .svge-cmd-btn.danger:hover:not(:disabled) { background: #e74c3c18; border-color: #e74c3c55; color: #e74c3c; }

  .svge-zoom-pill {
    padding: 0 8px; height: 26px; background: transparent; border: 1px solid var(--border-color);
    border-radius: 4px; color: var(--text-color); font-size: 0.82rem; font-family: monospace;
    cursor: pointer; transition: background 0.12s; white-space: nowrap; flex-shrink: 0;
  }
  .svge-zoom-pill:hover { background: var(--ruler-bg); }

  .svge-cmd-label { font-size: 0.78rem; color: var(--text-color); opacity: 0.55; padding: 0 4px; white-space: nowrap; flex-shrink: 0; }
  .svge-cmd-num {
    width: 52px; height: 26px; padding: 0 5px; border: 1px solid var(--border-color); border-radius: 4px;
    background: var(--bg-color); color: var(--text-color); font-size: 0.82rem; font-family: monospace;
    text-align: center; flex-shrink: 0;
  }
  .svge-cmd-slider { width: 70px; cursor: pointer; accent-color: var(--accent-color); flex-shrink: 0; }
  .svge-cmd-unit { font-size: 0.75rem; color: var(--text-color); opacity: 0.5; padding: 0 2px; white-space: nowrap; flex-shrink: 0; }

  .svge-cmd-hint { font-size: 0.82rem; color: var(--text-color); opacity: 0.45; padding: 0 6px; white-space: nowrap; flex-shrink: 0; }
  .svge-cmd-hint kbd { background: var(--border-color); border-radius: 3px; padding: 1px 4px; font-size: 0.75rem; font-family: monospace; }

  .svge-cmd-pill {
    padding: 0 10px; height: 26px; background: transparent; border: 1px solid var(--border-color);
    border-radius: 4px; color: var(--text-color); font-size: 0.82rem; cursor: pointer;
    transition: background 0.12s; white-space: nowrap; flex-shrink: 0;
  }
  .svge-cmd-pill:hover  { background: var(--ruler-bg); }
  .svge-cmd-pill.active { background: var(--tool-active); border-color: var(--tool-border-active); }

  .svge-cmd-labeled { gap: 4px; }
</style>