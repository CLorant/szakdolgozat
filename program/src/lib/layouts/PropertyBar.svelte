<script lang="ts">
  /**
   * @file The vertical tab strip next to the property panel.
   */
  import { ui } from '../stores/ui';
  import type { PropertyType } from '../utils/types';
  import Icon from '../components/Icon.svelte';

  const tabs: Array<{ type: PropertyType; icon: string; label: string }> = [
    { type: 'fill',       icon: 'fill',       label: 'Fill' },
    { type: 'stroke',     icon: 'stroke',     label: 'Stroke' },
    { type: 'geometry',   icon: 'geometry',   label: 'Geometry' },
    { type: 'text-props', icon: 'text-props', label: 'Typography' },
    { type: 'layers',     icon: 'layers',     label: 'Objects' },
    { type: 'history',    icon: 'history',    label: 'History' },
    { type: 'canvas',     icon: 'canvas',     label: 'Canvas' },
  ];
</script>

<div class="svge-propbar-root">
  <div class="svge-propbar" role="toolbar" aria-label="Property tabs">
    {#each tabs as tab}
      <button
        class="svge-propbar-btn"
        class:active={$ui.panelOpen && $ui.property === tab.type}
        on:click={() => ui.selectProperty(tab.type)}
        title={tab.label}
        aria-label={tab.label}
      >
        <Icon name={tab.icon} alt={tab.label} />
      </button>
    {/each}
  </div>
</div>

<style>
  .svge-propbar-root { position: relative; height: 100%; width: 48px; flex-shrink: 0; }
  .svge-propbar {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 4px 3px;
    gap: 1px;
    width: 100%;
    position: relative;
  }

    .svge-propbar-btn {
    width: 42px;
    height: 42px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.12s;
    padding: 0;
  }

  .svge-propbar-btn:hover {
    background: var(--ruler-bg);
    border-color: var(--border-color);
  }

  .svge-propbar-btn.active {
    background: var(--tool-active);
    border-color: var(--tool-border-active);
  }
</style>
