<script lang="ts">
  /**
   * @file The font weight control of the Typography panel.
   *   Variable family     → a continuous slider over its range.
   *   Several weights     → a stepped slider over exactly those weights.
   *   No weight of 600+   → a "Synthesized bold" toggle (the browser thickens the letters, so does text-to-path).
   */
  import SliderInput from './SliderInput.svelte';
  import { hasRealBold, nearestWeight, weightLabel, type FontStyles } from '../fonts/styles';

  export let styles: FontStyles;
  export let value: number;
  export let onChange: (weight: number) => void;

  $: realBold = hasRealBold(styles);
  $: heaviest = styles.variable ? styles.variable.max : Math.max(...styles.weights);
  $: synth = !realBold && value >= 600;
  $: shown = synth ? heaviest : nearestWeight(styles, value);
  $: steps = styles.variable ? [] : styles.weights;
  $: index = Math.max(0, steps.indexOf(shown));
  $: several = !!styles.variable || steps.length > 1;
</script>

<div class="weight">
  {#if several}
    {#if styles.variable}
      <SliderInput value={shown} min={styles.variable.min} max={styles.variable.max} step={1} disabled={synth} onChange={onChange} />
    {:else}
      <div class="stepped" class:off={synth}>
        <input type="range" min="0" max={steps.length - 1} step="1" value={index} disabled={synth}
          aria-label="Font weight" aria-valuetext={weightLabel(shown)}
          on:input={e => onChange(steps[+e.currentTarget.value])} />
        <span class="name">{weightLabel(shown)}</span>
      </div>
    {/if}
    {#if styles.variable}<div class="hint">{weightLabel(shown)}</div>{/if}
  {/if}
  {#if !realBold}
    <button type="button" class="synth" class:active={synth} aria-pressed={synth}
      title="This font has no bold face: the letters are thickened instead"
      on:click={() => onChange(synth ? heaviest : 700)}><strong>B</strong> Synthesized bold</button>
  {/if}
</div>

<style>
  .weight { display: flex; flex-direction: column; gap: 6px; }
  .stepped { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px; }
  .stepped.off { opacity: 0.45; }
  .stepped input { width: 100%; accent-color: var(--accent-color); }
  .name, .hint { font-size: 0.75rem; opacity: 0.7; white-space: nowrap; }
  .synth {
    align-self: flex-start; height: 28px; padding: 0 10px; background: transparent; border: 1px solid var(--border-color);
    border-radius: 4px; color: var(--text-color); font-size: 0.75rem; cursor: pointer;
  }
  .synth:hover { background: var(--ruler-bg); }
  .synth.active { background: var(--tool-active); border-color: var(--tool-border-active); }
</style>
