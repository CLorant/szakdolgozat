<script lang="ts">
  /**
   * @file The Objects panel: every shape, topmost first, with groups that fold. Click selects, double-click renames,
   * the row buttons lock, hide and delete, and rows are dragged to another place or into a group (touch: hold, then drag).
   */
  import { shapesStore } from '../stores/document';
  import { selectedIds } from '../stores/ui';
  import { editor } from '../stores/editor';
  import type { Shape } from '../utils/types';

  import { parseGradient, gradientCss } from '../utils/gradient';
  import { dropProblem, type DropWhere } from '../utils/tree';

  let renamingId: string | null = null;
  let renameValue = '';
  let collapsed = new Set<string>();                  // groups folded in the panel (default: open)

  /** `locked`: the shape or a group it is in is locked (cannot be selected). */
  interface Row { shape: Shape; depth: number; first: boolean; last: boolean; open: boolean; locked: boolean; }

  /** Tree → rows, topmost first. `first` / `last` = bottom / top of the shape's own sibling list. */
  function buildRows(list: readonly Shape[], folded: ReadonlySet<string>, depth = 0, out: Row[] = [], inLocked = false): Row[] {
    for (let i = list.length - 1; i >= 0; i--) {
      const shape = list[i];
      const open = shape.type === 'group' && !folded.has(shape.id);
      const locked = inLocked || !!shape.locked;
      out.push({ shape, depth, first: i === 0, last: i === list.length - 1, open, locked });
      if (shape.type === 'group' && open) buildRows(shape.children, folded, depth + 1, out, locked);
    }
    return out;
  }

  $: shapes = $shapesStore;
  $: displayRows = buildRows(shapes, collapsed);

  function toggleOpen(id: string) {
    const c = new Set(collapsed);
    c.has(id) ? c.delete(id) : c.add(id);
    collapsed = c;
  }

  function shapeLabel(s: Shape): string {
    if (s.name) return s.name;
    switch (s.type) {
      case 'group':     return 'Group';
      case 'line':      return 'Line';
      case 'rectangle': return 'Rectangle';
      case 'ellipse':   return 'Ellipse';
      case 'text':      return s.content.trim().split('\n')[0].slice(0, 20) || 'Text';
      case 'image':     return 'Image';
      case 'path':      return s.nodes.some(n => n.hin || n.hout) ? 'Curve' : s.closed ? 'Polygon' : 'Polyline';
    }
  }
  const padlock = (closed: boolean) =>
    `<svg viewBox="0 0 10 12" width="9" height="11" aria-hidden="true"><path d="${closed ? 'M3 5.5V3.6a2 2 0 0 1 4 0v1.9' : 'M3 5.5V3.6a2 2 0 0 1 4 0'}" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="1.5" y="5.5" width="7" height="5.5" rx="1" fill="currentColor"/></svg>`;
  const ICONS: Record<string, string> = { group: '▣', line: '╱', rectangle: '▭', ellipse: '⬭', path: '∿', text: 'T', image: '▨' };
  const dotColor = (s: Shape): string => {
    if (s.type === 'group' || s.type === 'image') return 'transparent';
    const paint = s.fill === 'none' ? s.stroke : s.fill;
    const g = parseGradient(paint);
    return g ? gradientCss(g, true) : paint;
  };

  function select(e: MouseEvent, id: string) {
    if (suppressClick) return;
    editor.selectDeep(id, e.shiftKey || e.ctrlKey || e.metaKey);
  }
  function startRename(s: Shape) { renamingId = s.id; renameValue = s.name || shapeLabel(s); }
  function commitRename() {
    if (renamingId) editor.rename(renamingId, renameValue.trim());
    renamingId = null;
  }
  function renameKey(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'Enter') commitRename();
    if (e.key === 'Escape') renamingId = null;
  }
  // ── drag & drop (pointer events: mouse, pen and touch) ──────────────────────
  // Mouse / pen: a row is picked up after the pointer moved a few pixels (a plain click still selects).
  // Touch: a swipe must keep scrolling the list, so a row is picked up by HOLDING it still for a moment; from then
  // on the touchmove events are cancelled, so the browser does not scroll (and does not cancel the pointer).
  // Over a row: the upper quarter drops ABOVE it, the lower quarter BELOW it, the middle INTO it when it is a group.
  const HOLD_MS = 150;
  let dragId: string | null = null;
  let drop: { id: string; where: DropWhere } | null = null;
  let listEl: HTMLElement;
  let suppressClick = false;

  function rowDown(e: PointerEvent, id: string) {
    if (e.button !== 0 || renamingId) return;
    if ((e.target as HTMLElement).closest('button, input')) return;
    const x0 = e.clientX, y0 = e.clientY;
    const touch = e.pointerType === 'touch';
    let started = false;
    const begin = () => { started = true; dragId = id; navigator.vibrate?.(10); };
    const hold = touch ? setTimeout(begin, HOLD_MS) : 0;
    const move = (ev: PointerEvent) => {
      if (!started) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < (touch ? 8 : 5)) return;
        if (touch) { end(ev); return; }        // a swipe before the hold: the list scrolls
        begin();
      }
      drop = locate(ev.clientX, ev.clientY);
    };
    const noScroll = (ev: TouchEvent) => { if (started && ev.cancelable) ev.preventDefault(); };
    const end = (ev: PointerEvent) => {
      clearTimeout(hold);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('touchmove', noScroll);
      if (started) {
        suppressClick = true; setTimeout(() => { suppressClick = false; }, 0);
        if (ev.type === 'pointerup' && drop) editor.moveLayer(id, drop.id, drop.where);
      }
      dragId = null; drop = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    if (touch) window.addEventListener('touchmove', noScroll, { passive: false });
  }

  function locate(x: number, y: number): { id: string; where: DropWhere } | null {
    const el = document.elementFromPoint(x, y)?.closest('li.layer-item') as HTMLElement | null;
    if (!el || !listEl?.contains(el) || !dragId) return null;
    const id = el.dataset.id!;
    const r = el.getBoundingClientRect();
    const t = (y - r.top) / r.height;
    const isGroup = el.classList.contains('group-row');
    const where: DropWhere = isGroup && t > 0.25 && t < 0.75 ? 'inside' : t < 0.5 ? 'above' : 'below';
    return dropProblem(shapes, dragId, id, where) ? null : { id, where };
  }

  const stop = (fn: () => void) => (e: MouseEvent) => { e.stopPropagation(); fn(); };
</script>

<div class="layers-panel">
  {#if shapes.length === 0}
    <div class="empty-state">No shapes yet</div>
  {:else}
    <ul class="layer-list" bind:this={listEl} class:dragging={dragId !== null}>
      {#each displayRows as row (row.shape.id)}
        {@const shape = row.shape}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
        <li
          class="layer-item"
          class:selected={$selectedIds.includes(shape.id)}
          class:hidden={!shape.visible}
          class:locked={row.locked}
          class:group-row={shape.type === 'group'}
          class:drop-above={drop?.id === shape.id && drop.where === 'above'}
          class:drop-below={drop?.id === shape.id && drop.where === 'below'}
          class:drop-inside={drop?.id === shape.id && drop.where === 'inside'}
          class:drag-source={dragId === shape.id}
          data-id={shape.id}
          on:pointerdown={e => rowDown(e, shape.id)}
          on:contextmenu|preventDefault
          style="padding-left:{6 + row.depth * 8}px"
          on:click={e => select(e, shape.id)}
        >
          {#if shape.type === 'group'}
            <button class="action-btn fold-btn" title={row.open ? 'Collapse' : 'Expand'} aria-label={row.open ? 'Collapse group' : 'Expand group'}
              on:click={stop(() => toggleOpen(shape.id))}>{row.open ? '▾' : '▸'}</button>
          {:else if row.depth > 0}
            <span class="fold-spacer" aria-hidden="true"></span>
          {/if}
          <span class="shape-icon" aria-hidden="true">{ICONS[shape.type] ?? '◻'}</span>

          {#if renamingId === shape.id}
            <!-- svelte-ignore a11y_autofocus -->
            <input class="rename-input" type="text" bind:value={renameValue} autofocus
              on:blur={commitRename} on:keydown={renameKey} on:click|stopPropagation />
          {:else}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <span class="layer-name" on:dblclick|stopPropagation={() => startRename(shape)}>{shapeLabel(shape)}</span>
          {/if}

          <div class="layer-actions">
            <button class="action-btn vis-btn" title={shape.visible ? 'Hide' : 'Show'} aria-label={shape.visible ? 'Hide' : 'Show'}
              on:click={stop(() => editor.setVisible(shape.id, !shape.visible))}>{shape.visible ? '●' : '○'}</button>
            <button class="action-btn lock-btn" class:on={shape.locked} title={shape.locked ? 'Unlock' : 'Lock'} aria-label={shape.locked ? 'Unlock' : 'Lock'}
              aria-pressed={!!shape.locked} on:click={stop(() => editor.setLocked(shape.id, !shape.locked))}>{@html padlock(!!shape.locked)}</button>
            <button class="action-btn del-btn" title="Delete" aria-label="Delete"
              on:click={stop(() => editor.deleteShapes([shape.id]))}>✕</button>
          </div>

          {#if shape.locked}
            <!-- Always shown: a locked row cannot be selected, so this is the way to unlock it on a touch screen -->
            <button class="action-btn lock-badge" title="Unlock" aria-label="Unlock"
              on:click={stop(() => editor.setLocked(shape.id, false))}>{@html padlock(true)}</button>
          {/if}
          <span class="color-dot" style="background:{dotColor(shape)};" title="Color"></span>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
	.layers-panel {
		width: 100%;
		background: var(--bg-color);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.empty-state {
		padding: 1.5rem 0.75rem;
		font-size: 0.8rem;
		color: var(--text-color);
		opacity: 0.45;
		text-align: center;
	}

	.layer-list {
		list-style: none;
		margin: 0;
		padding: 2px 0;
		overflow-y: auto;
		flex: 1;
	}

	.layer-item {
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 4px 6px;
		cursor: pointer;
		border-bottom: 1px solid transparent;
		font-size: 0.8rem;
		color: var(--text-color);
		position: relative;
		min-height: 28px;
	}

	.layer-item:hover {
		background: var(--ruler-bg);
	}

	.layer-item.selected {
		background: var(--tool-active);
		border-color: var(--tool-border-active);
	}

	.layer-item.hidden {
		opacity: 0.45;
	}

	.shape-icon {
		font-size: 0.85rem;
		width: 16px;
		text-align: center;
		flex-shrink: 0;
		opacity: 0.7;
	}

	.layer-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.rename-input {
		flex: 1;
		min-width: 0;
		font-size: 0.8rem;
		padding: 1px 4px;
		border: 1px solid var(--tool-border-active);
		border-radius: 3px;
		background: var(--bg-color);
		color: var(--text-color);
		outline: none;
	}

	.color-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		border: 1px solid var(--border-color);
		flex-shrink: 0;
	}

	/* Overlaid on the right end of the row (over the color dot and the end of a long name): showing them
	   takes no space, so nothing in any row — icon, name, dot — moves when a row is hovered. */
	.layer-actions {
		display: none;
		align-items: center;
		gap: 2px;
		position: absolute;
		right: 0px; /*4px;*/
		top: 50%;
		transform: translateY(-50%);
		padding: 1px 2px 1px 8px;
		border-radius: 4px;
		background: linear-gradient(to right, transparent, var(--ruler-bg) 8px);
	}
	.layer-item.selected .layer-actions { background: linear-gradient(to right, transparent, var(--tool-active) 8px); }

	.layer-item:hover .layer-actions,
	.layer-item.selected .layer-actions {
		display: flex;
	}

	.action-btn {
		width: 18px;
		height: 18px;
		padding: 0;
		border: none;
		background: transparent;
		cursor: pointer;
		border-radius: 3px;
		font-size: 0.6rem;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-color);
		opacity: 0.6;
		transition: opacity 0.15s, background 0.15s;
		line-height: 1;
	}

	.action-btn:hover:not(:disabled) {
		opacity: 1;
		background: var(--border-color);
	}

	.action-btn:disabled {
		opacity: 0.2;
		cursor: not-allowed;
	}

	.layer-item.locked { cursor: default; }
	.layer-item.locked .layer-name { opacity: 0.7; }
	.lock-btn.on { opacity: 0.95; }
	.lock-badge { opacity: 0.7; flex-shrink: 0; }

	.del-btn:hover:not(:disabled) {
		background: #e74c3c22;
		color: #e74c3c;
		opacity: 1;
	}
	.fold-btn { width: 14px; padding: 0; opacity: 1; flex-shrink: 0; }
	.fold-spacer { width: 6px; flex-shrink: 0; }
	.layer-item { user-select: none; touch-action: pan-y; }
	.layer-list.dragging { cursor: grabbing; }
	.layer-list.dragging .layer-item { cursor: grabbing; }
	.layer-list.dragging .layer-actions { display: none; }
	.layer-item.drag-source { opacity: 0.4; }
	.layer-item.drop-above::before, .layer-item.drop-below::after {
		content: ''; position: absolute; left: 4px; right: 4px; height: 2px; background: var(--accent-color); border-radius: 1px; pointer-events: none;
	}
	.layer-item.drop-above::before { top: -1px; }
	.layer-item.drop-below::after { bottom: -1px; }
	.layer-item.drop-inside { outline: 2px solid var(--accent-color); outline-offset: -2px; background: var(--tool-active); }
	.group-row .layer-name { font-weight: 600; }
</style>
