<script lang="ts">
  /**
   * FontPicker — shared font-family selector used by CommandBar and PropertyPanel.
   *
   * • Pulls a curated list of popular Google Fonts + system fonts
   * • Loads each font on demand via a <link> injected into <head>
   * • Renders each option in its own font (visible in the dropdown)
   * • Has a search/filter input
   * • Calls onChange(fontName) when a font is selected
   *
   * The dropdown uses position:fixed so it escapes any overflow:hidden ancestor
   * (specifically CommandBar's overflow-y:hidden and the workspace overflow:hidden).
   */
  export let value    = 'sans-serif';
  export let onChange: ((font: string) => void) | undefined = undefined;
  export let compact  = false;   // true = no search bar (used in CommandBar)

  const SYSTEM_FONTS = ['sans-serif', 'serif', 'monospace'];
  const GOOGLE_FONTS = [
    'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Raleway', 'Oswald',
    'Merriweather', 'Playfair Display', 'Source Sans 3', 'Ubuntu',
    'Nunito', 'Poppins', 'Inter', 'PT Sans', 'PT Serif',
    'Noto Sans', 'Noto Serif', 'Libre Baskerville', 'Crimson Text',
    'Dancing Script', 'Pacifico', 'Lobster', 'Abril Fatface',
    'Bebas Neue', 'Righteous', 'Permanent Marker',
    'Source Code Pro', 'Fira Code', 'JetBrains Mono',
    'Impact', 'Georgia', 'Arial', 'Verdana', 'Courier New', 'Times New Roman',
  ];
  const ALL_FONTS = [...SYSTEM_FONTS, ...GOOGLE_FONTS];

  let search = '';
  let open   = false;
  let loaded = new Set<string>();

  // Position for the fixed dropdown — recalculated each time it opens.
  let dropTop  = 0;
  let dropLeft = 0;
  let dropWidth = 220;

  let triggerEl: HTMLButtonElement;

  $: filtered = search
    ? ALL_FONTS.filter(f => f.toLowerCase().includes(search.toLowerCase()))
    : ALL_FONTS;

  function loadGoogleFont(name: string) {
    if (SYSTEM_FONTS.includes(name) || loaded.has(name)) return;
    loaded.add(name);
    const url = `https://fonts.googleapis.com/css2?family=${name.replace(/ /g, '+')}:wght@400;700&display=swap`;
    if (!document.querySelector(`link[href="${url}"]`)) {
      const link = document.createElement('link');
      link.rel  = 'stylesheet';
      link.href = url;
      document.head.appendChild(link);
    }
  }

  // Pre-load selected font whenever it changes
  $: loadGoogleFont(value);

  function openDropdown() {
    if (!triggerEl) { open = !open; return; }
    const rect = triggerEl.getBoundingClientRect();
    dropTop   = rect.bottom + 3;
    dropLeft  = rect.left;
    dropWidth = Math.max(220, rect.width);
    open = !open;
    if (open) search = '';
  }

  function select(font: string) {
    loadGoogleFont(font);
    onChange?.(font);
    open  = false;
    search = '';
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') { open = false; search = ''; }
  }

  // Load visible fonts when dropdown opens
  $: if (open) filtered.slice(0, 20).forEach(loadGoogleFont);

  function onWindowClick(e: MouseEvent) {
    if (!(e.target as Element).closest('.fp-wrap')) open = false;
  }
</script>

<svelte:window on:click={onWindowClick} on:keydown={onKeyDown} />

<div class="fp-wrap">
  <button
    bind:this={triggerEl}
    class="fp-trigger"
    class:compact
    style="font-family: {value}"
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
      style="top:{dropTop}px; left:{dropLeft}px; width:{dropWidth}px;"
      on:click|stopPropagation
    >
      {#if !compact}
        <input
          class="fp-search"
          type="text"
          placeholder="Search fonts…"
          bind:value={search}
          on:click|stopPropagation
          autofocus
        />
      {/if}
      <ul class="fp-list">
        {#each filtered as font}
          <li>
            <button
              class="fp-option"
              class:selected={font === value}
              style="font-family: {font}"
              on:click={() => select(font)}
              type="button"
            >
              {font}
            </button>
          </li>
        {/each}
        {#if !filtered.length}
          <li class="fp-empty">No fonts found</li>
        {/if}
      </ul>
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
    max-height: 300px;
  }

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

  .fp-list {
    list-style: none;
    margin: 0;
    padding: 4px 0;
    overflow-y: auto;
    flex: 1;
    scrollbar-width: thin;
    scrollbar-color: var(--border-color) transparent;
  }

  .fp-option {
    display: block;
    width: 100%;
    padding: 6px 12px;
    background: transparent;
    border: none;
    text-align: left;
    font-size: 0.9rem;
    color: var(--text-color);
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: background 0.1s;
  }
  .fp-option:hover    { background: var(--ruler-bg); }
  .fp-option.selected { background: var(--tool-active); color: var(--text-color); }

  .fp-empty {
    padding: 8px 12px;
    font-size: 0.82rem;
    opacity: 0.45;
    color: var(--text-color);
  }
</style>