<script lang="ts">
  import { onMount, tick }  from 'svelte';
  import Toolbar        from './lib/layouts/Toolbar.svelte';
  import Canvas         from './lib/layouts/Canvas.svelte';
  import PropertyBar    from './lib/layouts/PropertyBar.svelte';
  import PropertyPanel  from './lib/layouts/PropertyPanel.svelte';
  import Rulers         from './lib/components/Rulers.svelte';
  import ThemeToggle    from './lib/components/ThemeToggle.svelte';
  import Menu           from './lib/layouts/Menu.svelte';
  import CommandBar     from './lib/layouts/CommandBar.svelte';
  import CurveToolPanel from './lib/components/CurvePanel.svelte';
  import { editorStore } from './lib/stores/editorStore';

  // ── DOM refs ──────────────────────────────────────────────────────────────
  let canvasAreaEl: HTMLElement; // the overflow:auto scroll container
  let svgWrapEl:    HTMLElement; // wraps the Canvas component

  // ── Ruler state (passed as props to Rulers) ───────────────────────────────
  const PADDING_H = 60; // matches .svge-canvas-scroll-inner padding-left
  const PADDING_V = 60; // matches .svge-canvas-scroll-inner padding-top

  let rulerScrollLeft = 0;
  let rulerScrollTop  = 0;

  // ── Zoom ──────────────────────────────────────────────────────────────────
  let zoom = 1;
  let selectedTool = 'transform';
  editorStore.subscribe(s => { zoom = s.zoom; selectedTool = s.selectedTool; });

  function handleWheel(e: WheelEvent) {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();

    // Measure cursor offset within the scroll area
    const rect   = canvasAreaEl.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const factor  = e.deltaY < 0 ? 1.1 : 0.9;
    const newZoom = Math.min(Math.max(0.05, zoom * factor), 20);

    // The scroll-content point under the cursor (in content px, pre-zoom)
    // must remain under the cursor after zoom is applied.
    const cpxX = (canvasAreaEl.scrollLeft + mouseX) / zoom;
    const cpxY = (canvasAreaEl.scrollTop  + mouseY) / zoom;

    editorStore.setZoom(newZoom);

    tick().then(() => {
      canvasAreaEl.scrollLeft = cpxX * newZoom - mouseX;
      canvasAreaEl.scrollTop  = cpxY * newZoom - mouseY;
      rulerScrollLeft = canvasAreaEl.scrollLeft;
      rulerScrollTop  = canvasAreaEl.scrollTop;
      editorStore.setCanvasScroll(rulerScrollLeft, rulerScrollTop);
    });
  }

  // ── Middle-mouse pan: prevent the browser autoscroll cursor ──────────────
  function handleMouseDown(e: MouseEvent) {
    if (e.button === 1) e.preventDefault();
  }

  onMount(() => {
    function onScroll() {
      rulerScrollLeft = canvasAreaEl.scrollLeft;
      rulerScrollTop  = canvasAreaEl.scrollTop;
      editorStore.setCanvasScroll(rulerScrollLeft, rulerScrollTop);
    }
    canvasAreaEl.addEventListener('scroll', onScroll, { passive: true });
    return () => canvasAreaEl.removeEventListener('scroll', onScroll);
  });
</script>

<div class="svge-app">
  <!-- ── Top bar ──────────────────────────────────────────────────────────── -->
  <header class="svge-topbar">
    <div class="svge-topbar-left">
      <span class="svge-logo">SVG Editor</span>
      <Menu />
    </div>
    <ThemeToggle />
  </header>

  <!-- ── Command / context bar ─────────────────────────────────────────────── -->
  <CommandBar />

  <!-- ── Main workspace ────────────────────────────────────────────────────── -->
  <div class="svge-workspace">
    <!-- Left toolbar -->
    <aside class="svge-sidebar svge-sidebar-left">
      <Toolbar />
    </aside>

    <!-- Curve tool floating panel, anchored to toolbar -->
    {#if selectedTool === 'curve'}
      <div class="svge-curve-float">
        <CurveToolPanel />
      </div>
    {/if}

    <!-- Canvas column: rulers + scrollable area in a 2×2 sub-grid -->
    <div class="svge-canvas-col" on:wheel={handleWheel} on:mousedown={handleMouseDown}>

      <!-- Row 1: corner + horizontal ruler -->
      <div class="svge-ruler-corner" aria-hidden="true"></div>
      <Rulers
        scrollLeft={rulerScrollLeft}
        scrollTop={rulerScrollTop}
        paddingLeft={PADDING_H}
        paddingTop={PADDING_V}
      />

      <!-- Row 2: vertical ruler + scroll area -->
      <!-- (Rulers.svelte renders BOTH h and v rulers; the grid places them) -->

      <!-- Scrollable canvas content -->
      <div
        class="svge-scroll-area"
        bind:this={canvasAreaEl}
      >
        <div class="svge-canvas-scroll-inner">
          <div bind:this={svgWrapEl}>
            <Canvas canvasAreaEl={canvasAreaEl} />
          </div>
        </div>
      </div>
    </div>

    <!-- Right: Property panel + Property bar -->
    <div class="svge-right-dock">
      <PropertyPanel />
      <PropertyBar />
    </div>
  </div>
</div>

<style>
  :global(*), :global(*::before), :global(*::after) { box-sizing: border-box; }
  :global(html), :global(body) { margin:0; padding:0; height:100%; overflow:hidden; }
  :global(#app) { height:100%; }

  .svge-app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
    background: var(--toolbar-bg);
  }

  /* ── Top bar ───────────────────────────────────────────────────── */
  .svge-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 36px;
    border-bottom: 1px solid var(--border-color);
    background: var(--toolbar-bg);
    flex-shrink: 0;
  }

  .svge-topbar-left {
    display: flex;
    align-items: center;
  }

  .svge-logo {
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    padding: 0 10px;
    opacity: 0.55;
    color: var(--text-color);
    user-select: none;
    white-space: nowrap;
  }

  /* ── Workspace ─────────────────────────────────────────────────── */
  .svge-workspace {
    display: flex;
    flex: 1;
    overflow: hidden;
    position: relative;
  }

  /* ── Left sidebar ──────────────────────────────────────────────── */
  .svge-sidebar-left {
    width: 48px;
    border-right: 1px solid var(--border-color);
    background: var(--toolbar-bg);
    flex-shrink: 0;
    overflow-y: auto;
    overflow-x: hidden;
  }

  /* ── Curve floating panel ──────────────────────────────────────── */
  .svge-curve-float {
    position: absolute;
    top: 28px;
    left: 52px;
    z-index: 500;
  }

  /* ── Canvas column: 2×2 grid ───────────────────────────────────────────────
     col 1 = 20px  (ruler gutter) │ col 2 = 1fr (canvas content)
     row 1 = 20px  (ruler gutter) │ row 2 = 1fr (canvas content)
     ─────────────────────────────┼──────────────────────────────
     (1,1) corner                 │ (1,2) .svge-ruler-h
     (2,1) .svge-ruler-v          │ (2,2) .svge-scroll-area
  ──────────────────────────────────────────────────────────────────────────── */
  .svge-canvas-col {
    flex: 1;
    overflow: hidden;
    display: grid;
    grid-template-columns: 20px 1fr;
    grid-template-rows:    20px 1fr;
  }

  .svge-ruler-corner {
    grid-column: 1; grid-row: 1;
    background: var(--toolbar-header);
    border-right:  1px solid var(--border-color);
    border-bottom: 1px solid var(--border-color);
    z-index: 2;
  }

  :global(.svge-ruler-h) { grid-column: 2; grid-row: 1; }
  :global(.svge-ruler-v) { grid-column: 1; grid-row: 2; }

  .svge-scroll-area {
    grid-column: 2; grid-row: 2;
    overflow: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--border-color) transparent;
  }

  .svge-scroll-area::-webkit-scrollbar        { width: 8px; height: 8px; }
  .svge-scroll-area::-webkit-scrollbar-track  { background: transparent; }
  .svge-scroll-area::-webkit-scrollbar-thumb  { background: var(--border-color); border-radius: 4px; }
  .svge-scroll-area::-webkit-scrollbar-thumb:hover { background: var(--ruler-text); }
  .svge-scroll-area::-webkit-scrollbar-corner { background: var(--toolbar-bg); }

  .svge-canvas-scroll-inner {
    padding: 40px;
    display: inline-block; /* shrink-wraps to SVG size so scroll area activates correctly */
  }

  /* ── Right dock: panel + bar ───────────────────────────────────── */
  .svge-right-dock {
    display: flex;
    flex-direction: row;
    flex-shrink: 0;
    border-left: 1px solid var(--border-color);
    overflow: hidden;
  }
</style>