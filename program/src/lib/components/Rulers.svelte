<script lang="ts">
  import { onMount } from 'svelte';
  import { editorStore } from '../stores/editorStore';

  export const RULER_SIZE = 20;
  export let scrollLeft   = 0;
  export let scrollTop    = 0;
  export let paddingLeft  = 60;
  export let paddingTop   = 60;

  const STEP_CANVAS = 50;
  const STEP_MAJOR  = 100;

  let zoom = 1;
  let cursorVX = 0, cursorVY = 0;
  let hRulerEl: HTMLElement;
  let vRulerEl: HTMLElement;
  let hLeft = 0, vTop = 0;
  let hWidth = 600, vHeight = 400;

  editorStore.subscribe(s => {
    zoom     = s.zoom;
    cursorVX = s.cursor.x;
    cursorVY = s.cursor.y;
  });

  // ── Tick arrays ──────────────────────────────────────────────────────────
  $: hTicks = buildTicks(hWidth,  STEP_CANVAS, STEP_MAJOR, zoom);
  $: vTicks = buildTicks(vHeight, STEP_CANVAS, STEP_MAJOR, zoom);

  function buildTicks(size: number, step: number, major: number, z: number) {
    const stepPx = step * z;
    if (stepPx < 1) return [];
    const count = Math.ceil(size / stepPx) + 2;
    return Array.from({ length: count }, (_, i) => ({
      pos:   i * stepPx,
      label: (i * step) % major === 0 ? i * step : null,
    }));
  }

  // ── Cursor line positions ─────────────────────────────────────────────────
  $: cursorH = cursorVX - hLeft;
  $: cursorV = cursorVY - vTop;

  // ── Inner-div translation ─────────────────────────────────────────────────
  $: translateH = paddingLeft - scrollLeft;
  $: translateV = paddingTop  - scrollTop;

  // ── Measure ruler element rects ───────────────────────────────────────────
  function measure() {
    if (hRulerEl) {
      const r = hRulerEl.getBoundingClientRect();
      hLeft  = r.left;
      hWidth = r.width;
    }
    if (vRulerEl) {
      const r = vRulerEl.getBoundingClientRect();
      vTop    = r.top;
      vHeight = r.height;
    }
  }

  onMount(() => {
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    return () => ro.disconnect();
  });
</script>

<!-- Horizontal ruler -->
<div class="svge-ruler-h" bind:this={hRulerEl} aria-hidden="true">
  <div class="svge-ruler-inner-h" style="transform: translateX({translateH - 20}px)">
    {#each hTicks as tick}
      <div class="svge-tick svge-tick-h" class:major={tick.label !== null} style="left:{tick.pos}px">
        {#if tick.label !== null}
          <span class="svge-rlabel svge-rlabel-h">{tick.label}</span>
        {/if}
      </div>
    {/each}
  </div>
  <div class="svge-cursor-h" style="left:{cursorH}px"></div>
</div>

<!-- Vertical ruler -->
<div class="svge-ruler-v" bind:this={vRulerEl} aria-hidden="true">
  <div class="svge-ruler-inner-v" style="transform: translateY({translateV - 20}px)">
    {#each vTicks as tick}
      <div class="svge-tick svge-tick-v" class:major={tick.label !== null} style="top:{tick.pos}px">
        {#if tick.label !== null}
          <span class="svge-rlabel svge-rlabel-v">{tick.label}</span>
        {/if}
      </div>
    {/each}
  </div>
  <div class="svge-cursor-v" style="top:{cursorV}px"></div>
</div>

<style>
  .svge-ruler-h,
  .svge-ruler-v {
    background: var(--ruler-bg);
    position: relative;
    overflow: hidden;
    flex-shrink: 0;
  }

  .svge-ruler-h {
    height: 20px;
    border-bottom: 1px solid var(--border-color);
  }

  .svge-ruler-v {
    width: 20px;
    border-right: 1px solid var(--border-color);
  }

  .svge-ruler-inner-h,
  .svge-ruler-inner-v {
    position: absolute;
    top: 0; left: 0;
    width: 100%; height: 100%;
    will-change: transform;
  }

  /* ── Ticks ───────────────────────────────────────────────────────────────── */
  .svge-tick { position: absolute; background: var(--ruler-text); }

  .svge-tick-h { bottom: 0; width: 1px; height: 5px; }
  .svge-tick-h.major { height: 10px; }

  .svge-tick-v { right: 0; height: 1px; width: 5px; }
  .svge-tick-v.major { width: 10px; }

  /* ── Labels ──────────────────────────────────────────────────────────────── */
  .svge-rlabel {
    position: absolute;
    font-size: 12px;
    font-family: monospace;
    color: var(--ruler-text);
    user-select: none;
    white-space: nowrap;
    pointer-events: none;
  }

  .svge-rlabel-h { top: -4px; left: 3px; }

  .svge-rlabel-v {
    top: 3px; left: -4px;
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    font-size: 12px;
  }

  /* ── Cursor indicator lines ───────────────────────────────────────────────── */
  .svge-cursor-h,
  .svge-cursor-v {
    position: absolute;
    background: rgba(74, 144, 217, 0.75);
    pointer-events: none;
    z-index: 2;
  }

  .svge-cursor-h {
    top: 0; height: 100%; width: 2px;
    transform: translateX(-0.5px);
  }

  .svge-cursor-v {
    left: 0; width: 100%; height: 2px;
    transform: translateY(-0.5px);
  }
</style>