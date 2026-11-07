<script lang="ts">
  /**
   * @file In-canvas text editor: a <textarea> in a <foreignObject>, placed where the text is drawn. Reports changes with
   * onInput; Esc or Ctrl+Enter call onCommit. A click elsewhere commits too (Canvas handles it).
   */
  import { onMount, tick } from 'svelte';
  import type { TextShape } from '../utils/types';
  import { cssFontFamily } from '../utils/text';
  import { solidOf } from '../utils/gradient';
  import { getRotationOrigin } from '../utils/shapes';

  export let shape: TextShape;
  export let content = '';
  export let onInput: (value: string) => void = () => {};
  export let onCommit: () => void = () => {};

  let el: HTMLTextAreaElement;
  const openedAt = Date.now();

  $: fs  = shape.fontSize;
  $: foW = Math.max(300, fs * 20);
  $: foX = shape.textAnchor === 'middle' ? shape.x - foW / 2 : shape.textAnchor === 'end' ? shape.x - foW : shape.x;
  // The textarea's first baseline sits half a line of leading below its top; move it so it matches the text.
  $: foY = shape.y - fs - ((shape.lineHeight || 1.25) - 1.25) * fs / 2;
  $: origin = getRotationOrigin(shape);

  function fit() {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }

  onMount(() => {
    // Focus at once, so the first keys typed right after the click are not lost; select the old text only if nothing
    // has been typed yet (the delayed pass waits for the browser to finish moving focus after the click).
    el?.focus({ preventScroll: true });
    const initial = el?.value;
    tick().then(() => setTimeout(() => { el?.focus({ preventScroll: true }); if (el && el.value === initial) el.select(); fit(); }, 0));
  });

  function input() { onInput(el.value); fit(); }
  function keydown(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); onCommit(); }
  }
  // A blur right after opening is the browser settling focus, not the user leaving.
  function blur() { if (Date.now() - openedAt > 250) onCommit(); }
</script>

<foreignObject
  x={foX} y={foY} width={foW} height={fs * 10}
  transform={shape.rotation ? `rotate(${shape.rotation} ${origin.x} ${origin.y})` : undefined}
>
  <textarea
    bind:this={el}
    class="svg-text-editor"
    style="
      font-family:{cssFontFamily(shape.fontFamily)}; font-size:{fs}px;
      font-weight:{shape.fontWeight}; font-style:{shape.fontStyle};
      text-decoration:{shape.textDecoration || 'none'}; word-spacing:{shape.wordSpacing || 0}px;
      text-align:{shape.textAnchor === 'end' ? 'right' : shape.textAnchor === 'middle' ? 'center' : 'left'};
      color:{solidOf(shape.fill)}; letter-spacing:{shape.letterSpacing || 0}px;
      line-height:{shape.lineHeight || 1.25}; padding-top:{fs * 0.1}px;
    "
    value={content}
    on:input={input}
    on:keydown={keydown}
    on:blur={blur}
    placeholder="Type here…"
    spellcheck="false"
  ></textarea>
</foreignObject>

<style>
  :global(.svg-text-editor) {
    display: block; width: 100%; min-height: 1.3em;
    background: rgba(74, 144, 217, 0.06);
    border: 1.5px dashed #4A90D9; border-radius: 2px;
    outline: none; resize: none; overflow: hidden;
    padding: 0 2px; box-sizing: border-box; scrollbar-width: none;
    white-space: pre-wrap; word-break: break-word; caret-color: currentColor;
  }
  :global(.svg-text-editor::-webkit-scrollbar) { display: none; }
  :global(.svg-text-editor::placeholder) { color: #4A90D9; opacity: 0.4; font-style: italic; }
</style>
