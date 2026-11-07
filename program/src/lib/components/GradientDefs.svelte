<script lang="ts">
  /**
   * @file The <linearGradient> / <radialGradient> for one gradient paint.
   */
  import { linearCoords, stopPaint, type Gradient } from '../utils/gradient';
  export let gradient: Gradient;
  export let id: string;
  $: lin = gradient.type === 'linear' ? linearCoords(gradient.angle) : null;
</script>

{#if gradient.type === 'linear' && lin}
  <linearGradient {id} x1={lin.x1} y1={lin.y1} x2={lin.x2} y2={lin.y2}>
    {#each gradient.stops as s}
      <stop offset={s.offset / 100} stop-color={stopPaint(s.color).color} stop-opacity={stopPaint(s.color).opacity < 1 ? stopPaint(s.color).opacity : undefined} />
    {/each}
  </linearGradient>
{:else if gradient.type === 'radial'}
  <radialGradient {id} cx={gradient.cx / 100} cy={gradient.cy / 100} r={gradient.r / 100}>
    {#each gradient.stops as s}
      <stop offset={s.offset / 100} stop-color={stopPaint(s.color).color} stop-opacity={stopPaint(s.color).opacity < 1 ? stopPaint(s.color).opacity : undefined} />
    {/each}
  </radialGradient>
{/if}
