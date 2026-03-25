<script lang="ts">
  import { editorStore } from '../stores/editorStore';
  import type { CurveSubType } from '../utils/types';

  let curveSubTool: CurveSubType = 'cubic-bezier';
  editorStore.subscribe(s => { curveSubTool = s.curveSubTool; });

  const options: Array<{ type: CurveSubType; label: string; desc: string; symbol: string }> = [
    { type: 'quadratic-bezier', label: 'Quad Bézier',  symbol: '∿', desc: '1 control point' },
    { type: 'cubic-bezier',     label: 'Cubic Bézier', symbol: '∾', desc: '2 control points' },
    { type: 'arc',              label: 'Arc',          symbol: '◜', desc: 'Elliptical arc' },
  ];
</script>

<div class="svge-curve-panel">
  <div class="svge-curve-header">Curve type</div>
  {#each options as opt}
    <button
      class="svge-curve-opt"
      class:active={curveSubTool === opt.type}
      on:click={() => editorStore.setCurveSubTool(opt.type)}
      title={opt.desc}
    >
      <span class="svge-curve-sym">{opt.symbol}</span>
      <span class="svge-curve-lbl">{opt.label}</span>
      <span class="svge-curve-sub">{opt.desc}</span>
    </button>
  {/each}

  <div class="svge-curve-hint">
    {#if curveSubTool === 'arc'}
      <strong>1.</strong> Click to place start point<br>
      <strong>2.</strong> Move cursor — arc + circle preview<br>
      <strong>3.</strong> Click to place end point<br>
      <strong>Repeat</strong> to chain segments · <kbd>Esc</kbd> to stop
    {:else if curveSubTool === 'quadratic-bezier'}
      <strong>1.</strong> Click to place start point<br>
      <strong>2.</strong> Click + drag to place end point<br>
      &nbsp;&nbsp;&nbsp;&nbsp;Drag pulls the control handle<br>
      <strong>Repeat</strong> to chain segments · <kbd>Esc</kbd> to stop
    {:else}
      <strong>1.</strong> Click to place start point<br>
      <strong>2.</strong> Click + drag to place end point<br>
      &nbsp;&nbsp;&nbsp;&nbsp;Drag pulls both control handles<br>
      <strong>Repeat</strong> to chain segments · <kbd>Esc</kbd> to stop
    {/if}
  </div>
</div>

<style>
  .svge-curve-panel {
    background: var(--bg-color);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    box-shadow: 0 6px 20px rgba(0,0,0,0.14);
    padding: 6px;
    min-width: 180px;
    user-select: none;
  }

  .svge-curve-header {
    font-size: 0.68rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--text-color);
    opacity: 0.5;
    padding: 2px 4px 6px;
  }

  .svge-curve-opt {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 8px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 5px;
    cursor: pointer;
    text-align: left;
    transition: background 0.12s;
  }

  .svge-curve-opt:hover  { background: var(--ruler-bg); }
  .svge-curve-opt.active { background: var(--tool-active); border-color: var(--tool-border-active); }

  .svge-curve-sym {
    font-size: 1.1rem;
    width: 22px;
    text-align: center;
    color: var(--text-color);
    flex-shrink: 0;
  }

  .svge-curve-lbl {
    font-size: 0.82rem;
    color: var(--text-color);
    flex: 1;
  }

  .svge-curve-sub {
    font-size: 0.68rem;
    color: var(--text-color);
    opacity: 0.4;
    white-space: nowrap;
  }

  .svge-curve-hint {
    font-size: 0.7rem;
    color: var(--text-color);
    opacity: 0.55;
    padding: 8px 4px 2px;
    line-height: 1.7;
    border-top: 1px solid var(--border-color);
    margin-top: 4px;
  }

  .svge-curve-hint strong {
    color: var(--accent-color);
    opacity: 1;
  }

  .svge-curve-hint kbd {
    background: var(--border-color);
    border-radius: 3px;
    padding: 1px 4px;
    font-size: 0.68rem;
    font-family: monospace;
  }
</style>