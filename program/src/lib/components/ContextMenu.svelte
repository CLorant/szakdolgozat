<script lang="ts">
  /**
   * @file The canvas context menu (right-click, or a long press on a touch screen). It offers what applies to the
   * selection under the pointer, and nothing that does not: on empty canvas Paste, Select All and the view; on shapes
   * the edit, arrange, group, combine, align and path actions. Every item also lives in the menu bar or the command
   * bar, so the menu is a shortcut, never the only way.
   */
  import { tick } from 'svelte';
  import { contextMenu } from '../stores/interaction';
  import { ui } from '../stores/ui';
  import { editor, selectedShapes } from '../stores/editor';
  import { documentStore } from '../stores/document';
  import { notifyError } from '../stores/notify';
  import { copyFromMenu, pasteFromMenu } from '../utils/clipboardActions';
  import { zoomTo, zoomFit } from '../utils/zoom';
  import { BOOLEAN_LABEL } from '../utils/boolean';
  import { ALIGN_ACTIONS, BOOLEAN_ACTIONS } from '../utils/actionLists';
  import Icon from './Icon.svelte';

  let el: HTMLDivElement | undefined;
  let left = 0, top = 0;

  $: menu = $contextMenu;
  $: sel = $selectedShapes;
  $: many = sel.length > 1;
  $: single = sel.length === 1 ? sel[0] : null;
  $: hasGroup = sel.some(s => s.type === 'group');
  $: inGroup = $ui.groupPath.length > 0;
  $: combinable = editor.canBoolean(sel);
  $: convertible = editor.canConvertToPath(sel);
  $: strokable = editor.canStrokeToPath(sel);
  // re-read when the document changes (a lock can come from the Objects panel while the menu is closed)
  $: anyLocked = !!$documentStore && editor.hasLocked();

  // Open at the pointer, then keep the whole menu on screen (flip up / left near the edges).
  $: if (menu) void place(menu.x, menu.y);
  async function place(x: number, y: number) {
    left = x; top = y;
    await tick();
    if (!el) return;
    const r = el.getBoundingClientRect(), m = 6;
    left = x + r.width + m > window.innerWidth ? Math.max(m, x - r.width) : x;
    top = y + r.height + m > window.innerHeight ? Math.max(m, window.innerHeight - r.height - m) : y;
    el.focus({ preventScroll: true });            // keys work at once; the arrows then step through the items
  }

  const close = () => contextMenu.set(null);

  /** Closes the menu, runs the action, and turns any thrown Error into a toast. */
  function run(fn: () => unknown) {
    close();
    try {
      const r = fn();
      if (r instanceof Promise) r.catch(notifyError);
    } catch (e) { notifyError(e); }
  }
  const pasteHere = () => { const at = menu?.at; run(() => pasteFromMenu(at)); };

  function onWindowDown(e: PointerEvent) { if (menu && !el?.contains(e.target as Node)) close(); }
  function onKey(e: KeyboardEvent) {
    if (!menu) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {           // move between items
      e.preventDefault();
      const items = [...(el?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = i < 0 ? (e.key === 'ArrowDown' ? 0 : items.length - 1) : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }
  }
</script>

<svelte:window on:pointerdown|capture={onWindowDown} on:keydown|capture={onKey} on:resize={close} on:blur={close} />

{#if menu}
  <div class="svge-ctx" bind:this={el} role="menu" tabindex="-1" aria-label="Canvas menu" style="left:{left}px; top:{top}px"
    on:contextmenu|preventDefault>
    {#if sel.length}
      <button class="svge-dd-item" role="menuitem" on:click={() => run(() => copyFromMenu(true))}>Cut <span class="kbd">Ctrl X</span></button>
      <button class="svge-dd-item" role="menuitem" on:click={() => run(() => copyFromMenu())}>Copy <span class="kbd">Ctrl C</span></button>
      <button class="svge-dd-item" role="menuitem" on:click={pasteHere}>Paste</button>
      <button class="svge-dd-item" role="menuitem" on:click={() => run(editor.duplicate)}>Duplicate <span class="kbd">Ctrl D</span></button>
      <div class="svge-dd-sep"></div>
      <button class="svge-dd-item" role="menuitem" on:click={() => run(editor.bringToFront)}>Bring to Front <span class="kbd">Ctrl ]</span></button>
      <button class="svge-dd-item" role="menuitem" on:click={() => run(() => editor.moveUp())}>Bring Forward <span class="kbd">]</span></button>
      <button class="svge-dd-item" role="menuitem" on:click={() => run(() => editor.moveDown())}>Send Backward <span class="kbd">[</span></button>
      <button class="svge-dd-item" role="menuitem" on:click={() => run(editor.sendToBack)}>Send to Back <span class="kbd">Ctrl [</span></button>

      {#if many || hasGroup || inGroup}
        <div class="svge-dd-sep"></div>
        {#if many}<button class="svge-dd-item" role="menuitem" on:click={() => run(editor.group)}>Group <span class="kbd">Ctrl G</span></button>{/if}
        {#if hasGroup}<button class="svge-dd-item" role="menuitem" on:click={() => run(editor.ungroup)}>Ungroup <span class="kbd">Ctrl Shift G</span></button>{/if}
        {#if single?.type === 'group'}<button class="svge-dd-item" role="menuitem" on:click={() => run(() => editor.enterGroup(single.id))}>Enter Group <span class="kbd">Double-click</span></button>{/if}
        {#if inGroup}<button class="svge-dd-item" role="menuitem" on:click={() => run(editor.exitGroup)}>Exit Group <span class="kbd">Esc</span></button>{/if}
      {/if}

      {#if combinable}
        <div class="svge-dd-sep"></div>
        <div class="svge-dd-label">Combine</div>
        <div class="svge-dd-icons" role="group" aria-label="Combine">
          {#each BOOLEAN_ACTIONS as [op, title]}
            <button class="svge-dd-icon" role="menuitem" {title} aria-label={BOOLEAN_LABEL[op]} on:click={() => run(() => editor.booleanOp(op))}><Icon name={op} size={16} alt="" /></button>
          {/each}
        </div>
      {/if}
      {#if many}
        <div class="svge-dd-label">Align</div>
        <div class="svge-dd-icons" role="group" aria-label="Align">
          {#each ALIGN_ACTIONS as [axis, icon, title]}
            <button class="svge-dd-icon" role="menuitem" {title} aria-label={title} on:click={() => run(() => editor.align(axis))}>{icon}</button>
          {/each}
        </div>
      {/if}

      <div class="svge-dd-sep"></div>
      <div class="svge-ctx-pair">
        <button class="svge-dd-item" role="menuitem" on:click={() => run(() => editor.flip('h'))}>⇆ Flip H</button>
        <button class="svge-dd-item" role="menuitem" on:click={() => run(() => editor.flip('v'))}>⇅ Flip V</button>
      </div>
      <div class="svge-ctx-pair">
        <button class="svge-dd-item" role="menuitem" on:click={() => run(editor.lockSelected)}>Lock</button>
        <button class="svge-dd-item" role="menuitem" on:click={() => run(editor.hideSelected)}>Hide</button>
      </div>
      {#if convertible || strokable}
        {#if convertible}<button class="svge-dd-item" role="menuitem" on:click={() => run(() => editor.convertToPath())}>Shape to Path</button>{/if}
        {#if strokable}<button class="svge-dd-item" role="menuitem" on:click={() => run(() => editor.strokeToPath())}>Stroke to Path</button>{/if}
      {/if}
      <div class="svge-dd-sep"></div>
      <button class="svge-dd-item svge-ctx-danger" role="menuitem" on:click={() => run(editor.deleteSelected)}>Delete <span class="kbd">Del</span></button>
    {:else}
      <button class="svge-dd-item" role="menuitem" on:click={pasteHere}>Paste</button>
      <button class="svge-dd-item" role="menuitem" on:click={() => run(editor.selectAll)}>Select All <span class="kbd">Ctrl A</span></button>
      {#if inGroup}<button class="svge-dd-item" role="menuitem" on:click={() => run(editor.exitGroup)}>Exit Group <span class="kbd">Esc</span></button>{/if}
      {#if anyLocked}<button class="svge-dd-item" role="menuitem" on:click={() => run(editor.unlockAll)}>Unlock All</button>{/if}
      <div class="svge-dd-sep"></div>
      <button class="svge-dd-item" role="menuitem" on:click={() => run(zoomFit)}>Fit page to window</button>
      <button class="svge-dd-item" role="menuitem" on:click={() => run(() => zoomTo(1))}>Zoom 100% <span class="kbd">Ctrl 0</span></button>
      <div class="svge-dd-sep"></div>
      <button class="svge-dd-item svge-dd-check" role="menuitemcheckbox" aria-checked={$ui.gridEnabled} on:click={() => run(() => ui.set({ gridEnabled: !$ui.gridEnabled }))}>
        <span class="svge-check">{$ui.gridEnabled ? '✓' : ''}</span> Grid
      </button>
      <button class="svge-dd-item svge-dd-check" role="menuitemcheckbox" aria-checked={$ui.snapObjects} on:click={() => run(() => ui.set({ snapObjects: !$ui.snapObjects }))}>
        <span class="svge-check">{$ui.snapObjects ? '✓' : ''}</span> Snap to objects &amp; guides
      </button>
    {/if}
  </div>
{/if}

<style>
  .svge-ctx {
    position: fixed; z-index: 3000; min-width: 210px; max-height: calc(100vh - 12px); overflow-y: auto;
    padding: 4px 0; background: var(--bg-color); border: 1px solid var(--border-color); border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18); scrollbar-width: thin; outline: none;
  }
  /* Two short actions side by side (Flip H / Flip V, Lock / Hide): keeps the menu shorter */
  .svge-ctx-pair { display: flex; }
  .svge-ctx-pair > :global(.svge-dd-item) { flex: 1; justify-content: flex-start; }
  .svge-ctx-danger:hover { color: #e74c3c; }
</style>
