<script lang="ts">
  import type { Shape, ToolType } from '../utils/types';

  export let shape:        Shape;
  export let isTemp        = false;
  export let isSelected    = false;
  export let selectedTool: ToolType = 'transform';
  export let zoom          = 1;
  export let isEditing     = false;

  function pts(points: {x:number;y:number}[]) {
    return points.map(p => `${p.x},${p.y}`).join(' ');
  }

  function splitColor(color: string): { hex: string; op: number } {
    if (!color || color === 'none' || color === 'transparent') return { hex: color, op: 1 };
    if (color.length === 9 && color.startsWith('#')) {
      return {
        hex: color.slice(0, 7),
        op:  Math.round(parseInt(color.slice(7, 9), 16) / 255 * 1000) / 1000,
      };
    }
    return { hex: color, op: 1 };
  }

  $: opacity  = isTemp ? 0.5 : (shape.opacity ?? 1);
  $: vis      = shape.visible === false ? 'none' : null;

  $: fillSplit   = splitColor(shape.fill);
  $: strokeSplit = splitColor(shape.stroke);
  $: fillOp   = fillSplit.op;
  $: strokeOp = strokeSplit.op;

  $: linecap   = (shape as any).strokeLinecap   ?? 'round';
  $: linejoin  = (shape as any).strokeLinejoin  ?? 'round';
  $: dasharray = (shape as any).strokeDasharray ?? '';

  $: rotTransform = shape.rotation
    ? (() => {
        switch (shape.type) {
          case 'rectangle':
            return `rotate(${shape.rotation} ${shape.x + shape.width/2} ${shape.y + shape.height/2})`;
          case 'ellipse':
            return `rotate(${shape.rotation} ${shape.cx} ${shape.cy})`;
          case 'text':
            // Rotation pivots around the text anchor point (x, y).
            // Canvas.svelte getRotationOrigin must use the same point.
            return `rotate(${shape.rotation} ${shape.x} ${shape.y})`;
          case 'line':
            return `rotate(${shape.rotation} ${(shape.x1 + shape.x2)/2} ${(shape.y1 + shape.y2)/2})`;
          default: {
            const s    = shape as any;
            const raw  = s.points as Array<{x:number; y:number}> | undefined;
            const used = shape.type === 'arc' ? raw?.slice(0, 2) : raw;
            if (!used?.length) return '';
            const xs = used.map((p:{x:number}) => p.x);
            const ys = used.map((p:{y:number}) => p.y);
            return `rotate(${shape.rotation} ${(Math.min(...xs)+Math.max(...xs))/2} ${(Math.min(...ys)+Math.max(...ys))/2})`;
          }
        }
      })()
    : '';
</script>

{#if shape.type === 'line'}
  <line
    x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2}
    stroke={strokeSplit.hex} stroke-width={shape.strokeWidth}
    stroke-opacity={strokeOp < 1 ? strokeOp : undefined}
    stroke-linecap={linecap} stroke-dasharray={dasharray || undefined}
    opacity={opacity} style:display={vis}
    transform={rotTransform || undefined}
  />

{:else if shape.type === 'rectangle'}
  <rect
    x={shape.x} y={shape.y} width={shape.width} height={shape.height}
    rx={shape.rx ?? 0} ry={shape.ry ?? 0}
    fill={fillSplit.hex} fill-opacity={fillOp < 1 ? fillOp : undefined}
    stroke={strokeSplit.hex} stroke-width={shape.strokeWidth}
    stroke-opacity={strokeOp < 1 ? strokeOp : undefined}
    stroke-linejoin={linejoin} stroke-dasharray={dasharray || undefined}
    opacity={opacity} style:display={vis}
    transform={rotTransform || undefined}
  />

{:else if shape.type === 'ellipse'}
  <ellipse
    cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry}
    fill={fillSplit.hex} fill-opacity={fillOp < 1 ? fillOp : undefined}
    stroke={strokeSplit.hex} stroke-width={shape.strokeWidth}
    stroke-opacity={strokeOp < 1 ? strokeOp : undefined}
    stroke-dasharray={dasharray || undefined}
    opacity={opacity} style:display={vis}
    transform={rotTransform || undefined}
  />

{:else if shape.type === 'polygon'}
  {#if shape.closed === false}
    <polyline
      points={pts(shape.points)}
      fill="none"
      stroke={strokeSplit.hex} stroke-width={shape.strokeWidth}
      stroke-opacity={strokeOp < 1 ? strokeOp : undefined}
      stroke-linecap={linecap} stroke-linejoin={linejoin}
      stroke-dasharray={dasharray || undefined}
      opacity={opacity} style:display={vis}
      transform={rotTransform || undefined}
    />
  {:else}
    <polygon
      points={pts(shape.points)}
      fill={fillSplit.hex}
      fill-opacity={fillOp < 1 ? fillOp : undefined}
      stroke={strokeSplit.hex} stroke-width={shape.strokeWidth}
      stroke-opacity={strokeOp < 1 ? strokeOp : undefined}
      stroke-linejoin={linejoin} stroke-dasharray={dasharray || undefined}
      opacity={opacity} style:display={vis}
      transform={rotTransform || undefined}
    />
  {/if}

{:else if shape.type === 'text'}
  {#if !isEditing}
    {@const deco = shape.textDecoration === 'underline' ? 'underline' : 'none'}
    <text
      x={shape.x} y={shape.y}
      font-family={shape.fontFamily}
      font-size={shape.fontSize}
      font-weight={shape.fontWeight}
      font-style={shape.fontStyle}
      text-decoration={deco}
      text-anchor={shape.textAnchor}
      letter-spacing={shape.letterSpacing != null && shape.letterSpacing !== 0
        ? shape.letterSpacing : undefined}
      fill={fillSplit.hex}
      fill-opacity={fillOp < 1 ? fillOp : undefined}
      opacity={opacity} style:display={vis}
      transform={rotTransform || undefined}
    >
      {#each (shape.content ?? '').split('\n') as line, i}
        <tspan x={shape.x} dy={i === 0 ? 0 : shape.fontSize * 1.25}>{line}</tspan>
      {/each}
    </text>

    {#if isSelected && !(selectedTool === 'transform' || selectedTool === 'edit')}
      {@const lines = (shape.content ?? '').split('\n')}
      {@const maxLen = Math.max(...lines.map(l => l.length), 1)}
      {@const bw = shape.fontSize * maxLen * 0.62 + 4/zoom}
      {@const bh = shape.fontSize * 1.25 * lines.length + 4/zoom}
      {@const bx = shape.textAnchor === 'end'    ? shape.x - bw + 2/zoom
                 : shape.textAnchor === 'middle' ? shape.x - bw / 2 + 1/zoom
                 : shape.x - 2/zoom}
      {@const by = shape.y - shape.fontSize - 2/zoom}
      <rect
        x={bx} y={by}
        width={bw} height={bh}
        fill="none" stroke="#4A90D9" stroke-width={1.5/zoom}
        stroke-dasharray="{5/zoom},{3/zoom}"
        transform={rotTransform || undefined}
        pointer-events="none"
      />
    {/if}
  {/if}

{:else}
  <path
    d={shape.pathData}
    fill={fillSplit.hex} fill-opacity={fillOp < 1 ? fillOp : undefined}
    stroke={strokeSplit.hex} stroke-width={shape.strokeWidth}
    stroke-opacity={strokeOp < 1 ? strokeOp : undefined}
    stroke-linecap={linecap} stroke-linejoin={linejoin}
    stroke-dasharray={dasharray || undefined}
    opacity={opacity} style:display={vis}
    transform={rotTransform || undefined}
  />
  {#if isSelected && selectedTool !== 'transform' && selectedTool !== 'edit'}
    <path d={shape.pathData}
      fill="none" stroke="#4A90D9" stroke-width={shape.strokeWidth + 4} opacity="0.3"
      pointer-events="none" />
  {/if}
{/if}