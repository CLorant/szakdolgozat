<script lang="ts">
  /**
   * @file Renders one shape as a <g data-shape-id>, so the browser's own hit-testing tells the tools what was clicked
   * (right for curves, strokes, rotation and text). Thin or hollow shapes get an invisible wide-stroke copy, so they
   * are easy to grab.
   */
  import type { Shape } from '../utils/types';
  import { pathToD } from '../utils/path';
  import { getLocalBounds, shapeTransform } from '../utils/shapes';
  import { splitColor } from '../utils/serializer';
  import { parseGradient, paintId } from '../utils/gradient';
  import GradientDefs from './GradientDefs.svelte';
  import { cssFontFamily, lineAdvance, fontEpoch, afterFonts } from '../utils/text';

  export let shape: Shape;
  export let zoom = 1;
  /** Preview shape while drawing: half transparent, never hit-testable. */
  export let isTemp = false;
  /** Hidden while the in-canvas text editor is showing it. */
  export let hidden = false;
  /** Id of the text shape being edited in place (hidden at any depth). */
  export let hiddenId: string | null = null;
  /** Inside a locked group: not hit-testable either. */
  export let lockedParent = false;
  /** Locked shapes let every click through to what is under them (utils/types.ts: locked). */
  $: inert = isTemp || lockedParent || !!shape.locked;

  // A gradient paint is drawn through a <linearGradient>/<radialGradient> of its own (ids derive from the shape's id).
  $: fillGrad   = parseGradient(shape.fill);
  $: strokeGrad = parseGradient(shape.stroke);
  $: fillId     = paintId(shape.id, 'fill');
  $: strokeId   = paintId(shape.id, 'stroke');
  $: fill   = fillGrad ? { hex: `url(#${fillId})`, opacity: 1 } : splitColor(shape.fill);
  $: stroke = strokeGrad ? { hex: `url(#${strokeId})`, opacity: 1 } : splitColor(shape.stroke);

  // re-measure text when a web font finishes loading
  $: transform = afterFonts($fontEpoch, shapeTransform(shape));

  $: paint = {
    fill: fill.hex,
    'fill-opacity': fill.opacity < 1 ? fill.opacity : undefined,
    stroke: stroke.hex === 'none' || !shape.strokeWidth ? 'none' : stroke.hex,
    'stroke-opacity': stroke.opacity < 1 ? stroke.opacity : undefined,
    'stroke-width': shape.strokeWidth,
    'stroke-linecap': shape.strokeLinecap,
    'stroke-linejoin': shape.strokeLinejoin,
    'stroke-dasharray': shape.strokeDasharray || undefined,
    'stroke-dashoffset': shape.strokeDasharray && shape.strokeDashoffset ? shape.strokeDashoffset : undefined,
    'fill-rule': shape.type === 'path' && shape.fillRule === 'evenodd' ? 'evenodd' : undefined,
  } as Record<string, any>;

  function geometry(s: Shape): { tag: string; attrs: Record<string, number | string> } | null {
    switch (s.type) {
      case 'line':      return { tag: 'line',    attrs: { x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 } };
      case 'rectangle': return { tag: 'rect',    attrs: { x: s.x, y: s.y, width: s.width, height: s.height, rx: s.rx, ry: s.ry } };
      case 'ellipse':   return { tag: 'ellipse', attrs: { cx: s.cx, cy: s.cy, rx: s.rx, ry: s.ry } };
      case 'path':      return { tag: 'path',    attrs: { d: pathToD(s.nodes, s.closed) } };
      case 'image':     return { tag: 'image',   attrs: { x: s.x, y: s.y, width: s.width, height: s.height, href: s.href, preserveAspectRatio: s.preserveAspectRatio ?? 'none' } };
      default:          return null;
    }
  }
  $: geo = geometry(shape);

  // Shapes with no filled interior need a fat invisible stroke to be easy to click.
  $: needsHitClone = !isTemp && !!geo && shape.type !== 'image' && (shape.type === 'line' || fill.hex === 'none' || (shape.type === 'path' && !shape.closed));
  $: hitWidth = Math.max(shape.strokeWidth, 10 / zoom);
  $: hitProps = {
    fill: 'none', stroke: 'rgba(0,0,0,0)', 'stroke-width': hitWidth, 'pointer-events': 'stroke',
  } as Record<string, any>;

  $: textBox = shape.type === 'text' ? afterFonts($fontEpoch, getLocalBounds(shape)) : null;
</script>

{#if shape.visible && !hidden}
  <g
    data-shape-id={isTemp ? undefined : shape.id}
    {transform}
    opacity={isTemp ? 0.5 : shape.opacity !== 1 ? shape.opacity : undefined}
    pointer-events={inert ? 'none' : undefined}
  >
    {#if shape.type === 'group'}
      {#each shape.children as child (child.id)}
        <svelte:self shape={child} {zoom} {isTemp} {hiddenId} hidden={hiddenId === child.id} lockedParent={inert && !isTemp} />
      {/each}
    {:else if geo}
      {#if fillGrad || strokeGrad}
        <defs>
          {#if fillGrad}<GradientDefs gradient={fillGrad} id={fillId} />{/if}
          {#if strokeGrad}<GradientDefs gradient={strokeGrad} id={strokeId} />{/if}
        </defs>
      {/if}
      <svelte:element this={geo.tag} {...geo.attrs} {...(shape.type === 'image' ? {} : paint)} />
      {#if needsHitClone && !inert}
        <svelte:element this={geo.tag} {...geo.attrs} {...hitProps} />
      {/if}
    {:else if shape.type === 'text' && textBox}
      {#if fillGrad}<defs><GradientDefs gradient={fillGrad} id={fillId} /></defs>{/if}
      {#if !inert}
        <rect x={textBox.x} y={textBox.y} width={textBox.width} height={textBox.height}
          fill="rgba(0,0,0,0)" pointer-events="all" />
      {/if}
      <text
        x={shape.x} y={shape.y}
        font-family={cssFontFamily(shape.fontFamily)} font-size={shape.fontSize}
        font-weight={shape.fontWeight} font-style={shape.fontStyle}
        text-decoration={shape.textDecoration || undefined} text-anchor={shape.textAnchor}
        letter-spacing={shape.letterSpacing || undefined} word-spacing={shape.wordSpacing || undefined}
        fill={fill.hex} fill-opacity={fill.opacity < 1 ? fill.opacity : undefined}
        style="white-space:pre" pointer-events="none"
      >
        {#each (shape.content ?? '').split('\n') as line, i}
          <tspan x={shape.x} dy={i === 0 ? 0 : lineAdvance(shape)}>{line}</tspan>
        {/each}
      </text>
    {/if}
  </g>
{/if}
