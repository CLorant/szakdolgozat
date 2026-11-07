<script lang="ts">
  /**
   * @file An icon by name: a built-in 24 × 24 stroke icon that follows currentColor (so it suits both themes without
   * a filter). An unknown name shows its first letter.
   */
  export let name: string;
  export let size = 22;
  export let alt = '';

  // 24×24 stroke icons; they follow `currentColor`, so they need no dark-mode filter.
  const BUILTIN: Record<string, string> = {
    pointer:      '<path d="M5 3l14 8-6 2-3 6z"/>',
    edit:         '<path d="M5 18C8 6 16 6 19 18"/><rect x="3" y="16" width="4" height="4"/><rect x="17" y="16" width="4" height="4"/>',
    line:         '<path d="M5 19L19 5"/>',
    freehand:     '<path d="M3 15c3-8 5 4 8-2s4-6 10 0"/>',
    pen:          '<path d="M12 3l4 8-4 10-4-10z"/><circle cx="12" cy="11" r="1.4"/>',
    arc:          '<path d="M4 19A11 11 0 0 1 20 9"/><circle cx="4" cy="19" r="1.6"/><circle cx="20" cy="9" r="1.6"/>',
    square:       '<rect x="4" y="6" width="16" height="12" rx="1"/>',
    circle:       '<ellipse cx="12" cy="12" rx="8" ry="6"/>',
    polygon:      '<path d="M12 3l8 6-3 11H7L4 9z"/>',
    text:         '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
    hand:         '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11m0-6.5a1.5 1.5 0 0 1 3 0V11m0-5a1.5 1.5 0 0 1 3 0v6m0-3.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.5a6 6 0 0 1-4.8-2.4L4.5 14.5a1.6 1.6 0 0 1 2.5-2L8 13.5"/>',
    fill:         '<path d="M5 12l7-7 7 7-7 7z"/><path d="M20 16c1 2 1 3 0 4"/>',
    stroke:       '<rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3 2"/>',
    geometry:     '<path d="M4 20V4M4 20h16"/><path d="M8 16V9h7v7z"/>',
    'text-props': '<path d="M4 18l5-12 5 12M6 14h6"/><path d="M16 10h5M18.5 10v8"/>',
    layers:       '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
    history:      '<path d="M4 12a8 8 0 1 0 3-6.2"/><path d="M4 4v4h4"/><path d="M12 8v4l3 2"/>',
    canvas:       '<rect x="5" y="5" width="14" height="14"/><path d="M2 8h3M2 16h3M19 8h3M19 16h3M8 2v3M16 2v3M8 19v3M16 19v3"/>',
    undo:         '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-4"/>',
    redo:         '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h4"/>',
    group:        '<rect x="2.5" y="2.5" width="19" height="19" rx="1.5" stroke-dasharray="2.2 2.4"/><rect x="6" y="6" width="7.5" height="7.5"/><rect x="10.5" y="10.5" width="7.5" height="7.5"/>',
    ungroup:      '<rect x="3" y="3" width="8" height="8"/><rect x="13" y="13" width="8" height="8"/><path d="M15 4h5v5M9 20H4v-5" stroke-dasharray="2 2"/>',
    'exit-group': '<path d="M13 3.5H4.5v17H13" stroke-dasharray="2.2 2.4"/><path d="M9 12h12M17 8l4 4-4 4"/>',
    'to-path':    '<path d="M6 18C6 8 18 16 18 6"/><rect x="4" y="16" width="4" height="4"/><rect x="16" y="4" width="4" height="4"/><path d="M6 18l-2 -6M18 6l2 6" stroke-width="1"/>',
    'stroke-to-path': '<path d="M3.5 16.5 16.5 3.5l4 4-13 13z"/><path d="M5.5 18.5 18.5 5.5" stroke-dasharray="1.6 2.2" stroke-width="1.2"/>',
    scissors:     '<circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M8.2 15 18 4M15.8 15 6 4"/>',
    blob:         '<path d="M5 16c-1-4 2-8 6-7 3 .7 3-3 6-3 3 0 4 3 3 6-1 4-4 8-9 8-3 0-5-2-6-4z"/><path d="M14 4l2-2"/>',
    unite:        '<path d="M4 4h10v6h6v10H10v-6H4z" fill="currentColor" fill-opacity=".3"/>',
    subtract:     '<path d="M4 4h10v6h-4v4H4z" fill="currentColor" fill-opacity=".3"/><path d="M10 10h10v10H10z" stroke-dasharray="2 2"/>',
    intersect:    '<path d="M4 4h10v10H4zM10 10h10v10H10z" stroke-dasharray="2 2" stroke-width="1.2"/><path d="M10 10h4v4h-4z" fill="currentColor" fill-opacity=".45"/>',
    exclude:      '<path d="M4 4h10v10H4zM10 10h10v10H10z" fill="currentColor" fill-opacity=".3" fill-rule="evenodd"/>',
    divide:       '<path d="M4 4h10v10H4zM10 10h10v10H10z"/><path d="M10 10h4v4h-4z" fill="currentColor" fill-opacity=".45"/>',
    sun:          '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
    moon:         '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  };

  $: inline = BUILTIN[name];
</script>

{#if inline}
  <svg class="icon-inline" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
    stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label={alt || name}>
    {@html inline}
  </svg>
{:else}
  <span class="icon-fallback" style="width:{size}px;height:{size}px">{(alt || name).slice(0, 1).toUpperCase()}</span>
{/if}

<style>
  .icon-inline { color: var(--text-color); display: block; }
  .icon-fallback { display: inline-flex; align-items: center; justify-content: center; font-size: 0.8rem; opacity: 0.6; }
</style>
