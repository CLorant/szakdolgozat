<script lang="ts">
  /**
   * @file The context bar under the menu: undo / redo, zoom, and the controls of the active tool or selection.
   */
  import { ui, tool } from '../stores/ui';
  import { editor, selectedShapes } from '../stores/editor';
  import { canUndo, canRedo } from '../stores/document';
  import { narrow } from '../stores/media';
  import { ALIGN_ACTIONS, BOOLEAN_ACTIONS } from '../utils/actionLists';
  import { viewport } from '../stores/viewport';
  import { zoomBy, zoomTo, zoomFit } from '../utils/zoom';
  import { normDeg } from '../utils/math';
  import type { Shape, TextProps, TextShape } from '../utils/types';
  import FontPicker from '../components/FontPicker.svelte';
  import Icon from '../components/Icon.svelte';
  import { decorationLines, toggleDecoration } from '../utils/text';
  import { BOOLEAN_LABEL } from '../utils/boolean';

  $: sel      = $selectedShapes;
  $: single   = sel.length === 1 ? sel[0] : null;
  $: zoom     = $viewport.zoom;
  $: polygonClosed = $ui.polygonClosed;

  // The selected text shape's own props win over the global defaults (so buttons show the real state).
  $: textShape = (single?.type === 'text' ? single : null) as TextShape | null;
  $: tp = (textShape ?? $ui.textProps) as TextProps;

  const num = (e: Event) => parseFloat((e.target as HTMLInputElement).value);

  function setRotation(deg: number) {
    if (!single || Number.isNaN(deg)) return;
    editor.updateShape(single.id, { rotation: normDeg(deg) }, { label: 'Rotate', coalesce: `rot:${single.id}` });
  }
  const rotateBy = (d: number) => single && setRotation(single.rotation + d);
  const setOpacity = (v: number) => editor.setStyle({ opacity: v }, 'Change opacity');

  $: rotation = single ? Math.round(single.rotation * 10) / 10 : 0;
  $: opacity  = single?.opacity ?? sel[0]?.opacity ?? 1;
  $: convertible = editor.canConvertToPath(sel);
  $: strokable   = editor.canStrokeToPath(sel);
  $: canGroup    = sel.length > 1;
  $: hasGroup    = sel.some((s: Shape) => s.type === 'group');
  $: inGroup     = $ui.groupPath.length > 0;

  const BOOLEANS = BOOLEAN_ACTIONS;
  const ALIGN = ALIGN_ACTIONS;
</script>

<div class="svge-cmdbar">
  <!-- Always: undo / redo + zoom -->
  <div class="svge-cmd-group">
    <button class="svge-cmd-btn" disabled={!$canUndo} on:click={editor.undo} title="Undo [Ctrl+Z]" aria-label="Undo">
      <Icon name="undo" size={18} alt="Undo" />
    </button>
    <button class="svge-cmd-btn" disabled={!$canRedo} on:click={editor.redo} title="Redo [Ctrl+Y]" aria-label="Redo">
      <Icon name="redo" size={18} alt="Redo" />
    </button>
  </div>

  <div class="svge-cmd-sep"></div>

  <div class="svge-cmd-group">
    <button class="svge-cmd-btn svge-cmd-zoom" on:click={() => zoomBy(1 / 1.25)} title="Zoom out" aria-label="Zoom out">－</button>
    <button class="svge-zoom-pill" on:click={() => zoomTo(1)} title="Reset zoom to 100%">{Math.round(zoom * 100)}%</button>
    <button class="svge-cmd-btn svge-cmd-zoom" on:click={() => zoomBy(1.25)} title="Zoom in" aria-label="Zoom in">＋</button>
    <button class="svge-cmd-pill" on:click={zoomFit} title="Fit canvas to window">Fit</button>
  </div>

  <div class="svge-cmd-sep"></div>

  <!-- ── Transform context ─────────────────────────────────────────────── -->
  {#if $tool === 'transform'}
    {#if sel.length >= 2}
      <div class="svge-cmd-group"><span class="svge-cmd-label">{sel.length} selected</span></div>
      <div class="svge-cmd-sep"></div>
      <div class="svge-cmd-group">
        <span class="svge-cmd-label">Align</span>
        {#each ALIGN as [axis, icon, title]}
          <button class="svge-cmd-btn" {title} aria-label={title} on:click={() => editor.align(axis)}>{icon}</button>
        {/each}
      </div>
      {#if editor.canBoolean(sel)}
        <div class="svge-cmd-sep"></div>
        <div class="svge-cmd-group">
          {#each BOOLEANS as [op, title]}
            <button class="svge-cmd-btn" {title} aria-label={BOOLEAN_LABEL[op]} on:click={() => editor.booleanOp(op)}><Icon name={op} size={18} alt={BOOLEAN_LABEL[op]} /></button>
          {/each}
        </div>
      {/if}
    {:else if single}
      <div class="svge-cmd-group">
        <input type="number" class="svge-cmd-num" value={rotation} min="0" max="360" step="1"
          on:input={e => { const v = num(e); if (v >= 0 && v < 360) setRotation(v); }}
          on:change={e => setRotation(num(e))} title="Rotation in degrees" aria-label="Rotation in degrees" />
        <span class="svge-cmd-unit">°</span>
        <button class="svge-cmd-btn" on:click={() => rotateBy(-90)} title="Rotate −90°">↺</button>
        <button class="svge-cmd-btn" on:click={() => rotateBy(90)}  title="Rotate +90°">↻</button>
      </div>
    {:else}
      <span class="svge-cmd-hint">Click a shape to select it · drag on empty canvas to select several · <kbd>Space</kbd>+drag pans</span>
    {/if}

    {#if sel.length}
      {#if !$narrow}
      <div class="svge-cmd-sep"></div>
      <div class="svge-cmd-group">
        <!--
        <span class="svge-cmd-label">Opacity</span>
        -->
        <input type="range" min="0" max="1" step="0.01" value={opacity} class="svge-cmd-slider"
          on:input={e => setOpacity(num(e))} title="Opacity" aria-label="Opacity" />
        <span class="svge-cmd-unit svge-cmd-pct">{Math.round(opacity * 100)}%</span>
      </div>
      {/if}
      <div class="svge-cmd-sep"></div>
      <div class="svge-cmd-group">
        <button class="svge-cmd-btn" on:click={() => editor.flip('h')} title="Flip horizontal">⇆</button>
        <button class="svge-cmd-btn" on:click={() => editor.flip('v')} title="Flip vertical">⇅</button>
        <button class="svge-cmd-btn danger" on:click={editor.deleteSelected} title="Delete [Del]" aria-label="Delete">✕</button>
      </div>
    {/if}
    {#if canGroup || hasGroup || inGroup || convertible || strokable}
      <div class="svge-cmd-sep"></div>
      <div class="svge-cmd-group">
        {#if canGroup}<button class="svge-cmd-btn" on:click={editor.group} title="Group [Ctrl+G]" aria-label="Group"><Icon name="group" size={18} alt="Group" /></button>{/if}
        {#if hasGroup}<button class="svge-cmd-btn" on:click={editor.ungroup} title="Ungroup [Ctrl+Shift+G]" aria-label="Ungroup"><Icon name="ungroup" size={18} alt="Ungroup" /></button>{/if}
        {#if inGroup}<button class="svge-cmd-btn" on:click={editor.exitGroup} title="Exit group" aria-label="Exit group"><Icon name="exit-group" size={18} alt="Exit group" /></button>{/if}
        {#if convertible}<button class="svge-cmd-btn" on:click={() => editor.convertToPath()} title="Shape to path" aria-label="Shape to path"><Icon name="to-path" size={18} alt="Shape to path" /></button>{/if}
        {#if strokable}<button class="svge-cmd-btn" on:click={() => editor.strokeToPath()} title="Stroke to path" aria-label="Stroke to path"><Icon name="stroke-to-path" size={18} alt="Stroke to path" /></button>{/if}
      </div>
    {/if}
    {#if inGroup}<span class="svge-cmd-hint">Editing inside a group — click outside it or press <kbd>Esc</kbd> to leave</span>{/if}
  {/if}

  <!-- ── Edit context ───────────────────────────────────────────────────── -->
  {#if $tool === 'edit'}
    {#if single}
      {#if single.type === 'path'}
        <span class="svge-cmd-hint">
          Drag nodes and handles · <kbd>Shift</kbd>-click or drag a box to pick several · double-click the path to <strong>add</strong> a node ·
          double-click a node: corner ⇄ smooth · <kbd>Del</kbd> removes the picked nodes
        </span>
      {:else if single.type === 'text'}
        <span class="svge-cmd-hint">Text has no nodes — double-click it with the Select tool to edit the text, or convert it to a path</span>
      {:else if single.type === 'image'}
        <span class="svge-cmd-hint">An image has no nodes: resize, rotate and flip it with the Select tool</span>
      {:else if single.type === 'group'}
        <span class="svge-cmd-hint">A group has no nodes — click one of its shapes (the Select tool double-click enters the group)</span>
      {:else}
        <span class="svge-cmd-hint">
          Drag nodes to reshape · <strong>{single.type}</strong>
          {#if single.type === 'rectangle'} · orange ◆ = corner radius{/if}
          {#if single.type === 'ellipse'} · ◆ = radii{/if}
        </span>
      {/if}
      {#if convertible}
        <div class="svge-cmd-sep"></div>
        <button class="svge-cmd-btn" on:click={() => editor.convertToPath()} title="Shape to path" aria-label="Shape to path"><Icon name="to-path" size={18} alt="Shape to path" /></button>
      {/if}
    {:else}
      <span class="svge-cmd-hint">Click a shape to edit its nodes</span>
    {/if}
  {/if}

  <!-- ── Text context ───────────────────────────────────────────────────── -->
  {#if $tool === 'text'}
    <div class="svge-cmd-group">
      <!-- FontPicker's dropdown is position:fixed, so the bar's overflow clipping cannot hide it. -->
      <FontPicker value={tp.fontFamily} compact={true} onChange={f => editor.setTextProp('fontFamily', f)} />
      <input type="number" class="svge-cmd-num" value={tp.fontSize} min="6" max="300"
        on:change={e => editor.setTextProp('fontSize', num(e))} aria-label="Font size" />
      <span class="svge-cmd-unit">px</span>
    </div>
    <div class="svge-cmd-sep"></div>
    <div class="svge-cmd-group">
      <button class="svge-cmd-btn" class:active={tp.fontWeight >= 600}
        on:click={() => editor.setTextProp('fontWeight', tp.fontWeight >= 600 ? 400 : 700)} title="Bold (the Typography panel has every weight)"><strong>B</strong></button>
      <button class="svge-cmd-btn" class:active={tp.fontStyle === 'italic'}
        on:click={() => editor.setTextProp('fontStyle', tp.fontStyle === 'italic' ? 'normal' : 'italic')} title="Italic"><em>I</em></button>
      <button class="svge-cmd-btn" class:active={decorationLines(tp.textDecoration).includes('underline')}
        on:click={() => editor.setTextProp('textDecoration', toggleDecoration(tp.textDecoration, 'underline'))} title="Underline"><u>U</u></button>
    </div>
    <div class="svge-cmd-sep"></div>
    <div class="svge-cmd-group">
      {#each [['start', '⊣'], ['middle', '⊼'], ['end', '⊢']] as [val, icon]}
        <button class="svge-cmd-btn" class:active={tp.textAnchor === val}
          on:click={() => editor.setTextProp('textAnchor', val as TextProps['textAnchor'])} title="Anchor: {val}">{icon}</button>
      {/each}
    </div>
    <div class="svge-cmd-sep"></div>
    <span class="svge-cmd-hint">Click canvas to place · click text to edit · <kbd>Esc</kbd> or <kbd>Ctrl+Enter</kbd> to confirm</span>
  {/if}

  <!-- ── Pen ────────────────────────────────────────────────────────────── -->
  {#if $tool === 'pen'}
    <span class="svge-cmd-hint">
      Click = corner node · click-drag = smooth node · click the first node to close · <kbd>A</kbd> continues with arcs ·
      click an end of the selected open path to extend it · double-click / <kbd>Enter</kbd> / <kbd>Esc</kbd> to finish
    </span>
  {/if}

  <!-- ── Arc ─────────────────────────────────────────────────────────────── -->
  {#if $tool === 'arc'}
    <span class="svge-cmd-hint">
      Drag (or click) from one end to the other · move to bend, click · the next arc starts there · <kbd>Shift</kbd> = 15° ·
      <kbd>B</kbd> continues with the Pen · double-click / <kbd>Enter</kbd> / <kbd>Esc</kbd> to finish
    </span>
  {/if}

  <!-- ── Polygon / polyline ─────────────────────────────────────────────── -->
  {#if $tool === 'polygon'}
    <div class="svge-cmd-group">
      <button class="svge-cmd-pill" class:active={polygonClosed} on:click={() => ui.set({ polygonClosed: true })} title="Draw closed polygons">Polygon</button>
      <button class="svge-cmd-pill" class:active={!polygonClosed} on:click={() => ui.set({ polygonClosed: false })} title="Draw open polylines">Polyline</button>
    </div>
    <div class="svge-cmd-sep"></div>
    <span class="svge-cmd-hint">
      Click to add points ·
      {#if polygonClosed}click the first point or double-click to close{:else}double-click, <kbd>Enter</kbd> or <kbd>Esc</kbd> to finish{/if}
      · <kbd>Backspace</kbd> removes the last point
    </span>
  {/if}

  {#if $tool === 'blob'}
    <div class="svge-cmd-group">
      <input type="range" min="1" max="200" step="1" value={$ui.blobSize} class="svge-cmd-slider"
        on:input={e => ui.set({ blobSize: num(e) })} title="Brush size" aria-label="Brush size" />
      <input type="number" class="svge-cmd-num" min="1" max="200" value={$ui.blobSize}
        on:change={e => { const v = num(e); if (v >= 1) ui.set({ blobSize: Math.min(200, v) }); }} aria-label="Brush size in pixels" />
      <span class="svge-cmd-unit">px</span>
    </div>
    <div class="svge-cmd-sep"></div>
    <span class="svge-cmd-hint">Paint with the fill color · strokes merge with touching shapes of the same color</span>
  {/if}
  {#if $tool === 'scissors'}
    <span class="svge-cmd-hint">Drag across shapes to cut them · back to the start cuts out the loop · <kbd>Shift</kbd> straight cut · click an outline to split it there · cuts only the selection when there is one</span>
  {/if}
  {#if $tool === 'line'}
    <span class="svge-cmd-hint">Click and drag · <kbd>Shift</kbd> snaps to 45°</span>
  {/if}
  {#if $tool === 'rectangle'}
    <span class="svge-cmd-hint">Click and drag · <kbd>Shift</kbd> square · <kbd>Alt</kbd> from centre · Edit tool adjusts the corner radius</span>
  {/if}
  {#if $tool === 'ellipse'}
    <span class="svge-cmd-hint">Click and drag · <kbd>Shift</kbd> circle · <kbd>Alt</kbd> from centre</span>
  {/if}
  {#if $tool === 'freehand'}
    <span class="svge-cmd-hint">Click and drag to draw freely — the stroke is smoothed into a few editable nodes</span>
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

  .svge-cmd-btn.svge-cmd-zoom { width: 28px; }
  .svge-zoom-pill {
    padding: 0 2px; height: 26px; width: 45px; background: transparent; border: 1px solid var(--border-color);
    border-radius: 4px; color: var(--text-color); font-size: 0.75rem; font-family: monospace;
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

  /* fixed width: "5%" → "100%" must not push the buttons to the right */
  .svge-cmd-pct { display: inline-block; width: 5ch; text-align: right; font-variant-numeric: tabular-nums; }

  .svge-cmd-hint { font-size: 0.82rem; color: var(--text-color); opacity: 0.45; padding: 0 6px; white-space: nowrap; flex-shrink: 0; }
  .svge-cmd-hint kbd { background: var(--border-color); border-radius: 3px; padding: 1px 4px; font-size: 0.75rem; font-family: monospace; }

  .svge-cmd-pill {
    padding: 0 10px; height: 26px; background: transparent; border: 1px solid var(--border-color);
    border-radius: 4px; color: var(--text-color); font-size: 0.82rem; cursor: pointer;
    transition: background 0.12s; white-space: nowrap; flex-shrink: 0;
  }
  .svge-cmd-pill:hover  { background: var(--ruler-bg); }
  .svge-cmd-pill.active { background: var(--tool-active); border-color: var(--tool-border-active); }
</style>
