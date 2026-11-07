<script lang="ts">
  /**
   * @file A slider with a number field. Reports through the `onChange` callback prop, so the
   * first value is never read before the parent has set it up.
   */
  export let value:    number   = 0;
  export let min:      number   = 0;
  export let max:      number   = 100;
  export let step:     number   = 1;
  export let unit:     string   = '';
  export let numWidth: number   = 52;
  export let disabled: boolean  = false;
  export let onChange: ((v: number) => void) | undefined = undefined;
  /** The slider's own range when it should be shorter than the field's (font size: slider 6–200, field 1–2000). */
  export let sliderMin: number | undefined = undefined;
  export let sliderMax: number | undefined = undefined;

  import { onDestroy } from 'svelte';
  // A focused field that disappears (the selection changed) may still report a change on its way out: ignored.
  let alive = true;
  onDestroy(() => { alive = false; });

  function clamp(v: number) { return Math.min(max, Math.max(min, v)); }

  function onSlider(e: Event) {
    value = parseFloat((e.target as HTMLInputElement).value);
    onChange?.(value);
  }
  /** While typing: only values already inside the range are applied (no clamping under the caret). */
  function onNumInput(e: Event) {
    const v = parseFloat((e.target as HTMLInputElement).value);
    if (!isNaN(v) && v >= min && v <= max) { value = v; onChange?.(value); }
  }
  /** On blur / Enter: clamp whatever is left in the field. */
  function onNum(e: Event) {
    if (!alive) return;
    const el = e.target as HTMLInputElement;
    const v = parseFloat(el.value);
    if (isNaN(v)) return;
    const next = clamp(v);
    el.value = String(next);
    if (next !== value) { value = next; onChange?.(value); }   // typing already applied it: no second report on blur
  }
</script>

<div class="slider-input" class:disabled>
  <input
    type="range"
    min={sliderMin ?? min} max={sliderMax ?? max} {step} {value} {disabled}
    on:input={onSlider}
    class="si-slider"
  />
  <input
    type="number"
    {min} {max} {step} {value} {disabled}
    on:input={onNumInput}
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