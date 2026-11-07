<script lang="ts">
  /**
   * @file Selection boxes and handles.
   * One shape: its dashed box (inside its rotation, so it turns with it), 8 resize handles and the rotation knob.
   * Several shapes: each keeps its own dashed box; the handles and the knob sit on the common box and transform all.
   * Sizes are screen pixels (divided by the zoom).
   */
  import type { Shape, BoundingBox } from '../utils/types';
  import { getVisualBounds, getRotationOrigin, getWorldBounds, unionBounds, getPivot, getLocalBounds } from '../utils/shapes';
  import { fontEpoch, afterFonts } from '../utils/text';
  import { coarse, TOUCH_HIT_R } from '../stores/media';

  export let shapes: Shape[] = [];
  export let zoom = 1;

  const R = 5;                 // handle half-size (px)
  const KNOB_OFFSET = 26;      // px above the top edge
  const BLUE = '#4A90D9';

  $: multi = shapes.length > 1;
  // The box the handles sit on: the shape's own (rotated) box, or the common world box of the selection.
  // One shape: the box and handles sit on its VISIBLE edge (stroke included); resizing compensates for that gap (tools/select.ts).
  $: b = shapes.length === 1
    ? afterFonts($fontEpoch, getVisualBounds(shapes[0]))
    : multi ? afterFonts($fontEpoch, unionBounds(shapes.map(getWorldBounds))) : null;
  $: handleRot = shapes.length === 1 ? shapes[0].rotation : 0;
  $: o = shapes.length === 1 ? getRotationOrigin(shapes[0])
       : b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null;
  $: boxes = afterFonts($fontEpoch, shapes.map(s => ({ s, b: getVisualBounds(s), o: getRotationOrigin(s) })));

  const handlePositions = (b: BoundingBox) => ({
    nw: { x: b.x,              y: b.y },
    n:  { x: b.x + b.width / 2, y: b.y },
    ne: { x: b.x + b.width,    y: b.y },
    e:  { x: b.x + b.width,    y: b.y + b.height / 2 },
    se: { x: b.x + b.width,    y: b.y + b.height },
    s:  { x: b.x + b.width / 2, y: b.y + b.height },
    sw: { x: b.x,              y: b.y + b.height },
    w:  { x: b.x,              y: b.y + b.height / 2 },
  });
  $: handles = (b ? handlePositions(b) : {}) as Record<string, { x: number; y: number }>;

  // The rotation origin of ONE shape: a crosshair that can be dragged (tools/select.ts). Left out while the shape is
  // small on screen, where it would sit exactly where people grab the shape to move it (Geometry → Origin still works).
  $: lb = shapes.length === 1 ? getLocalBounds(shapes[0]) : null;
  $: pivot = lb && Math.min(lb.width, lb.height) * zoom >= 40 ? getPivot(shapes[0]) : null;
  $: customPivot = shapes.length === 1 && !!shapes[0].origin;

  const cursorFor = (n: string) =>
    n === 'n' || n === 's' ? 'ns-resize' : n === 'e' || n === 'w' ? 'ew-resize'
    : n === 'nw' || n === 'se' ? 'nwse-resize' : 'nesw-resize';
</script>

{#each boxes as bx (bx.s.id)}
  <g transform={bx.s.rotation ? `rotate(${bx.s.rotation} ${bx.o.x} ${bx.o.y})` : undefined} pointer-events="none">
    <rect
      x={bx.b.x - 1 / zoom} y={bx.b.y - 1 / zoom} width={bx.b.width + 2 / zoom} height={bx.b.height + 2 / zoom}
      fill="none" stroke={BLUE} stroke-width={1 / zoom} stroke-dasharray="{4 / zoom},{3 / zoom}"
    />
  </g>
{/each}

{#if b && o}
  <g transform={handleRot ? `rotate(${handleRot} ${o.x} ${o.y})` : undefined}>
    <line
      x1={b.x + b.width / 2} y1={b.y} x2={b.x + b.width / 2} y2={b.y - KNOB_OFFSET / zoom}
      stroke={BLUE} stroke-width={1 / zoom} pointer-events="none"
    />
    {#if $coarse}
      <!-- Touch: invisible grab areas a finger can hit, under the visible handles -->
      <circle data-rotate cx={b.x + b.width / 2} cy={b.y - KNOB_OFFSET / zoom} r={TOUCH_HIT_R / zoom} fill="rgba(0,0,0,0)" pointer-events="all" />
      {#each Object.entries(handles) as [name, pos]}
        <circle data-handle={name} cx={pos.x} cy={pos.y} r={TOUCH_HIT_R / zoom} fill="rgba(0,0,0,0)" pointer-events="all" />
      {/each}
    {/if}
    <circle
      data-rotate cx={b.x + b.width / 2} cy={b.y - KNOB_OFFSET / zoom} r={5.5 / zoom}
      fill="white" stroke={BLUE} stroke-width={1.5 / zoom} style="cursor:grab" pointer-events="all"
    />
    {#each Object.entries(handles) as [name, pos]}
      <rect
        data-handle={name}
        x={pos.x - R / zoom} y={pos.y - R / zoom} width={R * 2 / zoom} height={R * 2 / zoom} rx={1 / zoom}
        fill="white" stroke={BLUE} stroke-width={1.5 / zoom}
        style="cursor:{cursorFor(name)}" pointer-events="all"
      />
    {/each}
  </g>
{/if}

{#if pivot}
  {@const r = 6 / zoom}
  <g data-pivot style="cursor:move" pointer-events="all">
    <title>Rotation origin: drag to move, double-click to centre</title>
    <circle cx={pivot.x} cy={pivot.y} r={r} fill={customPivot ? BLUE : 'white'} fill-opacity={customPivot ? 0.25 : 0.7} stroke={BLUE} stroke-width={1.2 / zoom} />
    <line x1={pivot.x - r * 1.6} y1={pivot.y} x2={pivot.x + r * 1.6} y2={pivot.y} stroke={BLUE} stroke-width={1.2 / zoom} />
    <line x1={pivot.x} y1={pivot.y - r * 1.6} x2={pivot.x} y2={pivot.y + r * 1.6} stroke={BLUE} stroke-width={1.2 / zoom} />
  </g>
{/if}
