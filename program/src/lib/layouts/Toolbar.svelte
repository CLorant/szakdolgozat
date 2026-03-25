<script lang="ts">
  import { editorStore } from '../stores/editorStore';
  import type { ToolType } from '../utils/types';

  let selectedTool: ToolType = 'transform';
  let showCurvePanel = false;

  editorStore.subscribe(s => { selectedTool = s.selectedTool; });

  const iconPath = 'src/assets/icons/';

  const tools: Array<{ type: ToolType; label: string; icon: string; shortcut?: string }> = [
    { type: 'transform', label: 'Transform',   icon: 'pointer', shortcut: 'V' },
    { type: 'edit',      label: 'Edit Nodes',  icon: 'edit', shortcut: 'E' },
    { type: 'line',      label: 'Line',        icon: 'line', shortcut: 'L' },
    { type: 'freehand',  label: 'Freehand',    icon: 'freehand', shortcut: 'F' },
    { type: 'curve',     label: 'Curve',       icon: 'placeholder', shortcut: 'B' },
    { type: 'rectangle', label: 'Rectangle',   icon: 'square', shortcut: 'R' },
    { type: 'ellipse',   label: 'Ellipse',     icon: 'circle', shortcut: 'O' },
    { type: 'polygon',   label: 'Polygon',     icon: 'polygon', shortcut: 'P' },
    { type: 'text',      label: 'Text',        icon: 'text', shortcut: 'T' },
    { type: 'zoom',      label: 'Zoom',        icon: 'placeholder', shortcut: 'Z' },
  ];

  // Keyboard shortcuts
  function onKeyDown(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const map: Record<string, ToolType> = {
      v:'transform', e:'edit', t:'text', l:'line', r:'rectangle',
      o:'ellipse', p:'polygon', f:'freehand', b:'curve', z:'zoom'
    };
    const tool = map[e.key.toLowerCase()];
    if (tool) editorStore.selectTool(tool);
  }
</script>

<svelte:window on:keydown={onKeyDown} />

<div class="svge-toolbar" role="toolbar" aria-label="Drawing tools">
  {#each tools as t}
    <div class="svge-tool-wrap">
      <button
        class="svge-tool-btn"
        class:active={selectedTool === t.type}
        on:click={() => {
          editorStore.selectTool(t.type);
          if (t.type === 'curve') showCurvePanel = !showCurvePanel;
          else showCurvePanel = false;
        }}
        title="{t.label}{t.shortcut ? ` [${t.shortcut}]` : ''}"
        aria-pressed={selectedTool === t.type}
      >
        <img
			src="{iconPath + t.icon}.svg"
			alt={t.label}
			class="icon"
			on:error={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
		/>
      </button>
      <!-- Curve sub-tool badge -->
      {#if t.type === 'curve' && selectedTool === 'curve'}
        <span class="svge-curve-badge" title="Curve sub-tool active">•</span>
      {/if}
    </div>

    <!-- Separator after edit-nodes and text groups -->
    {#if t.type === 'edit' || t.type === 'text' || t.type === 'freehand'}
      <div class="svge-sep"></div>
    {/if}
  {/each}
</div>

<style>
  .svge-toolbar {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 4px 3px;
    gap: 1px;
    width: 100%;
  }

  .svge-tool-wrap {
    position: relative;
    width: 42px;
  }

  .svge-tool-btn {
    width: 42px;
    height: 42px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.12s;
    padding: 0;
  }

  .svge-tool-btn:hover {
    background: var(--ruler-bg);
    border-color: var(--border-color);
  }

  .svge-tool-btn.active {
    background: var(--tool-active);
    border-color: var(--tool-border-active);
  }

  .svge-curve-badge {
    position: absolute;
    bottom: 2px;
    right: 3px;
    font-size: 0.65rem;
    color: var(--tool-border-active);
    pointer-events: none;
  }

  .svge-sep {
    width: 28px;
    height: 1px;
    background: var(--border-color);
    margin: 3px 0;
  }
</style>