<script lang="ts">
  /**
   * @file Node-editing overlay for one shape: anchors, the selected node's Bézier handles, and radius handles.
   * Corner nodes are squares, smooth nodes circles, radius handles orange diamonds. Drawn in the shape's local frame,
   * inside its rotation.
   */
  import type { Shape } from '../utils/types';
  import { getEditNodes, getRotationOrigin } from '../utils/shapes';
  import { coarse, TOUCH_HIT_R } from '../stores/media';

  export let shape: Shape;
  export let zoom = 1;
  export let active: string | null = null;
  /** Anchors picked together (filled like the active one). */
  export let picked: readonly string[] = [];

  const R = 5;
  const BLUE = '#4A90D9', ORANGE = '#e67e22';

  $: o      = getRotationOrigin(shape);
  $: smoothAt = (i: number | undefined) => shape.type === 'path' && i !== undefined && shape.nodes[i]?.smooth;
  $: anchorOf = (i: number | undefined) => (shape.type === 'path' && i !== undefined ? shape.nodes[i] : null);
  // Bézier handles are shown for the active node ('a3', 'i3', 'o3' all mean node 3) and every picked one.
  $: withHandles = new Set([
    ...(active && /^[aio]\d+$/.test(active) ? [+active.slice(1)] : []),
    ...picked.filter(id => /^a\d+$/.test(id)).map(id => +id.slice(1)),
  ]);
  $: nodes = getEditNodes(shape).filter(n => (n.kind !== 'hin' && n.kind !== 'hout') || withHandles.has(n.node!));
</script>

<g transform={shape.rotation ? `rotate(${shape.rotation} ${o.x} ${o.y})` : undefined}>
  <!-- handle connector lines -->
  {#each nodes as n}
    {#if n.kind === 'hin' || n.kind === 'hout'}
      {@const a = anchorOf(n.node)}
      {#if a}
        <line x1={a.x} y1={a.y} x2={n.x} y2={n.y} stroke={BLUE} stroke-width={1 / zoom} opacity="0.7" pointer-events="none" />
      {/if}
    {/if}
  {/each}

  {#if $coarse}
    <!-- Touch: invisible grab areas a finger can hit, under the visible nodes -->
    {#each nodes as n (n.id)}
      <circle data-node={n.id} cx={n.x} cy={n.y} r={TOUCH_HIT_R / zoom} fill="rgba(0,0,0,0)" pointer-events="all" />
    {/each}
  {/if}
  {#each nodes as n (n.id)}
    {@const on = active === n.id || picked.includes(n.id)}
    {#if n.kind === 'radius'}
      <rect
        data-node={n.id}
        x={n.x - 4.5 / zoom} y={n.y - 4.5 / zoom} width={9 / zoom} height={9 / zoom}
        transform="rotate(45 {n.x} {n.y})"
        fill={on ? ORANGE : 'white'} stroke={ORANGE} stroke-width={1.5 / zoom}
        style="cursor:move" pointer-events="all"
      />
    {:else if n.kind === 'hin' || n.kind === 'hout'}
      <circle
        data-node={n.id} cx={n.x} cy={n.y} r={3.5 / zoom}
        fill={on ? BLUE : 'white'} stroke={BLUE} stroke-width={1.5 / zoom}
        style="cursor:move" pointer-events="all"
      />
    {:else if shape.type === 'path' && !smoothAt(n.node)}
      <rect
        data-node={n.id} x={n.x - R / zoom} y={n.y - R / zoom} width={R * 2 / zoom} height={R * 2 / zoom}
        fill={on ? BLUE : 'white'} stroke={BLUE} stroke-width={1.5 / zoom}
        style="cursor:move" pointer-events="all"
      />
    {:else}
      <circle
        data-node={n.id} cx={n.x} cy={n.y} r={R / zoom}
        fill={on ? BLUE : 'white'} stroke={BLUE} stroke-width={1.5 / zoom}
        style="cursor:move" pointer-events="all"
      />
    {/if}
  {/each}
</g>
