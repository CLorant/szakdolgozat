<script lang="ts">
  /**
   * @file Edits one gradient paint (utils/gradient.ts): a bar with a handle per stop (drag to move, click the bar to
   * add), the selected stop's color, and the angle or centre / radius. Emits the new paint string on every change.
   */
  import { createEventDispatcher } from 'svelte';
  import ColorPicker from './ColorPicker.svelte';
  import SliderInput from './SliderInput.svelte';
  import { parseGradient, formatGradient, gradientCss, gradientFrom, colorAt, reverseStops, type Gradient, type Stop } from '../utils/gradient';

  export let value: string;
  const dispatch = createEventDispatcher<{ change: string }>();

  $: g = parseGradient(value) ?? gradientFrom('#808080', 'linear');
  let sel = 0;
  $: if (sel >= g.stops.length) sel = g.stops.length - 1;
  $: stop = g.stops[sel];

  const emit = (next: Gradient) => dispatch('change', formatGradient(next));
  const withStops = (stops: Stop[]): Gradient => ({ ...g, stops } as Gradient);
  const round1 = (n: number) => Math.round(n * 10) / 10;

  function setStopColor(color: string) {
    emit(withStops(g.stops.map((s, i) => i === sel ? { ...s, color } : s)));
  }
  /** Moves stop `i` to `offset`; the list stays sorted and the selection follows the stop. */
  function moveStop(i: number, offset: number) {
    const moved = { ...g.stops[i], offset: Math.min(100, Math.max(0, round1(offset))) };
    const next = g.stops.map((s, k) => k === i ? moved : s).sort((a, b) => a.offset - b.offset);
    sel = next.indexOf(moved);
    emit(withStops(next));
  }
  function removeStop() {
    if (g.stops.length <= 2) return;
    emit(withStops(g.stops.filter((_, i) => i !== sel)));
  }

  let bar: HTMLElement;
  const pctOf = (clientX: number) => {
    const r = bar.getBoundingClientRect();
    return r.width ? ((clientX - r.left) / r.width) * 100 : 0;
  };

  function handleDown(e: PointerEvent, i: number) {
    e.preventDefault(); e.stopPropagation();
    sel = i;
    let idx = i;
    const target = e.currentTarget as HTMLElement;
    try { target.setPointerCapture(e.pointerId); } catch { /* window listeners below still work */ }
    const move = (ev: PointerEvent) => {
      moveStop(idx, pctOf(ev.clientX));
      idx = sel;
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }
  function handleKey(e: KeyboardEvent, i: number) {
    const step = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowLeft') { e.preventDefault(); moveStop(i, g.stops[i].offset - step); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); moveStop(i, g.stops[i].offset + step); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); sel = i; removeStop(); }
  }
  function barDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const pos = Math.min(100, Math.max(0, round1(pctOf(e.clientX))));
    const added = { offset: pos, color: colorAt(g.stops, pos) };
    const next = [...g.stops, added].sort((a, b) => a.offset - b.offset);
    sel = next.indexOf(added);
    emit(withStops(next));
  }

  $: css = gradientCss(g, true);
</script>

<div class="grad">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="bar-wrap">
    <div class="bar-checker"><div class="bar" bind:this={bar} style="background:{css}" on:pointerdown={barDown} title="Click to add a color stop"></div></div>
    {#each g.stops as s, i}
      <button type="button" class="handle" class:active={i === sel} style="left:{s.offset}%" aria-label="Color stop {i + 1} at {s.offset}%"
        on:pointerdown={e => handleDown(e, i)} on:keydown={e => handleKey(e, i)}>
        <span class="chip" style="background:{s.color}"></span>
      </button>
    {/each}
  </div>

  <div class="row">
    <label class="lbl" for="grad-pos">Stop</label>
    <input id="grad-pos" class="num" type="number" min="0" max="100" step="1" value={stop.offset}
      on:input={e => { const v = parseFloat(e.currentTarget.value); if (Number.isFinite(v)) moveStop(sel, v); }} />
    <span class="unit">%</span>
    <button type="button" class="mini danger" title="Remove the selected stop" aria-label="Remove the selected stop" disabled={g.stops.length <= 2} on:click={removeStop}>✕</button>
    <button type="button" class="mini" title="Reverse the gradient" on:click={() => emit(withStops(reverseStops(g.stops)))}>⇄</button>
  </div>

  <ColorPicker value={stop.color} showAlpha={true} on:change={e => setStopColor(e.detail)} />

  {#if g.type === 'linear'}
    <div class="slider"><span class="lbl">Angle</span>
      <SliderInput value={Math.round(g.angle)} min={0} max={360} step={1} unit="°" onChange={v => emit({ ...g, angle: v })} /></div>
  {:else}
    <div class="slider"><span class="lbl">Center X</span>
      <SliderInput value={Math.round(g.cx)} min={-50} max={150} step={1} unit="%" onChange={v => emit({ ...g, cx: v })} /></div>
    <div class="slider"><span class="lbl">Center Y</span>
      <SliderInput value={Math.round(g.cy)} min={-50} max={150} step={1} unit="%" onChange={v => emit({ ...g, cy: v })} /></div>
    <div class="slider"><span class="lbl">Radius</span>
      <SliderInput value={Math.round(g.r)} min={1} max={200} step={1} unit="%" onChange={v => emit({ ...g, r: v })} /></div>
  {/if}
</div>

<style>
  .grad { display: flex; flex-direction: column; gap: 10px; }
  .bar-wrap { position: relative; padding-bottom: 16px; }
  .bar-checker {
    border: 1px solid var(--border-color); border-radius: 4px; overflow: hidden;
    background-color: #fff;
    background-image: linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%);
    background-size: 10px 10px; background-position: 0 0, 0 5px, 5px -5px, -5px 0;
  }
  .bar { height: 24px; cursor: copy; touch-action: none; }
  .handle {
    position: absolute; bottom: 0; width: 14px; height: 18px; margin-left: -7px; padding: 0; border: none; background: transparent;
    cursor: ew-resize; touch-action: none;
  }
  .handle::before {
    content: ''; position: absolute; left: 3px; top: 0; border: 4px solid transparent; border-bottom: 5px solid var(--text-color); opacity: 0.55;
  }
  .handle.active::before { border-bottom-color: var(--accent-color); opacity: 1; }
  .chip { position: absolute; left: 0; top: 4px; width: 14px; height: 14px; border-radius: 3px; border: 2px solid var(--border-color); box-sizing: border-box; }
  .handle.active .chip { border-color: var(--accent-color); }
  .handle:focus-visible { outline: 2px solid var(--accent-color); outline-offset: 1px; border-radius: 3px; }
  .row { display: flex; align-items: center; gap: 6px; }
  .lbl { font-size: 0.75rem; opacity: 0.7; }
  .num {
    width: 52px; height: 24px; padding: 0 4px; border: 1px solid var(--border-color); border-radius: 4px;
    background: var(--bg-color); color: var(--text-color); font-size: 0.8rem;
  }
  .unit { font-size: 0.75rem; opacity: 0.7; margin-right: auto; }
  .mini {
    height: 24px; padding: 0 7px; border: 1px solid var(--border-color); border-radius: 4px; background: transparent;
    color: var(--text-color); font-size: 0.75rem; cursor: pointer;
  }
  .mini:hover:not(:disabled) { background: var(--ruler-bg); }
  .mini:disabled { opacity: 0.35; cursor: not-allowed; }
  .mini.danger:hover:not(:disabled) { background: #e74c3c18; border-color: #e74c3c55; color: #e74c3c; }
  .slider { display: flex; flex-direction: column; gap: 2px; }
</style>
