<script lang="ts">
  /**
   * @file The drawing tools (lib/tools/catalog.ts) and the Shift lock. A tool's letter selects it.
   */
  import { get } from 'svelte/store';
  import { ui, tool } from '../stores/ui';
  import { textEdit } from '../stores/interaction';
  import Icon from '../components/Icon.svelte';
  import { TOOLS, toolForKey } from '../tools/catalog';

  function onKeyDown(e: KeyboardEvent) {
    // Letters (optionally with Shift) only: never while typing, while the text editor is open, or with Ctrl/Alt/Meta.
    if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (get(textEdit)) return;
    const next = e.key.length === 1 ? toolForKey(e.key, e.shiftKey) : undefined;
    if (next) ui.selectTool(next);
  }
</script>

<svelte:window on:keydown={onKeyDown} />

<div class="svge-toolbar" role="toolbar" aria-label="Drawing tools">
  {#each TOOLS as t}
    <div class="svge-tool-wrap">
      <button
        class="svge-tool-btn"
        class:active={$tool === t.type}
        on:click={() => ui.selectTool(t.type)}
        title="{t.label} [{t.shortcut}]"
        aria-pressed={$tool === t.type}
      >
        <Icon name={t.icon} alt={t.label} />
      </button>
    </div>
    {#if t.groupEnd}
      <div class="svge-sep"></div>
    {/if}
  {/each}
  <div class="svge-sep"></div>
  <!-- A virtual Shift key: squares / circles, 45° lines, proportional resize and adding to the selection
       without a keyboard (touch screens). Also useful as a latch on desktop. -->
  <button
    class="svge-tool-btn svge-lock-btn"
    class:active={$ui.shiftLock}
    on:click={() => ui.set({ shiftLock: !$ui.shiftLock })}
    title="Shift lock — constrain proportions and angles, add to selection"
    aria-pressed={$ui.shiftLock}
    aria-label="Shift lock"
  >⇧</button>
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

    .svge-lock-btn { font-size: 1.15rem; color: var(--text-color); }
  .svge-sep {
    width: 28px;
    height: 1px;
    background: var(--border-color);
    margin: 3px 0;
  }
</style>
