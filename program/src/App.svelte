<script lang="ts">
  /**
   * @file The application shell: menu, command bar, toolbars, the drawing area with rulers, the property panel and the dialogs.
   */
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import Toolbar       from './lib/layouts/Toolbar.svelte';
  import Canvas        from './lib/layouts/Canvas.svelte';
  import PropertyBar   from './lib/layouts/PropertyBar.svelte';
  import PropertyPanel from './lib/layouts/PropertyPanel.svelte';
  import Menu          from './lib/layouts/Menu.svelte';
  import CommandBar    from './lib/layouts/CommandBar.svelte';
  import Rulers        from './lib/components/Rulers.svelte';
  import ThemeToggle   from './lib/components/ThemeToggle.svelte';
  import Toasts        from './lib/components/Toasts.svelte';
  import ExportDialog  from './lib/components/ExportDialog.svelte';
  import HelpDialog    from './lib/components/HelpDialog.svelte';
  import ContextMenu   from './lib/components/ContextMenu.svelte';
  import { viewport, CANVAS_PADDING, RULER_SIZE } from './lib/stores/viewport';
  import { notify, notifyError } from './lib/stores/notify';
  import { startAutosave, autosaveState, dirty } from './lib/utils/project';
  import { restoreAutosave, saveProject } from './lib/utils/fileActions';
  import { registerScrollArea, zoomBy, zoomTo, panBy } from './lib/utils/zoom';
  import { initFonts } from './lib/fonts/state';
  import { startFontSync } from './lib/fonts/sync';
  import { onCopyEvent, onPasteEvent, onDropFiles } from './lib/utils/clipboardActions';

  let areaEl: HTMLElement;   // the drawing area (no scrollbars: the view is an offset, see utils/zoom.ts)
  let colEl: HTMLElement;    // canvas column (receives wheel events)

  onMount(() => {
    registerScrollArea(areaEl);

    // Ctrl/⌘ + wheel zooms around the pointer; the plain wheel pans (Shift: sideways). A NON-passive listener,
    // so the browser's own page zoom and scrolling can be cancelled (Svelte's on:wheel is passive).
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) { zoomBy(Math.min(1.25, Math.max(0.8, Math.exp(-e.deltaY * 0.0015))), { x: e.clientX, y: e.clientY }); return; }
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? areaEl.clientHeight : 1;   // lines / pages → px
      const dx = e.deltaX * unit, dy = e.deltaY * unit;
      if (e.shiftKey && !dx) panBy(dy, 0); else panBy(dx, dy);
    };
    colEl.addEventListener('wheel', onWheel, { passive: false });

    // Restore the previous session BEFORE autosave starts (so it can't be overwritten by an empty doc).
    try { restoreAutosave(); } catch (e) { notifyError(e); }
    const stopAutosave = startAutosave();
    void initFonts();                                 // Google catalog (cached) + local fonts if already allowed
    const stopFontSync = startFontSync();             // loads the Google fonts the document uses
    const unsubAuto = autosaveState.subscribe(s => { if (s.status === 'error' && s.message) notify(s.message, 'warn', 9000); });

    const onBeforeUnload = (e: BeforeUnloadEvent) => { if (get(dirty)) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      colEl.removeEventListener('wheel', onWheel);
      window.removeEventListener('beforeunload', onBeforeUnload);
      stopAutosave(); unsubAuto(); stopFontSync(); registerScrollArea(null);
    };
  });

  function onKeyDown(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.key === 's') { e.preventDefault(); try { saveProject(); } catch (err) { notifyError(err); } }
    else if (e.key === '0') { e.preventDefault(); zoomTo(1); }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(1.25); }
    else if (e.key === '-') { e.preventDefault(); zoomBy(1 / 1.25); }
  }

  // Middle-mouse: stop the browser's autoscroll cursor.
  const onMouseDown = (e: MouseEvent) => { if (e.button === 1) e.preventDefault(); };
</script>

<svelte:window on:keydown={onKeyDown} on:copy={e => onCopyEvent(e, false)} on:cut={e => onCopyEvent(e, true)} on:paste={onPasteEvent} />

<div class="svge-app" style="--ruler:{RULER_SIZE}px">
  <header class="svge-topbar">
    <div class="svge-topbar-left">
      <div class="logo-wrapper">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 439 98"
          height="20px"
          ><path
            d="m140.45 21.05 22.75 46.2-25.87 1.14Zm-34.32 27.57c0 10.92-6.82 19.77-15.23 19.77s-15.23-8.85-15.23-19.77 6.82-19.78 15.23-19.78 15.23 8.86 15.23 19.78ZM20.25 63.65l32.2-30.7L37.1 25.9l-9.82 10.56 21.12 19.4-2.7 16.46Zm191.98 3.96.37-40.59 23.12 3.32 5.78 26.69-12.91 13.04Zm66.03-3.96 32.2-30.7-15.34-7.05-9.83 10.56 21.13 19.4-2.7 16.46Zm50.89-42.6h28.34l-14.03 46.74Zm67.22 24.78 18.19-12.94-11.37-6.99-19.37 8.56V61.6l13.49 10.72 13.72-3.93-.94-15.58Z"
            fill="gray"
            stroke="gray"
            stroke-width=".5"
            stroke-linecap="round"
            stroke-linejoin="bevel"
          /><path
            d="M56.64 61.43c0 3.3-.81 6.18-2.44 8.64-1.62 2.47-3.97 4.37-7.03 5.7-3.07 1.34-6.8 2.01-11.21 2.01-1.93 0-3.83-.14-5.69-.4s-3.65-.64-5.35-1.14c-1.7-.49-3.31-1.11-4.83-1.84V63.31c2.67 1.16 5.43 2.22 8.29 3.19s5.7 1.45 8.53 1.45c1.94 0 3.5-.26 4.67-.79 1.18-.52 2.05-1.23 2.6-2.12s.82-1.91.82-3.06c0-1.42-.48-2.62-1.45-3.62s-2.27-1.93-3.89-2.79q-2.445-1.305-5.58-2.79c-1.31-.63-2.73-1.38-4.25-2.24-1.52-.87-2.97-1.94-4.36-3.22q-2.085-1.935-3.42-4.68c-.89-1.84-1.34-4.04-1.34-6.6 0-3.36.78-6.23 2.32-8.61 1.55-2.39 3.75-4.21 6.61-5.46 2.85-1.26 6.22-1.89 10.1-1.89q4.395 0 8.37 1.02c2.65.68 5.41 1.65 8.29 2.91l-3.85 9.27c-2.57-1.04-4.87-1.86-6.92-2.43-2.04-.58-4.14-.87-6.29-.87-1.46 0-2.72.24-3.77.71s-1.85 1.13-2.4 1.97c-.55.83-.82 1.83-.82 2.98 0 1.31.39 2.43 1.18 3.34q1.17 1.38 3.54 2.64c1.57.84 3.53 1.83 5.89 2.98 2.88 1.37 5.33 2.78 7.35 4.25q3.03 2.205 4.68 5.19c1.1 1.99 1.65 4.45 1.65 7.39m60.92-12.58c0 4.35-.54 8.29-1.61 11.83-1.08 3.54-2.7 6.59-4.88 9.16-2.17 2.56-4.94 4.53-8.29 5.89s-7.34 2.05-11.95 2.05c-4.56 0-8.53-.69-11.91-2.05s-6.15-3.33-8.33-5.89c-2.17-2.57-3.8-5.62-4.87-9.16-1.08-3.54-1.61-7.51-1.61-11.91 0-5.82.95-10.87 2.86-15.17 1.92-4.3 4.85-7.64 8.81-10.02 3.96-2.39 9-3.58 15.13-3.58 6.08 0 11.1 1.19 15.05 3.58 3.96 2.38 6.88 5.73 8.77 10.06 1.89 4.32 2.83 9.39 2.83 15.21m-40.8 0c0 3.88.49 7.23 1.46 10.06s2.5 4.99 4.59 6.49c2.1 1.49 4.77 2.24 8.02 2.24 3.36 0 6.07-.75 8.14-2.24 2.07-1.5 3.57-3.66 4.52-6.49.94-2.83 1.41-6.18 1.41-10.06 0-5.87-1.07-10.48-3.22-13.84-2.15-3.35-5.74-5.03-10.77-5.03q-4.95 0-8.1 2.28c-2.09 1.52-3.62 3.68-4.59 6.49-.97 2.8-1.46 6.17-1.46 10.1m51.88 28.14V20.86h12.03v46.23h22.72v9.9Zm58.55 0-12.28-.25.25-56 12.28-.25Zm62.58-29.01c0 6.45-1.2 11.82-3.61 16.12s-5.8 7.52-10.18 9.67-9.6 3.22-15.68 3.22h-17.14V20.86h18.55c5.92 0 10.97 1.04 15.13 3.11 4.17 2.07 7.37 5.12 9.59 9.16 2.23 4.03 3.34 8.98 3.34 14.85m-12.57.48q0-6.06-1.77-9.99t-5.31-5.85c-2.35-1.29-5.26-1.93-8.72-1.93h-6.21v36.4h5.03c5.76 0 10.03-1.55 12.81-4.64s4.17-7.76 4.17-13.99m77.43 12.97c0 3.3-.82 6.18-2.44 8.64-1.63 2.47-3.97 4.37-7.04 5.7-3.06 1.34-6.8 2.01-11.2 2.01-1.94 0-3.84-.14-5.7-.4a37 37 0 0 1-5.34-1.14c-1.71-.49-3.32-1.11-4.84-1.84V63.31c2.68 1.16 5.44 2.22 8.3 3.19 2.85.97 5.7 1.45 8.53 1.45 1.93 0 3.49-.26 4.67-.79 1.18-.52 2.05-1.23 2.6-2.12s.82-1.91.82-3.06c0-1.42-.48-2.62-1.45-3.62s-2.27-1.93-3.89-2.79q-2.445-1.305-5.58-2.79c-1.31-.63-2.73-1.38-4.25-2.24-1.52-.87-2.97-1.94-4.36-3.22q-2.085-1.935-3.42-4.68c-.89-1.84-1.34-4.04-1.34-6.6 0-3.36.78-6.23 2.32-8.61q2.325-3.585 6.6-5.46 4.29-1.89 10.11-1.89 4.395 0 8.37 1.02c2.64.68 5.41 1.65 8.29 2.91l-3.85 9.27c-2.57-1.04-4.88-1.86-6.92-2.43-2.04-.58-4.14-.87-6.29-.87-1.47 0-2.72.24-3.77.71s-1.85 1.13-2.4 1.97c-.55.83-.82 1.83-.82 2.98 0 1.31.39 2.43 1.18 3.34.78.92 1.96 1.8 3.53 2.64s3.54 1.83 5.9 2.98c2.88 1.37 5.33 2.78 7.35 4.25s3.57 3.2 4.67 5.19c1.11 1.99 1.66 4.45 1.66 7.39m54.23-40.57-19.1 56.13h-12.97l-19.02-56.13h12.03l10.53 33.41c.21.58.51 1.64.9 3.19.4 1.54.8 3.17 1.22 4.87s.71 3.13.87 4.28c.15-1.15.43-2.58.82-4.28.4-1.7.8-3.33 1.22-4.87.42-1.55.71-2.61.87-3.19l10.61-33.41Zm27.6 24.61h22.24v29.08c-2.93 1-5.99 1.78-9.16 2.36s-6.77.87-10.81.87c-5.55 0-10.28-1.1-14.18-3.31-3.91-2.2-6.87-5.45-8.89-9.74-2.01-4.3-3.02-9.59-3.02-15.88 0-5.87 1.14-10.95 3.42-15.25s5.59-7.63 9.94-9.98q6.525-3.54 15.96-3.54c2.98 0 5.92.31 8.8.94q4.32.945 7.86 2.52l-3.93 9.51c-1.73-.89-3.69-1.63-5.89-2.2-2.2-.58-4.51-.87-6.92-.87-3.46 0-6.46.79-9 2.36s-4.51 3.79-5.9 6.64c-1.39 2.86-2.08 6.23-2.08 10.1 0 3.67.5 6.92 1.49 9.75 1 2.83 2.57 5.05 4.72 6.64 2.15 1.6 4.95 2.4 8.41 2.4 1.68 0 3.11-.08 4.28-.23 1.18-.16 2.27-.34 3.27-.55V55.37h-10.61Z"
            style="fill:var(--text-color)"
          /></svg
        >
      </div>
      <Menu />
    </div>
    <ThemeToggle />
  </header>

  <CommandBar />

  <div class="svge-workspace">
    <aside class="svge-sidebar svge-sidebar-left"><Toolbar /></aside>

    <!-- Canvas column: 2×2 grid — corner · horizontal ruler / vertical ruler · scroll area -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="svge-canvas-col" bind:this={colEl} on:mousedown={onMouseDown}
      on:dragover={e => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); }} on:drop={onDropFiles}>
      <div class="svge-ruler-corner" aria-hidden="true"></div>
      <Rulers />
      <div class="svge-scroll-area" bind:this={areaEl}>
        <div class="svge-canvas-scroll-inner" style="padding:{CANVAS_PADDING}px; transform:translate({-$viewport.scrollLeft}px, {-$viewport.scrollTop}px)">
          <Canvas />
        </div>
      </div>
    </div>

    <div class="svge-right-dock">
      <PropertyPanel />
      <PropertyBar />
    </div>
  </div>
</div>

<ExportDialog />
<HelpDialog />
<ContextMenu />
<Toasts />

<style>
  :global(*), :global(*::before), :global(*::after) { box-sizing: border-box; }
  :global(html), :global(body) { margin: 0; padding: 0; height: 100%; overflow: hidden; }
  :global(#app) { height: 100%; }

  .svge-app { display: flex; flex-direction: column; height: 100vh; overflow: hidden; background: var(--toolbar-bg); }

  .svge-topbar {
    display: flex; align-items: center; justify-content: space-between; height: 36px;
    border-bottom: 1px solid var(--border-color); background: var(--toolbar-bg); flex-shrink: 0;
  }
  .svge-topbar-left { display: flex; align-items: center; }

  .logo-wrapper {
    display: flex;
    align-items: center;
    padding: 0 8px;
  }
  @media (max-width: 400px) { .logo-wrapper svg { height: 15px; width: auto; } .logo-wrapper { padding: 0 4px 0 8px; } }

  .svge-workspace { display: flex; flex: 1; overflow: hidden; position: relative; }

  .svge-sidebar-left {
    width: 48px; border-right: 1px solid var(--border-color); background: var(--toolbar-bg);
    flex-shrink: 0; overflow-y: auto; overflow-x: hidden;
  }

  .svge-canvas-col {
    flex: 1; min-width: 0; overflow: hidden; display: grid;
    grid-template-columns: var(--ruler) 1fr; grid-template-rows: var(--ruler) 1fr;
  }
  .svge-ruler-corner {
    grid-column: 1; grid-row: 1; background: var(--toolbar-header);
    border-right: 1px solid var(--border-color); border-bottom: 1px solid var(--border-color); z-index: 2;
  }
  :global(.svge-ruler-h) { grid-column: 2; grid-row: 1; }
  :global(.svge-ruler-v) { grid-column: 1; grid-row: 2; }

  .svge-scroll-area { grid-column: 2; grid-row: 2; overflow: hidden; position: relative; touch-action: none; }

  /* Positioned by the view offset; it can move anywhere, so the area never shows scrollbars. */
  .svge-canvas-scroll-inner { position: absolute; left: 0; top: 0; will-change: transform; }

  .svge-right-dock { display: flex; flex-direction: row; flex-shrink: 0; border-left: 1px solid var(--border-color); overflow: visible; }

  /* Narrow screens: tools left, tabs right, and the property panel as a sheet under the drawing area. The dock
     dissolves (display: contents) so the panel and the tab strip become cells of the workspace grid. */
  @media (max-width: 640px) {
    .svge-workspace { display: grid; grid-template-columns: 48px minmax(0, 1fr) 48px; grid-template-rows: minmax(0, 1fr) auto; }
    .svge-sidebar-left { grid-column: 1; grid-row: 1 / 3; }
    .svge-canvas-col { grid-column: 2; grid-row: 1; }
    .svge-right-dock { display: contents; }
    .svge-right-dock > :global(.svge-panel-slot) { grid-column: 2; grid-row: 2; }
    .svge-right-dock > :global(.svge-propbar-root) { grid-column: 3; grid-row: 1 / 3; border-left: 1px solid var(--border-color); }
  }
</style>
