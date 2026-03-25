<script lang="ts">
  /**
   * Composite slider + number input.
   *
   * Use the `onChange` callback prop instead of `on:change` — createEventDispatcher
   * is deprecated in Svelte 5 and caused a TypeError when the panel first mounted
   * because the CustomEvent detail was read before the reactive display values
   * (opacity etc.) had initialised.
   */
  export let value:    number   = 0;
  export let min:      number   = 0;
  export let max:      number   = 100;
  export let step:     number   = 1;
  export let unit:     string   = '';
  export let numWidth: number   = 52;
  export let disabled: boolean  = false;
  export let onChange: ((v: number) => void) | undefined = undefined;

  function clamp(v: number) { return Math.min(max, Math.max(min, v)); }

  function onSlider(e: Event) {
    value = parseFloat((e.target as HTMLInputElement).value);
    onChange?.(value);
  }
  function onNum(e: Event) {
    const v = parseFloat((e.target as HTMLInputElement).value);
    if (!isNaN(v)) { value = clamp(v); onChange?.(value); }
  }
</script>

<div class="slider-input" class:disabled>
  <input
    type="range"
    {min} {max} {step} {value} {disabled}
    on:input={onSlider}
    class="si-slider"
  />
  <input
    type="number"
    {min} {max} {step} {value} {disabled}
    on:change={onNum}
    class="si-num"
    style="width:{numWidth}px"
  />
  {#if unit}<span class="si-unit">{unit}</span>{/if}
</div>

<style>
  .slider-input {
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .slider-input.disabled { opacity: 0.38; pointer-events: none; }

  .si-slider {
    flex: 1;
    cursor: pointer;
    accent-color: var(--accent-color);
    min-width: 0;
  }
  .si-num {
    height: 26px;
    padding: 0 4px;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    background: var(--bg-color);
    color: var(--text-color);
    font-size: 0.8rem;
    font-family: monospace;
    text-align: center;
    flex-shrink: 0;
  }
  .si-num:focus { outline: none; border-color: var(--accent-color); }
  .si-unit {
    font-size: 0.68rem;
    opacity: 0.45;
    color: var(--text-color);
    flex-shrink: 0;
    min-width: 14px;
  }
</style>