<script lang="ts">
  import { editorStore } from '../stores/editorStore';
  import type { PropertyType } from '../utils/types';

  const iconPath = 'src/assets/icons/';

  let selectedProperty: PropertyType = '';
  let panelOpen = false;
  editorStore.subscribe(s => { selectedProperty = s.selectedProperty; panelOpen = s.panelOpen; });

  const tabs: Array<{ type: PropertyType; icon: string; label: string }> = [
    { type: 'fill',       icon: 'fill', label: 'Fill'  },
    { type: 'stroke',     icon: 'stroke', label: 'Stroke'           },
    { type: 'geometry',   icon: 'placeholder', label: 'Geometry'         },
    { type: 'transform',  icon: 'placeholder', label: 'Transform'        },
    { type: 'text-props', icon: 'placeholder',  label: 'Text'             },
    { type: 'layers',     icon: 'placeholder', label: 'Layers'           },
    { type: 'defs',       icon: 'placeholder', label: 'Defs / Symbols'  },
    { type: 'history',    icon: 'placeholder', label: 'History'          },
    { type: 'canvas',     icon: 'canvas', label: 'Canvas'           },
  ];
</script>

<div class="h-100 position-relative">
<button
    class="svge-propbar-collapse"
    on:click={() => editorStore.setPanelOpen(!panelOpen)}
    title={panelOpen ? 'Collapse panel' : 'Expand panel'}
    aria-label={panelOpen ? 'Collapse panel' : 'Expand panel'}
  >
    <span class="svge-collapse-arrow" class:open={panelOpen}>{panelOpen ? '›' : '‹'}</span>
  </button>
</div>

<div class="svge-propbar" role="toolbar" aria-label="Property tabs">
  <!-- Collapse toggle (vertical centre) -->
  
<div class="svge-prop-wrap">
  {#each tabs as tab}
    <button
      class="svge-propbar-btn"
      class:active={panelOpen && selectedProperty === tab.type}
      on:click={() => editorStore.selectProperty(tab.type)}
      title={tab.label}
      aria-label={tab.label}
    >
      <img src="{iconPath + tab.icon + ".svg"}" alt="{tab.label}" class="icon">
    </button>
  {/each}
</div>
  
</div>

<style>
  .svge-propbar {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 4px 3px;
    gap: 1px;
    width: 100%;
    position: relative;
  }

  .svge-prop-wrap {
    position: relative;
    width: 42px;
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

  .svge-propbar-collapse {
    width: 16px;
    height: 32px;
    position: absolute;
    left: -16px;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--toolbar-bg);
    border: 1px solid var(--border-color);
    border-right: none;
    border-radius: 4px 0 0 4px;
    cursor: pointer;
    padding: 0;
    z-index: 2;
  }

  .svge-propbar-collapse:hover { background: var(--ruler-bg); }

  .svge-collapse-arrow {
    font-size: 0.85rem;
    color: var(--text-color);
    opacity: 0.6;
    line-height: 1;
    user-select: none;
    transition: transform 0.18s;
  }
</style>