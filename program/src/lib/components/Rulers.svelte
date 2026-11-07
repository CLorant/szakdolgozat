<script lang="ts">
  /**
   * @file Horizontal and vertical rulers in document units. Ticks are made for the range actually visible (view offset
   * and zoom) with an adaptive step, so a ruler never goes blank and labels never overlap. Dragging out of a ruler
   * places a guide.
   */
  import { onMount } from 'svelte';
  import { viewport, cursor, CANVAS_PADDING } from '../stores/viewport';
  import { rulerTicks } from '../utils/ruler';
  import { startGuideDrag } from '../utils/guides';

  let hEl: HTMLElement, vEl: HTMLElement;
  let hSize = 800, vSize = 600;

  $: zoom = $viewport.zoom;
  $: hOrigin = CANVAS_PADDING - $viewport.scrollLeft;     // px (inside the ruler) of document x = 0
  $: vOrigin = CANVAS_PADDING - $viewport.scrollTop;
  $: hTicks = rulerTicks(-hOrigin / zoom, (hSize - hOrigin) / zoom, zoom);
  $: vTicks = rulerTicks(-vOrigin / zoom, (vSize - vOrigin) / zoom, zoom);

  // Cursor position relative to each ruler (measured live: panels can move the rulers).
  $: cursorH = $cursor.x - (hEl?.getBoundingClientRect().left ?? 0);
  $: cursorV = $cursor.y - (vEl?.getBoundingClientRect().top ?? 0);

  onMount(() => {
    const ro = new ResizeObserver(() => {
      hSize = hEl?.clientWidth ?? hSize;
      vSize = vEl?.clientHeight ?? vSize;
    });
    ro.observe(hEl); ro.observe(vEl);
    return () => ro.disconnect();
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="svge-ruler-h" bind:this={hEl} aria-hidden="true" title="Drag down to place a guide" on:pointerdown={e => startGuideDrag(e, 'y')}>
  {#each hTicks as t (t.value)}
    <div class="svge-tick svge-tick-h" class:major={t.major} style="left:{hOrigin + t.pos}px">
      {#if t.label !== null}<span class="svge-rlabel svge-rlabel-h">{t.label}</span>{/if}
    </div>
  {/each}
  <div class="svge-cursor-h" style="left:{cursorH}px"></div>
</div>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="svge-ruler-v" bind:this={vEl} aria-hidden="true" title="Drag right to place a guide" on:pointerdown={e => startGuideDrag(e, 'x')}>
  {#each vTicks as t (t.value)}
    <div class="svge-tick svge-tick-v" class:major={t.major} style="top:{vOrigin + t.pos}px">
      {#if t.label !== null}<span class="svge-rlabel svge-rlabel-v">{t.label}</span>{/if}
    </div>
  {/each}
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

  .svge-ruler-h { cursor: row-resize; touch-action: none; }
  .svge-ruler-v { cursor: col-resize; touch-action: none; }
  .svge-ruler-h {
    height: 20px;
    border-bottom: 1px solid var(--border-color);
  }

  .svge-ruler-v {
    width: 20px;
    border-right: 1px solid var(--border-color);
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
