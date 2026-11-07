<script lang="ts">
  /**
   * @file A centred dialog: backdrop, title bar with a close button, scrolling body.
   * Closes on Escape, the close button and a click on the backdrop; keeps keyboard focus inside while open
   * and gives it back to the element that opened it.
   */
  import { tick } from 'svelte';

  export let open = false;
  export let title: string;
  /** Width of the dialog in px (it shrinks on small screens). */
  export let width = 440;
  export let onClose: () => void = () => {};

  let closeBtn: HTMLButtonElement | undefined;
  let dialogEl: HTMLDivElement | undefined;
  let opener: Element | null = null;
  const id = `modal-${Math.random().toString(36).slice(2, 8)}`;

  $: if (open) void focusClose();
  async function focusClose() { opener = document.activeElement; await tick(); closeBtn?.focus(); }
  function close() { onClose(); (opener as HTMLElement | null)?.focus?.(); }

  function onKey(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
    if (e.key === 'Tab' && dialogEl) {
      const f = [...dialogEl.querySelectorAll<HTMLElement>('button, input, select, a[href], [tabindex="0"]')]
        .filter(x => !(x as HTMLInputElement).disabled && x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
</script>

<svelte:window on:keydown|capture={onKey} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="backdrop" on:pointerdown|self={close}>
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby={id} bind:this={dialogEl} style="width:min({width}px, 100%)">
      <header class="head">
        <h2 {id}>{title}</h2>
        <button class="x" bind:this={closeBtn} on:click={close} aria-label="Close" title="Close">✕</button>
      </header>
      <div class="body"><slot /></div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed; inset: 0; z-index: 9000; display: flex; align-items: center; justify-content: center;
    padding: 28px 12px; background: rgba(0, 0, 0, 0.38);
  }
  .dialog {
    max-height: 100%; display: flex; flex-direction: column;
    border: 1px solid var(--border-color); border-radius: 10px; overflow: hidden;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.06), 0 18px 48px rgba(0, 0, 0, 0.35);
    color: var(--text-color);
  }
  .head {
    display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;
    padding: 8px 10px 8px 16px; background: var(--bg-color); border-bottom: 1px solid var(--border-color);
  }
  .head h2 { margin: 0; font-size: 0.95rem; font-weight: 600; }
  .x {
    width: 28px; height: 28px; padding: 0; background: transparent; border: 1px solid transparent; border-radius: 4px;
    color: var(--text-color); opacity: 0.6; font-size: 0.85rem; cursor: pointer;
  }
  .x:hover { opacity: 1; background: #e74c3c18; border-color: #e74c3c55; color: #e74c3c; }
  .body { background: var(--toolbar-bg); padding: 4px 16px 12px; overflow-y: auto; }
</style>
