<script lang="ts">
  /**
   * @file A windowed list: only the rows in view (plus a few) exist in the DOM, so the ~1,500 Google families scroll
   * smoothly. `onVisible` reports the rows in view (debounced); the picker loads their preview fonts.
   */
  import { onMount, onDestroy } from 'svelte';

  export let items: string[] = [];
  export let selected = '';
  export let rowHeight = 35;
  export let height = 240;
  export let fontOf: (item: string) => string = () => 'inherit';
  export let onPick: (item: string) => void = () => {};
  export let onVisible: ((items: string[]) => void) | undefined = undefined;

  const OVERSCAN = 5;
  let el: HTMLDivElement;
  let top = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  $: first = Math.max(0, Math.floor(top / rowHeight) - OVERSCAN);
  $: last = Math.min(items.length, Math.ceil((top + height) / rowHeight) + OVERSCAN);
  $: slice = items.slice(first, last);

  $: if (onVisible) {
    const vis = items.slice(Math.max(0, Math.floor(top / rowHeight)), Math.ceil((top + height) / rowHeight) + 1);
    clearTimeout(timer);
    timer = setTimeout(() => onVisible?.(vis), 120);        // not while the user is flicking through the list
  }

  /** Scrolls so that `item` is in view (centred); no-op if it is not in the list. */
  export function reveal(item: string) {
    const i = items.indexOf(item);
    if (i < 0 || !el) return;
    el.scrollTop = Math.max(0, i * rowHeight - height / 2 + rowHeight / 2);
    top = el.scrollTop;
  }

  // a new item list (search typed) starts at the top
  let lastItems = items;
  $: if (items !== lastItems) { lastItems = items; if (el) { el.scrollTop = 0; top = 0; } }

  onMount(() => reveal(selected));
  onDestroy(() => clearTimeout(timer));
</script>

<div class="fl" bind:this={el} on:scroll={() => (top = el.scrollTop)} style="height:{height}px" role="listbox" tabindex="-1">
  <div class="fl-space" style="height:{items.length * rowHeight}px">
    {#each slice as item, i (item)}
      <button
        class="fl-row" class:selected={item === selected} type="button" role="option" aria-selected={item === selected}
        style="top:{(first + i) * rowHeight}px; height:{rowHeight}px; font-family:{fontOf(item)}"
        on:click={() => onPick(item)}
      >{item}</button>
    {/each}
  </div>
  {#if !items.length}<div class="fl-empty">No fonts found</div>{/if}
</div>

<style>
  .fl { overflow-y: auto; position: relative; scrollbar-width: thin; scrollbar-color: var(--border-color) transparent; }
  .fl-space { position: relative; }
  .fl-row {
    position: absolute; left: 0; right: 0;
    display: block; width: 100%; padding: 0 12px;
    background: transparent; border: none; text-align: left;
    font-size: 1.25rem; line-height: 1; color: var(--text-color); cursor: pointer;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .fl-row:hover { background: var(--ruler-bg); }
  .fl-row.selected { background: var(--tool-active); }
  .fl-empty { position: absolute; top: 0; left: 0; right: 0; padding: 8px 12px; font-size: 0.82rem; opacity: 0.45; color: var(--text-color); }
</style>
