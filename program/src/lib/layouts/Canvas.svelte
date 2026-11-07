<script lang="ts">
  /**
   * @file The drawing surface: renders the document and the overlays, turns DOM events into PointerInfo and hands them
   * to the active tool (lib/tools). Behaviour lives in the tools, state in the stores.
   */
  import { onDestroy, onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { documentStore } from '../stores/document';
  import { ui } from '../stores/ui';
  import { viewport, cursor as cursorStore } from '../stores/viewport';
  import { tempShape, guides, snapGuides, guidePreview, activeNode, pickedNodes, textEdit, contextMenu } from '../stores/interaction';
  import { editor, selectedShapes } from '../stores/editor';
  import { createTools } from '../tools';
  import type { PointerInfo } from '../tools';
  import { snapPoint } from '../tools/common';
  import { snapDrawPoint, SNAPPING_TOOLS } from '../tools/snapContext';
  import { setTextContent } from '../utils/shapes';
  import { zoomBy, panBy } from '../utils/zoom';
  import { startGuideDrag } from '../utils/guides';
  import { findShape, groupsOf, toFrame, ancestorsOf, frameTransforms, resolveHit } from '../utils/tree';
  import { shapeIdAt } from '../tools/hit';
  import type { TextShape } from '../utils/types';
  import ShapeRenderer from '../components/ShapeRenderer.svelte';
  import SelectionOverlay from '../components/SelectionOverlay.svelte';
  import EditOverlay from '../components/EditOverlay.svelte';
  import TextEditor from '../components/TextEditor.svelte';

  /** The overflow:auto element around the canvas (needed for panning). */

  let svgEl: SVGSVGElement;
  const GUIDE_COLOR = '#00a5c8';
  /** Light line under snap / guide / knife lines: they stay visible on a shape of their own color. */
  const CASING = 'rgba(255, 255, 255, 0.9)';
  const GUIDE_REACH = 100000;     // guides run far past the page edge in both directions

  $: doc    = $documentStore;
  $: zoom   = $viewport.zoom;
  $: tool   = $ui.tool;
  $: selected = $selectedShapes.filter(s => s.visible);

  // ── tools ─────────────────────────────────────────────────────────────────
  const tools = createTools({ zoom: () => get(viewport).zoom, openText });

  let prevTool = get(ui).tool;
  $: if (tool !== prevTool) {                 // finish / discard whatever the old tool had pending
    tools[prevTool].deactivate();
    prevTool = tool;
    activeNode.set(null);
    pickedNodes.set(null);
    guides.set([]);
    snapGuides.set([]);
  }
  onDestroy(() => tools[get(ui).tool].deactivate());

  // ── coordinates ───────────────────────────────────────────────────────────
  /** Pointer → document units, in the frame of the entered (possibly rotated) group. */
  function framePoint(e: MouseEvent) {
    const r = svgEl.getBoundingClientRect();
    const d = get(documentStore);
    const raw = { x: (e.clientX - r.left) * d.width / r.width, y: (e.clientY - r.top) * d.height / r.height };
    return toFrame(raw, groupsOf(d.shapes, get(ui).groupPath));
  }
  function info(e: MouseEvent): PointerInfo {
    const local = framePoint(e);
    const snap = get(ui).snapEnabled && get(ui).tool !== 'freehand';
    let p = snap ? snapPoint(local) : local;
    // Drawing tools: points snap to other objects, the canvas and guides (per axis, ahead of the grid); Ctrl switches it off.
    const u = get(ui);
    if (u.snapObjects && SNAPPING_TOOLS.has(u.tool) && !(e.ctrlKey || e.metaKey)) {
      const s = snapDrawPoint(local, zoom);
      p = { x: s.x ?? p.x, y: s.y ?? p.y };
      snapGuides.set(s.guides);
    } else if (get(snapGuides).length && SNAPPING_TOOLS.has(u.tool)) snapGuides.set([]);
    return {
      p, raw: local,
      shift: e.shiftKey || get(ui).shiftLock, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey,
      target: e.target as Element | null,
    };
  }

  // ── pointer events ────────────────────────────────────────────────────────
  let pressed = false;
  let spaceDown = false;
  let pan: { x: number; y: number; left: number; top: number } | null = null;

  function onPointerDown(e: PointerEvent) {
    const target = e.target as Element;
    const gi = target.closest?.('[data-guide]')?.getAttribute('data-guide');
    if (gi !== null && gi !== undefined && get(ui).tool === 'transform') {            // a ruler guide: drag it (back onto a ruler = delete)
      const g = get(documentStore).guides?.[+gi];
      if (g) { startGuideDrag(e, g.axis, +gi); return; }
    }
    if (target.closest('.svg-text-editor')) return;                 // let the textarea handle its own clicks
    if (get(textEdit)) commitText();

    if (e.button === 1 || (e.button === 0 && (spaceDown || get(ui).tool === 'pan'))) {   // pan: middle mouse, Space + drag, or the Hand tool
      e.preventDefault();
      const v = viewport.get();
      pan = { x: e.clientX, y: e.clientY, left: v.scrollLeft, top: v.scrollTop };
      return;
    }
    if (e.button !== 0) return;
    e.preventDefault();
    pressed = true;
    armLongPress(e);
    if (e.pointerType === 'touch') {
      // A finger waits a moment before it reaches the tool: if a second finger follows, it was a pinch, and the
      // tool never saw the first one (a Pen node or a selection change would otherwise be left behind).
      const held = { id: e.pointerId, info: info(e), x: e.clientX, y: e.clientY, timer: setTimeout(() => flushTouch(), TOUCH_WAIT_MS) };
      pendingTouch = held;
      return;
    }
    tools[get(ui).tool].down(info(e));
  }

  // ── touch: two fingers pinch-zoom and pan, from any tool ───────────────────
  const TOUCH_WAIT_MS = 90;
  let pendingTouch: { id: number; info: PointerInfo; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null = null;
  const touches = new Map<number, { x: number; y: number }>();
  let pinch: { d: number; x: number; y: number } | null = null;
  /** After a pinch, the finger left on the screen does nothing until every finger is lifted. */
  let pinchLock = false;

  function flushTouch() {
    if (!pendingTouch) return;
    clearTimeout(pendingTouch.timer);
    const p = pendingTouch;
    pendingTouch = null;
    if (pressed) tools[get(ui).tool].down(p.info);
  }
  const pinchState = () => {
    const [a, b] = [...touches.values()];
    return { d: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  /** Capture phase on the drawing area: sees every finger before the canvas does. */
  function onTouchDown(e: PointerEvent) {
    if (e.pointerType !== 'touch') return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size !== 2) { if (touches.size > 2 || pinchLock) { e.stopImmediatePropagation(); e.stopPropagation(); } return; }
    e.stopImmediatePropagation(); e.stopPropagation(); e.preventDefault();
    cancelLongPress();
    if (pendingTouch) { clearTimeout(pendingTouch.timer); pendingTouch = null; pressed = false; }
    else if (pressed) { pressed = false; tools[get(ui).tool].escape(); }   // the first finger had already started
    pan = null;
    pinch = pinchState();
    pinchLock = true;
  }
  function onTouchMove(e: PointerEvent): boolean {
    if (e.pointerType !== 'touch' || !touches.has(e.pointerId)) return false;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!pinch || touches.size < 2) return pinchLock;
    const now = pinchState();
    zoomBy(now.d / pinch.d, { x: now.x, y: now.y });            // the point between the fingers stays put …
    panBy(pinch.x - now.x, pinch.y - now.y);                     // … and follows them when they move together
    pinch = now;
    return true;
  }
  function onTouchEnd(e: PointerEvent): boolean {
    if (e.pointerType !== 'touch') return false;
    touches.delete(e.pointerId);
    if (touches.size < 2) pinch = null;
    if (!touches.size && pinchLock) { pinchLock = false; return true; }
    return pinchLock;
  }

  function onWindowPointerMove(e: PointerEvent) {
    if (onTouchMove(e)) return;
    if (pendingTouch && e.pointerId === pendingTouch.id) {
      if (Math.hypot(e.clientX - pendingTouch.x, e.clientY - pendingTouch.y) < 6) return;
      flushTouch();                                             // a single finger on the move: the tool takes over
    }
    cursorStore.set({ x: e.clientX, y: e.clientY });
    if (longPress && Math.hypot(e.clientX - longPress.x, e.clientY - longPress.y) > 8) cancelLongPress();
    if (pan) {                                                      // client-pixel deltas → no jitter
      viewport.setScroll(pan.left - (e.clientX - pan.x), pan.top - (e.clientY - pan.y));
      return;
    }
    tools[get(ui).tool].move(info(e));
  }

  function onWindowPointerUp(e: PointerEvent) {
    if (onTouchEnd(e)) { cancelLongPress(); pressed = false; return; }
    if (pendingTouch && e.pointerId === pendingTouch.id) flushTouch();   // a quick tap
    cancelLongPress();
    if (pan) { pan = null; return; }
    if (!pressed) return;
    pressed = false;
    tools[get(ui).tool].up(info(e));
    if (['line', 'rectangle', 'ellipse'].includes(get(ui).tool)) snapGuides.set([]);
  }

  function onWindowPointerCancel(e: PointerEvent) {
    onTouchEnd(e);
    if (pendingTouch) { clearTimeout(pendingTouch.timer); pendingTouch = null; }
    cancelLongPress();
    pan = null;
    if (pressed) { pressed = false; tools[get(ui).tool].escape(); }
  }

  function onDblClick(e: MouseEvent) { tools[get(ui).tool].dblclick?.(info(e)); }

  // ── context menu (right-click; a long press on touch screens) ──────────────
  // Right-clicking a shape selects it first (unless it is already part of the selection), right-clicking empty
  // canvas clears the selection: the menu then offers what applies to what is under the pointer.
  function onContextMenu(e: MouseEvent) {
    const target = e.target as Element;
    if (target.closest?.('.svg-text-editor')) return;              // the text field keeps the browser's own menu
    e.preventDefault();
    if ((e as PointerEvent).pointerType === 'touch') return;      // touch: our own long press (below) opens it
    openMenu(target, e);
  }
  function openMenu(target: Element, e: { clientX: number; clientY: number }) {
    const t = tools[get(ui).tool];
    if (pressed) { pressed = false; t.escape(); }                  // a long press also started the tool: undo that
    if (t.busy() || get(textEdit)) return;
    const hitId = shapeIdAt(target);
    const hit = hitId ? resolveHit(get(documentStore).shapes, get(ui).groupPath, hitId) : null;
    if (hit) { if (!get(ui).selectedIds.includes(hit.id)) ui.setSelectionIn([hit.id], hit.groupPath); }
    else editor.deselectAll();
    contextMenu.set({ x: e.clientX, y: e.clientY, at: framePoint(e as MouseEvent) });
  }

  // Touch: holding a finger still opens the menu. Done here rather than through the browser's contextmenu event,
  // which iOS Safari never sends. Only with the Select and Edit tools: elsewhere a press draws.
  const LONG_PRESS_MS = 550;
  let longPress: { timer: ReturnType<typeof setTimeout>; x: number; y: number } | null = null;
  const cancelLongPress = () => { if (longPress) { clearTimeout(longPress.timer); longPress = null; } };
  function armLongPress(e: PointerEvent) {
    cancelLongPress();
    if (e.pointerType !== 'touch' || !['transform', 'edit'].includes(get(ui).tool)) return;
    const target = e.target as Element, x = e.clientX, y = e.clientY;
    longPress = { x, y, timer: setTimeout(() => {
      longPress = null;
      navigator.vibrate?.(10);
      // Lifting the finger still sends a click to whatever is under it by then (it may be a menu item): swallow it.
      const swallow = (ev: Event) => { ev.preventDefault(); ev.stopPropagation(); };
      window.addEventListener('click', swallow, { capture: true, once: true });
      window.addEventListener('pointerup', () => setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 400), { once: true });
      openMenu(target, { clientX: x, clientY: y });
    }, LONG_PRESS_MS) };
  }

  // ── the work area around the page ──────────────────────────────────────────
  // Presses on the area around the page go to the same handlers as presses on the page: the Hand tool (and
  // middle-drag) pan from anywhere, a selection rectangle can start beside the page, shapes can be drawn there.
  let areaEl: HTMLElement | null = null;
  onMount(() => {
    areaEl = svgEl.closest('.svge-scroll-area');
    if (!areaEl) return;
    const outside = (e: Event) => !svgEl.contains(e.target as Node);
    const down = (e: PointerEvent) => { if (outside(e)) onPointerDown(e); };
    const menu = (e: MouseEvent) => { if (outside(e)) onContextMenu(e); };
    const dbl = (e: MouseEvent) => { if (outside(e)) onDblClick(e); };
    areaEl.addEventListener('pointerdown', onTouchDown, { capture: true });
    areaEl.addEventListener('pointerdown', down);
    areaEl.addEventListener('contextmenu', menu);
    areaEl.addEventListener('dblclick', dbl);
    return () => { areaEl?.removeEventListener('pointerdown', onTouchDown, { capture: true }); areaEl?.removeEventListener('pointerdown', down); areaEl?.removeEventListener('contextmenu', menu); areaEl?.removeEventListener('dblclick', dbl); };
  });
  $: if (areaEl) areaEl.style.cursor = cursorStyle;

  // ── keyboard ──────────────────────────────────────────────────────────────
  function onKeyDown(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    // Never hijack keys while the user types in a field (fixes Backspace deleting shapes).
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;

    const tool = tools[get(ui).tool];
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();

    if (e.key === ' ' && t?.tagName !== 'BUTTON') { spaceDown = true; e.preventDefault(); return; }

    if (e.key === 'Escape') {
      if (get(textEdit)) { commitText(); return; }
      if (!tool.escape()) {
        if (!get(ui).selectedIds.length && get(ui).groupPath.length) editor.exitGroup();   // nothing selected: leave the group
        else editor.deselectAll();
      }
      return;
    }

    if (mod) {
      if (tool.busy() || get(textEdit)) return;
      const handled = (() => {
        switch (k) {
          case 'z': e.shiftKey ? editor.redo() : editor.undo(); return true;
          case 'y': editor.redo(); return true;
          // c / x / v are NOT handled here: the browser's own copy / cut / paste events do it (App.svelte → clipboardActions),
          // which is what gives access to the system clipboard. Plain copy stays as a fallback where no event fires.
          case 'c': editor.copy(); return false;
          case 'a': editor.selectAll(); return true;
          case 'd': editor.duplicate(); return true;
          case 'g': e.shiftKey ? editor.ungroup() : editor.group(); return true;
          case ']': editor.bringToFront(); return true;
          case '[': editor.sendToBack(); return true;
          default: return false;
        }
      })();
      if (handled) e.preventDefault();
      return;
    }

    if (tool.key?.(e)) { e.preventDefault(); return; }

    const hasSel = get(ui).selectedIds.length > 0;
    if ((e.key === 'Delete' || e.key === 'Backspace') && hasSel && !get(textEdit)) {
      e.preventDefault(); editor.deleteSelected(); return;
    }
    if (hasSel && !tool.busy() && e.key.startsWith('Arrow')) {
      const step = e.shiftKey ? 10 : 1;
      e.preventDefault();
      editor.nudge(e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0,
                   e.key === 'ArrowUp'   ? -step : e.key === 'ArrowDown'  ? step : 0);
      return;
    }
    if (hasSel && !tool.busy() && (e.key === '[' || e.key === ']')) {
      e.key === ']' ? editor.moveUp() : editor.moveDown();
    }
  }
  function onKeyUp(e: KeyboardEvent) { if (e.key === ' ') spaceDown = false; }

  // ── in-canvas text editing ────────────────────────────────────────────────
  let textContent = '';

  function openText(shape: TextShape, isNew: boolean) {
    textContent = shape.content;
    textEdit.set({ shape, isNew });
    if (!isNew) editor.selectDeep(shape.id);
  }

  /** ONE history entry for the whole session; an empty NEW text leaves no trace at all. */
  function commitText() {
    const st = get(textEdit);
    if (!st) return;
    const content = textContent;
    textEdit.set(null);
    const current = findShape(get(documentStore).shapes, st.shape.id) as TextShape | undefined;
    if (st.isNew) {
      if (content.trim()) editor.addShape({ ...st.shape, content }, 'Add text');
    } else if (current) {
      if (!content.trim()) editor.deleteShapes([current.id]);
      else if (content !== current.content) editor.replaceShape(setTextContent(current, content), 'Edit text');
    }
    // The finished text stays selected, like the shape of every other drawing tool (the selection box shows only with the Select tool).
  }

  $: editShape = $textEdit
    ? ((findShape(doc.shapes, $textEdit!.shape.id) as TextShape | undefined) ?? $textEdit.shape)
    : null;

  // Overlays, previews and the text editor are drawn in the frame of the entered group.
  $: frame = frameTransforms(groupsOf(doc.shapes, $ui.groupPath)).filter(Boolean).join(' ') || undefined;
  // A text that is edited in place sits in the frame of ITS groups (not necessarily the entered ones).
  $: textFrame = editShape
    ? frameTransforms(ancestorsOf(doc.shapes, editShape.id)).filter(Boolean).join(' ') || undefined
    : undefined;

  // ── derived view state ────────────────────────────────────────────────────
  $: bgClass = doc.background === 'custom' ? 'bg-custom'
             : doc.background === 'transparent-light' ? 'bg-transparent-light'
             : doc.background === 'transparent-dark'  ? 'bg-transparent-dark'
             : doc.background === 'black'             ? 'bg-black' : 'bg-white';

  $: cursorStyle = pan ? 'grabbing' : spaceDown || tool === 'pan' ? 'grab' : tool === 'transform' ? 'default' : tool === 'text' ? 'text' : 'crosshair';
</script>

<svelte:window
  on:pointermove={onWindowPointerMove}
  on:pointerup={onWindowPointerUp}
  on:pointercancel={onWindowPointerCancel}
  on:keydown={onKeyDown}
  on:keyup={onKeyUp}
/>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<svg
  bind:this={svgEl}
  class="svge-canvas {bgClass} tool-{tool}"
  role="application"
  aria-label="Drawing canvas"
  width={doc.width * zoom}
  height={doc.height * zoom}
  viewBox="0 0 {doc.width} {doc.height}"
  style="cursor:{cursorStyle};{doc.background === 'custom' ? `background-color:${doc.bgColor ?? '#ffffff'}` : ''}"
  on:pointerdown={onPointerDown}
  on:dblclick={onDblClick}
  on:contextmenu={onContextMenu}
>
  {#if doc.bgImage}
    <image href={doc.bgImage} x="0" y="0" width={doc.width} height={doc.height}
      preserveAspectRatio={doc.bgFit === 'stretch' ? 'none' : doc.bgFit === 'contain' ? 'xMidYMid meet' : 'xMidYMid slice'} pointer-events="none" />
  {/if}

  {#if $ui.gridEnabled}
    <defs>
      <pattern id="svge-grid-pat" width={$ui.gridSizeX} height={$ui.gridSizeY} patternUnits="userSpaceOnUse">
        <path d="M {$ui.gridSizeX} 0 L 0 0 0 {$ui.gridSizeY}" fill="none"
          style="stroke: var(--border-color)" stroke-width={0.5 / zoom} />
      </pattern>
    </defs>
    <rect width={doc.width} height={doc.height} fill="url(#svge-grid-pat)" pointer-events="none" />
  {/if}

  {#each doc.shapes as shape (shape.id)}
    <ShapeRenderer {shape} {zoom} hidden={$textEdit?.shape.id === shape.id} hiddenId={$textEdit?.shape.id ?? null} />
  {/each}

  <g transform={frame}>
  {#if $tempShape}
    <ShapeRenderer shape={$tempShape} {zoom} isTemp />
  {/if}

  {#if tool === 'transform' && selected.length && !$textEdit}
    <SelectionOverlay shapes={selected} {zoom} />
  {/if}
  {#if tool === 'edit' && selected.length === 1}
    <EditOverlay shape={selected[0]} {zoom} active={$activeNode}
      picked={$pickedNodes?.shapeId === selected[0].id ? $pickedNodes.ids : []} />
  {/if}

  <!-- Snap, guide and knife lines get a light casing underneath, so they stay visible on shapes of the same color. -->
  {#each $snapGuides as g}
    {#if g.kind === 'line'}
      <line x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} stroke={CASING} stroke-width={3 / zoom} pointer-events="none" />
      <line x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} stroke={g.color ?? '#ff2d95'} stroke-width={1 / zoom} pointer-events="none" />
    {/if}
  {/each}

  {#each $guides as g}
    {#if g.kind === 'poly'}
      {@const pts = g.points.map(p => `${p.x},${p.y}`).join(' ')}
      <svelte:element this={g.closed ? 'polygon' : 'polyline'} points={pts} fill="none" stroke={CASING} stroke-width={3.5 / zoom}
        stroke-linejoin="round" stroke-linecap="round" pointer-events="none" />
      <svelte:element this={g.closed ? 'polygon' : 'polyline'} points={pts} fill="none" stroke={g.color ?? '#e74c3c'} stroke-width={1.5 / zoom}
        stroke-dasharray={g.dash ? `${6 / zoom},${4 / zoom}` : undefined} stroke-linejoin="round" pointer-events="none" />
    {:else if g.kind === 'line'}
      <line x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2}
        stroke={g.color ?? '#e74c3c'} stroke-width={1.5 / zoom}
        stroke-dasharray={g.dash ? `${5 / zoom},${3 / zoom}` : undefined} pointer-events="none" />
    {:else if g.kind === 'dot'}
      <circle cx={g.x} cy={g.y} r={(g.r ?? 3.5) / zoom}
        fill={g.fill ?? g.color ?? '#e74c3c'} stroke="white" stroke-width={1 / zoom} pointer-events="none" />
    {:else if g.kind === 'ring'}
      <circle cx={g.x} cy={g.y} r={(g.r ?? 8) / zoom}
        fill="none" stroke={g.color ?? '#27ae60'} stroke-width={2 / zoom} pointer-events="none" />
    {:else if g.kind === 'rect'}
      <rect x={g.x} y={g.y} width={g.width} height={g.height}
        fill={g.color ?? '#4A90D9'} fill-opacity="0.08"
        stroke={g.color ?? '#4A90D9'} stroke-width={1 / zoom} stroke-dasharray="{4 / zoom},{3 / zoom}"
        pointer-events="none" />
    {/if}
  {/each}
  </g>

  <!-- Ruler guides (editor only). With the Select tool they can be grabbed: drag to move, drop on a ruler to delete. -->
  {#if $ui.guidesVisible}
    {#each doc.guides ?? [] as g, i (i)}
      {#if $guidePreview?.index !== i}
        <line x1={g.axis === 'x' ? g.pos : -GUIDE_REACH} x2={g.axis === 'x' ? g.pos : doc.width + GUIDE_REACH}
          y1={g.axis === 'y' ? g.pos : -GUIDE_REACH} y2={g.axis === 'y' ? g.pos : doc.height + GUIDE_REACH}
          stroke={CASING} stroke-width={3 / zoom} pointer-events="none" />
        <line x1={g.axis === 'x' ? g.pos : -GUIDE_REACH} x2={g.axis === 'x' ? g.pos : doc.width + GUIDE_REACH}
          y1={g.axis === 'y' ? g.pos : -GUIDE_REACH} y2={g.axis === 'y' ? g.pos : doc.height + GUIDE_REACH}
          stroke={GUIDE_COLOR} stroke-width={1 / zoom} pointer-events="none" />
        <line data-guide={i} x1={g.axis === 'x' ? g.pos : -GUIDE_REACH} x2={g.axis === 'x' ? g.pos : doc.width + GUIDE_REACH}
          y1={g.axis === 'y' ? g.pos : -GUIDE_REACH} y2={g.axis === 'y' ? g.pos : doc.height + GUIDE_REACH}
          stroke="rgba(0,0,0,0)" stroke-width={9 / zoom} pointer-events={tool === 'transform' ? 'stroke' : 'none'}
          style="cursor:{g.axis === 'x' ? 'col-resize' : 'row-resize'}" />
      {/if}
    {/each}
  {/if}
  {#if $guidePreview}
    {@const g = $guidePreview}
    <line x1={g.axis === 'x' ? g.pos : -GUIDE_REACH} x2={g.axis === 'x' ? g.pos : doc.width + GUIDE_REACH}
      y1={g.axis === 'y' ? g.pos : -GUIDE_REACH} y2={g.axis === 'y' ? g.pos : doc.height + GUIDE_REACH}
      stroke={GUIDE_COLOR} stroke-width={1 / zoom} stroke-dasharray="{5 / zoom},{3 / zoom}" pointer-events="none" />
  {/if}

  {#if editShape}
    <g transform={textFrame}>
      <TextEditor
        shape={editShape}
        content={textContent}
        onInput={v => (textContent = v)}
        onCommit={commitText}
      />
    </g>
  {/if}
</svg>

<style>
  .svge-canvas {
    display: block;
    flex-shrink: 0;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.18);
    /* Shapes (and their selection boxes) dragged past the page edge stay visible over the work area.
       Exports are still cut at the page: nothing here changes what is saved. */
    overflow: visible;
    outline: none;
    user-select: none;
    touch-action: none;
  }
  .tool-transform :global([data-shape-id]) { cursor: move; }
</style>
