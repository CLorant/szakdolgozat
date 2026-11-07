<script lang="ts">
  /**
   * @file Font family picker, used by the command bar and the Typography panel.
   *   • Google Fonts tab: the whole catalog. Each row is drawn in its own typeface; only rows in view are requested,
   *     in batches, cut down to the letters of the names (fonts/editorFonts.ts).
   *   • Local Fonts tab: the fonts installed on this computer (Local Font Access API; the browser asks once) and the
   *     CSS generic families. Browsers without the API show the common fonts found by detection.
   * The dropdown is position: fixed, so no overflow: hidden ancestor can clip it.
   */
  export let value    = 'sans-serif';
  export let onChange: ((font: string) => void) | undefined = undefined;
  export let compact  = false;   // true = smaller trigger button (used in CommandBar)

  import { tick } from 'svelte';
  import FontList from './FontList.svelte';
  import { googleCatalog, localFonts, enableLocalFonts, ensureGoogleCatalog } from '../fonts/state';
  import { previews, requestPreviews, ensureEditorFont } from '../fonts/editorFonts';
  import { GENERIC_FAMILIES } from '../fonts/generic';
  import { sourceOf } from '../fonts/sources';
  import { cssFontFamily } from '../utils/text';

  type Tab = 'google' | 'local';
  let tab: Tab = 'google';
  let search = '';
  let open   = false;

  // Position for the fixed dropdown — recalculated each time it opens.
  let dropTop  = 0;
  let dropLeft = 0;
  let dropWidth = 260;

  let triggerEl: HTMLButtonElement;
  let dropEl: HTMLDivElement | undefined;
  const LIST_H = 240;                 // height of the tab body (the Google list alone)
  let listH = 0;

  const matches = (list: readonly string[], q: string) => {
    const t = q.trim().toLowerCase();
    return t ? list.filter(f => f.toLowerCase().includes(t)) : [...list];
  };

  $: googleItems = matches($googleCatalog.names, search);
  $: localItems = matches([...GENERIC_FAMILIES, ...$localFonts.families], search);

  /** Row typeface: Google rows use their tiny preview font once it is there; local rows render directly. */
  $: googleFont = (name: string) => {
    const p = $previews[name];
    return p && p.status !== 'failed' ? `'${p.alias}', sans-serif` : 'inherit';
  };
  const localFont = (name: string) => cssFontFamily(name);

  // Make the font of the trigger (and of new text) available on the canvas.
  $: void ensureEditorFont(value, 400, 'normal');

  function openDropdown() {
    if (!triggerEl) { open = !open; return; }
    const rect = triggerEl.getBoundingClientRect();
    dropTop   = rect.bottom + 3;
    dropWidth = Math.min(Math.max(260, rect.width), window.innerWidth - 8);
    dropLeft  = Math.max(4, Math.min(rect.left, window.innerWidth - dropWidth - 4));
    open = !open;
    // No room below (the panel is a sheet at the bottom of a phone screen): open upwards.
    if (open) void tick().then(() => {
      const h = dropEl?.offsetHeight ?? 0;
      if (rect.bottom + 3 + h > window.innerHeight - 4) dropTop = Math.max(4, rect.top - 3 - h);
    });
    if (open) {
      search = '';
      const src = sourceOf(value);
      tab = src === 'local' || src === 'generic' ? 'local' : 'google';
      if ($googleCatalog.status !== 'ready') void ensureGoogleCatalog(true);
    }
  }

  function select(font: string) {
    void ensureEditorFont(font, 400, 'normal');
    onChange?.(font);
    open  = false;
    search = '';
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') { open = false; search = ''; }
  }

  function onWindowClick(e: MouseEvent) {
    if (!(e.target as Element).closest('.fp-wrap')) open = false;
  }

  const loadingNames = (names: string[]) => requestPreviews(names);
</script>

<svelte:window on:click={onWindowClick} on:keydown={onKeyDown} />

<div class="fp-wrap">
  <button
    bind:this={triggerEl}
    class="fp-trigger"
    class:compact
    style="font-family: {cssFontFamily(value)}"
    on:click|stopPropagation={openDropdown}
    title="Font: {value}"
    type="button"
  >
    <span class="fp-value">{value}</span>
    <span class="fp-arrow">{open ? '▲' : '▼'}</span>
  </button>

  {#if open}
    <!-- Rendered fixed to escape overflow:hidden ancestors -->
    <div
      class="fp-dropdown"
      bind:this={dropEl}
      style="top:{dropTop}px; left:{dropLeft}px; width:{dropWidth}px;"
      role="presentation"
      on:click|stopPropagation
    >
      <div class="fp-tabs" role="tablist">
        <button type="button" role="tab" class="fp-tab" class:active={tab === 'google'} aria-selected={tab === 'google'} on:click={() => (tab = 'google')}>Google Fonts</button>
        <button type="button" role="tab" class="fp-tab" class:active={tab === 'local'} aria-selected={tab === 'local'} on:click={() => (tab = 'local')}>Local Fonts</button>
      </div>

      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="fp-search"
        type="text"
        placeholder={tab === 'google' ? 'Search Google Fonts…' : 'Search local fonts…'}
        bind:value={search}
        on:click|stopPropagation
        autofocus
      />

      <!-- Same height on both tabs; the list takes whatever the notes leave -->
      <div class="fp-body">
      {#if tab === 'google'}
        {#if $googleCatalog.status === 'loading' && !$googleCatalog.names.length}
          <div class="fp-note">Loading the font list…</div>
        {:else if $googleCatalog.status === 'error'}
          <div class="fp-note">
            Could not load the Google Fonts list{$googleCatalog.error ? ` (${$googleCatalog.error})` : ''}. Check your connection.
            <button type="button" class="fp-link" on:click={() => ensureGoogleCatalog(true)}>Retry</button>
          </div>
        {:else}
          {#if $googleCatalog.stale}<div class="fp-note">Offline — showing the saved font list.</div>{/if}
          <div class="fp-list" bind:clientHeight={listH}>
            <FontList
              items={googleItems}
              selected={value}
              fontOf={googleFont}
              onPick={select}
              onVisible={loadingNames}
              height={listH || LIST_H}
            />
          </div>
        {/if}
      {:else}
        {#if $localFonts.status === 'idle'}
          <div class="fp-note">
            Your browser can show the fonts installed on this computer.
            <button type="button" class="fp-link" on:click={enableLocalFonts}>Use Local Fonts…</button>
          </div>
        {:else if $localFonts.status === 'loading'}
          <div class="fp-note">Reading installed fonts…</div>
        {:else if $localFonts.status === 'denied' || $localFonts.status === 'error'}
          <div class="fp-note">
            {$localFonts.error ?? 'Installed fonts are not available.'}
            <button type="button" class="fp-link" on:click={enableLocalFonts}>Try again</button>
          </div>
        {:else if $localFonts.status === 'unsupported'}
          <div class="fp-note">This browser cannot read installed fonts (Chrome and Edge can). The common fonts found here are listed; they cannot be converted to paths.</div>
        {/if}
        <div class="fp-list" bind:clientHeight={listH}>
          <FontList items={localItems} selected={value} fontOf={localFont} onPick={select} height={listH || LIST_H} />
        </div>
      {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .fp-wrap {
    position: relative;
    display: inline-block;
  }

  .fp-trigger {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    height: 28px;
    padding: 0 8px;
    min-width: 130px;
    background: var(--bg-color);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    color: var(--text-color);
    font-size: 0.82rem;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: border-color 0.12s;
  }
  .fp-trigger.compact { min-width: 110px; height: 26px; }
  .fp-trigger:hover  { border-color: var(--accent-color); }

  .fp-value { flex: 1; overflow: hidden; text-overflow: ellipsis; text-align: left; }
  .fp-arrow { font-size: 0.65rem; opacity: 0.5; flex-shrink: 0; }

  /* Fixed-position dropdown — escapes all overflow:hidden containers */
  .fp-dropdown {
    position: fixed;
    background: var(--bg-color);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.18);
    z-index: 9999;
    display: flex;
    flex-direction: column;
    max-height: 380px;
  }

  .fp-body { height: 240px; display: flex; flex-direction: column; }
  .fp-list { flex: 1; min-height: 0; }

  .fp-search {
    margin: 6px 6px 4px;
    height: 28px;
    padding: 0 8px;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    background: var(--bg-color);
    color: var(--text-color);
    font-size: 0.82rem;
    flex-shrink: 0;
  }
  .fp-search:focus { outline: none; border-color: var(--accent-color); }

  .fp-tabs { display: flex; padding: 6px 6px 0; gap: 4px; flex-shrink: 0; }
  .fp-tab {
    flex: 1; height: 26px; border: 1px solid var(--border-color); border-radius: 4px;
    background: transparent; color: var(--text-color); font-size: 0.78rem; cursor: pointer; opacity: 0.7;
  }
  .fp-tab:hover { opacity: 1; }
  .fp-tab.active { background: var(--tool-active); opacity: 1; font-weight: 600; }

  .fp-note { padding: 8px 12px; font-size: 0.78rem; line-height: 1.35; color: var(--text-color); opacity: 0.8; }
  .fp-link {
    display: inline; padding: 0; margin-left: 4px; border: none; background: none;
    color: var(--accent-color); font-size: inherit; cursor: pointer; text-decoration: underline;
  }
</style>