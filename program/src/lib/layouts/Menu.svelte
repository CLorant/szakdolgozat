<script lang="ts">
  /**
   * @file The menu bar: File, Edit, View, Object and Help. Only shortcuts that really work are shown. File operations
   * are in utils/fileActions.ts; this component calls them and shows their errors and warnings.
   */
  import { get } from 'svelte/store';
  import { ui } from '../stores/ui';
  import { editor, selectedShapes } from '../stores/editor';
  import { canUndo, canRedo, documentStore } from '../stores/document';
  import { notify, notifyError } from '../stores/notify';
  import { zoomTo, zoomBy, zoomFit, zoomToBox } from '../utils/zoom';
  import { copyFromMenu, pasteFromMenu } from '../utils/clipboardActions';
  import {
    newProject, openFile, saveProject, importFromPicker, exportSvg, exportRasterFile, dirty, type RasterExt,
  } from '../utils/fileActions';
  import { exportDialogOpen } from '../utils/exportSettings';
  import { helpDialogOpen } from '../stores/dialogs';
  import { BOOLEAN_LABEL } from '../utils/boolean';
  import { ALIGN_ACTIONS, BOOLEAN_ACTIONS } from '../utils/actionLists';
  import Icon from '../components/Icon.svelte';
  import { unionBounds, getWorldBounds } from '../utils/shapes';

  type MenuName = 'file' | 'edit' | 'view' | 'object';
  let openMenu: MenuName | null = null;

  const toggle = (n: MenuName) => { openMenu = openMenu === n ? null : n; };
  const close = () => { openMenu = null; };

  /** Closes the menu, runs the action, and turns any thrown Error into a toast. */
  function run(fn: () => unknown) {
    close();
    try {
      const r = fn();
      if (r instanceof Promise) r.catch(notifyError);
    } catch (e) { notifyError(e); }
  }

  function warnings(list: string[]) {
    if (list.length) notify(list.join('\n'), 'warn', 9000);
  }

  const handleNew = () => run(() => {
    if (get(dirty) && !confirm('Start a new drawing? Unsaved changes will be lost.')) return;
    newProject();
  });
  const handleOpen = () => run(async () => {
    if (get(dirty) && !confirm('Open another file? Unsaved changes will be lost.')) return;
    const r = await openFile();
    if (r) warnings(r.warnings);
  });
  const handleImport = () => run(async () => {
    const r = await importFromPicker();
    if (r) warnings(r.warnings);
  });

  const RASTER: Array<[RasterExt, string]> = [['png', 'PNG'], ['jpg', 'JPG'], ['webp', 'WebP']];
  const handleSvg = () => run(async () => warnings(await exportSvg()));
  const handleRaster = (fmt: RasterExt) => run(async () => {
    const r = await exportRasterFile(fmt);
    warnings(r.warnings);
  });

  const handleConvert = () => run(() => editor.convertToPath());

  $: hasSel = $selectedShapes.length > 0;
  $: convertible = editor.canConvertToPath($selectedShapes);
  $: strokable   = editor.canStrokeToPath($selectedShapes);
  $: groupable = $selectedShapes.length > 1;
  $: hasGroup = $selectedShapes.some(s => s.type === 'group');
  $: inGroup = $ui.groupPath.length > 0;
  $: combinable = editor.canBoolean($selectedShapes);

  /** The selection's on-canvas box, fitted into the window. */
  function zoomToSelection() {
    const b = unionBounds($selectedShapes.map(getWorldBounds));
    if (b) zoomToBox(b);
  }
  const BOOLEAN_OPS = BOOLEAN_ACTIONS.map(([op]) => op);
  const ALIGN = ALIGN_ACTIONS;

  /** Dropdown outside-click: ignore clicks inside the menubar itself. */
  function onWindowClick(e: MouseEvent) {
    if (!(e.target as Element | null)?.closest?.('.svge-menubar')) close();
  }
  function onWindowKey(e: KeyboardEvent) { if (e.key === 'Escape') close(); }
</script>

<svelte:window on:click={onWindowClick} on:keydown={onWindowKey} />

<nav class="svge-menubar" aria-label="Main menu">
  <!-- File -->
  <div class="svge-menu-item">
    <button class="svge-menu-btn" class:open={openMenu === 'file'} on:click={() => toggle('file')} aria-haspopup="menu" aria-expanded={openMenu === 'file'}>File</button>
    {#if openMenu === 'file'}
      <div class="svge-dropdown" role="menu">
        <button class="svge-dd-item" role="menuitem" on:click={handleNew}>New</button>
        <button class="svge-dd-item" role="menuitem" on:click={handleOpen}>Open… <span class="kbd">project or SVG</span></button>
        <button class="svge-dd-item" role="menuitem" on:click={() => run(() => saveProject())}>Save project <span class="kbd">Ctrl S</span></button>
        <div class="svge-dd-sep"></div>
        <button class="svge-dd-item" role="menuitem" on:click={handleImport}>Import… <span class="kbd">SVG or image</span></button>
        <div class="svge-dd-sep"></div>
        <button class="svge-dd-item" role="menuitem" on:click={() => run(() => { $exportDialogOpen = true; })}>Export options…</button>
        <button class="svge-dd-item" role="menuitem" on:click={handleSvg}>Export as SVG</button>
        {#each RASTER as [ext, name]}
          <button class="svge-dd-item" role="menuitem" on:click={() => handleRaster(ext)}>Export as {name}</button>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Edit -->
  <div class="svge-menu-item">
    <button class="svge-menu-btn" class:open={openMenu === 'edit'} on:click={() => toggle('edit')} aria-haspopup="menu" aria-expanded={openMenu === 'edit'}>Edit</button>
    {#if openMenu === 'edit'}
      <div class="svge-dropdown" role="menu">
        <button class="svge-dd-item" role="menuitem" disabled={!$canUndo} on:click={() => run(editor.undo)}>Undo <span class="kbd">Ctrl Z</span></button>
        <button class="svge-dd-item" role="menuitem" disabled={!$canRedo} on:click={() => run(editor.redo)}>Redo <span class="kbd">Ctrl Y</span></button>
        <div class="svge-dd-sep"></div>
        <button class="svge-dd-item" role="menuitem" disabled={!hasSel} on:click={() => run(() => copyFromMenu())}>Copy <span class="kbd">Ctrl C</span></button>
        <button class="svge-dd-item" role="menuitem" disabled={!hasSel} on:click={() => run(() => copyFromMenu(true))}>Cut <span class="kbd">Ctrl X</span></button>
        <button class="svge-dd-item" role="menuitem" on:click={() => run(() => pasteFromMenu())}>Paste <span class="kbd">Ctrl V</span></button>
        <button class="svge-dd-item" role="menuitem" disabled={!hasSel} on:click={() => run(editor.duplicate)}>Duplicate <span class="kbd">Ctrl D</span></button>
        <div class="svge-dd-sep"></div>
        <button class="svge-dd-item" role="menuitem" on:click={() => run(editor.selectAll)}>Select All <span class="kbd">Ctrl A</span></button>
        <button class="svge-dd-item" role="menuitem" disabled={!hasSel} on:click={() => run(editor.deselectAll)}>Deselect All <span class="kbd">Esc</span></button>
        <div class="svge-dd-sep"></div>
        <button class="svge-dd-item" role="menuitem" disabled={!hasSel} on:click={() => run(editor.deleteSelected)}>Delete <span class="kbd">Del</span></button>
      </div>
    {/if}
  </div>

  <!-- View -->
  <div class="svge-menu-item">
    <button class="svge-menu-btn" class:open={openMenu === 'view'} on:click={() => toggle('view')} aria-haspopup="menu" aria-expanded={openMenu === 'view'}>View</button>
    {#if openMenu === 'view'}
      <div class="svge-dropdown" role="menu">
        <button class="svge-dd-item" role="menuitem" on:click={() => run(() => zoomBy(1.25))}>Zoom in <span class="kbd">Ctrl +</span></button>
        <button class="svge-dd-item" role="menuitem" on:click={() => run(() => zoomBy(1 / 1.25))}>Zoom out <span class="kbd">Ctrl −</span></button>
        <button class="svge-dd-item" role="menuitem" on:click={() => run(() => zoomTo(1))}>Zoom 100% <span class="kbd">Ctrl 0</span></button>
        <button class="svge-dd-item" role="menuitem" on:click={() => run(zoomFit)}>Fit page to window</button>
        <button class="svge-dd-item" role="menuitem" disabled={!hasSel} on:click={() => run(zoomToSelection)}>Zoom to selection</button>
        <div class="svge-dd-sep"></div>
        <button class="svge-dd-item svge-dd-check" role="menuitemcheckbox" aria-checked={$ui.gridEnabled} on:click={() => run(() => ui.set({ gridEnabled: !$ui.gridEnabled }))}>
          <span class="svge-check">{$ui.gridEnabled ? '✓' : ''}</span> Grid
        </button>
        <button class="svge-dd-item svge-dd-check" role="menuitemcheckbox" aria-checked={$ui.snapEnabled} on:click={() => run(() => ui.set({ snapEnabled: !$ui.snapEnabled }))}>
          <span class="svge-check">{$ui.snapEnabled ? '✓' : ''}</span> Snap to grid
        </button>
        <button class="svge-dd-item svge-dd-check" role="menuitemcheckbox" aria-checked={$ui.snapObjects} on:click={() => run(() => ui.set({ snapObjects: !$ui.snapObjects }))}>
          <span class="svge-check">{$ui.snapObjects ? '✓' : ''}</span> Snap to objects &amp; guides
        </button>
        <button class="svge-dd-item svge-dd-check" role="menuitemcheckbox" aria-checked={$ui.guidesVisible} on:click={() => run(() => ui.set({ guidesVisible: !$ui.guidesVisible }))}>
          <span class="svge-check">{$ui.guidesVisible ? '✓' : ''}</span> Show guides
        </button>
        <button class="svge-dd-item" role="menuitem" disabled={!$documentStore.guides?.length} on:click={() => run(editor.clearGuides)}>Clear guides</button>
      </div>
    {/if}
  </div>

  <!-- Object: everything that changes the selected shapes as objects -->
  <div class="svge-menu-item">
    <button class="svge-menu-btn" class:open={openMenu === 'object'} on:click={() => toggle('object')} aria-haspopup="menu" aria-expanded={openMenu === 'object'}>Object</button>
    {#if openMenu === 'object'}
      <div class="svge-dropdown" role="menu">
        <div class="svge-dd-label">Arrange</div>
        <button class="svge-dd-item" role="menuitem" disabled={!hasSel} on:click={() => run(editor.bringToFront)}>Bring to Front <span class="kbd">Ctrl ]</span></button>
        <button class="svge-dd-item" role="menuitem" disabled={!hasSel} on:click={() => run(() => editor.moveUp())}>Bring Forward <span class="kbd">]</span></button>
        <button class="svge-dd-item" role="menuitem" disabled={!hasSel} on:click={() => run(() => editor.moveDown())}>Send Backward <span class="kbd">[</span></button>
        <button class="svge-dd-item" role="menuitem" disabled={!hasSel} on:click={() => run(editor.sendToBack)}>Send to Back <span class="kbd">Ctrl [</span></button>
        <div class="svge-dd-sep"></div>
        <div class="svge-dd-label">Align <small>(2 or more)</small></div>
        <div class="svge-dd-icons" role="group" aria-label="Align">
          {#each ALIGN as [axis, icon, title]}
            <button class="svge-dd-icon" role="menuitem" {title} aria-label={title} disabled={!groupable} on:click={() => run(() => editor.align(axis))}>{icon}</button>
          {/each}
        </div>
        <button class="svge-dd-item" role="menuitem" disabled={!hasSel} on:click={() => run(() => editor.flip('h'))}>Flip Horizontal</button>
        <button class="svge-dd-item" role="menuitem" disabled={!hasSel} on:click={() => run(() => editor.flip('v'))}>Flip Vertical</button>
        <div class="svge-dd-sep"></div>
        <div class="svge-dd-label">Group</div>
        <button class="svge-dd-item" role="menuitem" disabled={!groupable} on:click={() => run(editor.group)}>Group <span class="kbd">Ctrl G</span></button>
        <button class="svge-dd-item" role="menuitem" disabled={!hasGroup} on:click={() => run(editor.ungroup)}>Ungroup <span class="kbd">Ctrl Shift G</span></button>
        <button class="svge-dd-item" role="menuitem" disabled={!inGroup} on:click={() => run(editor.exitGroup)}>Exit Group <span class="kbd">Esc</span></button>
        <div class="svge-dd-sep"></div>
        <div class="svge-dd-label">Combine</div>
        {#each BOOLEAN_OPS as op}
          <button class="svge-dd-item" role="menuitem" disabled={!combinable} on:click={() => run(() => editor.booleanOp(op))}>
            <span class="svge-dd-with-icon"><Icon name={op} size={16} alt="" />{BOOLEAN_LABEL[op]}</span>
          </button>
        {/each}
        <div class="svge-dd-sep"></div>
        <div class="svge-dd-label">Path</div>
        <button class="svge-dd-item" role="menuitem" disabled={!convertible} on:click={handleConvert}>Shape to Path</button>
        <button class="svge-dd-item" role="menuitem" disabled={!strokable} on:click={() => run(() => editor.strokeToPath())}>Stroke to Path</button>
      </div>
    {/if}
  </div>

  <!-- Help: a dialog, not a menu -->
  <div class="svge-menu-item">
    <button class="svge-menu-btn" on:click={() => run(() => helpDialogOpen.set(true))} aria-haspopup="dialog">Help</button>
  </div>
</nav>

<style>
  .svge-menubar {
    display: flex;
    align-items: center;
    gap: 1px;
    padding: 0 4px;
  }

  .svge-menu-item {
    position: relative;
  }

  .svge-menu-btn {
    padding: 0 10px;
    height: 36px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    color: var(--text-color);
    cursor: pointer;
    font-size: 0.875rem;
    transition: background 0.12s;
    white-space: nowrap;
  }


  .svge-menu-btn:hover,
  .svge-menu-btn.open {
    background: var(--ruler-bg);
    border-color: var(--border-color);
  }

  .svge-dropdown {
    position: absolute;
    top: calc(100% + 2px);
    left: 0;
    min-width: 210px;
    background: var(--bg-color);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
    z-index: 2000;
    padding: 4px 0;
  }

  @media (max-width: 640px) {
    .svge-menu-btn { padding: 0 6px; }   /* the theme toggle must stay on screen */
    /* A dropdown under "Object" would run off a phone screen: pinned to the left edge instead, and scrollable */
    .svge-dropdown { position: fixed; top: 38px; left: 8px; width: min(300px, calc(100vw - 16px)); max-height: calc(100vh - 50px); overflow-y: auto; }
  }
</style>
