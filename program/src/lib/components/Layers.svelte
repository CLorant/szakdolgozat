<script lang="ts">
	import { editorStore } from '../stores/editorStore';
	import type { Shape } from '../utils/types';

	let shapes: Shape[] = [];
	// Was declared as `string[] | null` but template used the non-existent singular
	// `selectedShapeId` — this caused a ReferenceError that froze the panel.
	let selectedShapeIds: string[] = [];
	let renamingId: string | null = null;
	let renameValue = '';

	editorStore.subscribe((s) => {
		shapes = s.shapes;
		selectedShapeIds = s.selectedShapeIds;
	});

	// Display in reverse order: topmost shape first
	$: displayShapes = [...shapes].reverse();

	function shapeLabel(shape: Shape): string {
		if (shape.name) return shape.name;
		const labels: Record<string, string> = {
			line: 'Line',
			rectangle: 'Rectangle',
			ellipse: 'Ellipse',
			polygon: 'Polygon',
			freehand: 'Freehand',
			'quadratic-bezier': 'Quad Bézier',
			'cubic-bezier': 'Cubic Bézier',
			arc: 'Arc',
			text: 'Text',
		};
		return labels[shape.type] ?? shape.type;
	}

	function shapeIcon(type: string): string {
		const icons: Record<string, string> = {
			line: '╱',
			rectangle: '▭',
			ellipse: '⬭',
			polygon: '⬡',
			freehand: '✏',
			'quadratic-bezier': '∿',
			'cubic-bezier': '∿',
			arc: '◜',
			text: 'T',
		};
		return icons[type] ?? '◻';
	}

	function startRename(shape: Shape) {
		renamingId = shape.id;
		renameValue = shape.name || shapeLabel(shape);
	}

	function commitRename() {
		if (renamingId) {
			editorStore.renameShape(renamingId, renameValue.trim());
		}
		renamingId = null;
	}

	function handleRenameKey(e: KeyboardEvent) {
		if (e.key === 'Enter') commitRename();
		if (e.key === 'Escape') renamingId = null;
	}

	function toggleVisibility(e: MouseEvent, shape: Shape) {
		e.stopPropagation();
		editorStore.setShapeVisibility(shape.id, !shape.visible);
	}

	function deleteShape(e: MouseEvent, id: string) {
		e.stopPropagation();
		editorStore.deleteShape(id);
	}

	function moveUp(e: MouseEvent, id: string) {
		e.stopPropagation();
		editorStore.moveShapeUp(id);
	}

	function moveDown(e: MouseEvent, id: string) {
		e.stopPropagation();
		editorStore.moveShapeDown(id);
	}
</script>

<div class="layers-panel">
	<div class="panel-header">
		<span class="panel-title">Layers</span>
		<span class="shape-count">{shapes.length}</span>
	</div>

	{#if shapes.length === 0}
		<div class="empty-state">No shapes yet</div>
	{:else}
		<ul class="layer-list">
			{#each displayShapes as shape (shape.id)}
				<!-- svelte-ignore a11y-click-events-have-key-events -->
				<li
					class="layer-item"
					class:selected={selectedShapeIds.includes(shape.id)}
					class:hidden={shape.visible === false}
					on:click={() => editorStore.selectShape(shape.id)}
				>
					<span class="shape-icon" aria-hidden="true">{shapeIcon(shape.type)}</span>

					{#if renamingId === shape.id}
						<!-- svelte-ignore a11y-autofocus -->
						<input
							class="rename-input"
							type="text"
							bind:value={renameValue}
							autofocus
							on:blur={commitRename}
							on:keydown={handleRenameKey}
							on:click|stopPropagation={() => {}}
						/>
					{:else}
						<span class="layer-name" on:dblclick|stopPropagation={() => startRename(shape)}>
							{shapeLabel(shape)}
						</span>
					{/if}

					<div class="layer-actions">
						<button
							class="action-btn z-btn"
							title="Move up"
							on:click={(e) => moveUp(e, shape.id)}
							disabled={shape.id === shapes[shapes.length - 1]?.id}
						>▲</button>
						<button
							class="action-btn z-btn"
							title="Move down"
							on:click={(e) => moveDown(e, shape.id)}
							disabled={shape.id === shapes[0]?.id}
						>▼</button>
						<button
							class="action-btn vis-btn"
							title={shape.visible === false ? 'Show' : 'Hide'}
							on:click={(e) => toggleVisibility(e, shape)}
						>{shape.visible === false ? '○' : '●'}</button>
						<button
							class="action-btn del-btn"
							title="Delete"
							on:click={(e) => deleteShape(e, shape.id)}
						>✕</button>
					</div>

					<!-- color swatch -->
					<span
						class="color-dot"
						style="background:{shape.type === 'line' ? shape.stroke : shape.fill};"
						title="Fill color"
					></span>
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

	.panel-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid var(--border-color);
		background: var(--toolbar-header);
		flex-shrink: 0;
	}

	.panel-title {
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-color);
		opacity: 0.7;
	}

	.shape-count {
		font-size: 0.7rem;
		background: var(--border-color);
		color: var(--text-color);
		border-radius: 10px;
		padding: 0 6px;
		min-width: 18px;
		text-align: center;
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

	.layer-actions {
		display: none;
		align-items: center;
		gap: 2px;
	}

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

	.del-btn:hover:not(:disabled) {
		background: #e74c3c22;
		color: #e74c3c;
		opacity: 1;
	}
</style>