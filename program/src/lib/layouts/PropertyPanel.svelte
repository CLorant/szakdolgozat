<script lang="ts">
  /**
   * @file The property panel (Fill, Stroke, Geometry, Typography, Objects, History, Canvas).
   * Every edit goes through editor.* and applies to all selected shapes. Continuous inputs (color drags, sliders,
   * number fields) are coalesced by the store, so one drag is one undo step.
   */
  import { ui, PANEL_MIN_WIDTH, PANEL_MAX_WIDTH, PANEL_MIN_HEIGHT, PANEL_HEIGHT_RESERVE } from '../stores/ui';
  import { narrow } from '../stores/media';
  import { editor, selectedShapes, MAX_CANVAS } from '../stores/editor';
  import { documentStore, shapesStore, canUndo, canRedo, historyPast, historyFuture, historyNow } from '../stores/document';
  import {
    getLocalBounds, getWorldBounds, unionBounds, translateShape, setShapeSize, setRectRadii, resizeMany, withOrigin, rotateToAbout,
  } from '../utils/shapes';
  import { normDeg } from '../utils/math';
  import { leaves, countShapes } from '../utils/tree';
  import { DASH_KINDS, DASH_LABEL, dashFor, inferDash, parseDashInput, formatDash } from '../utils/dash';
  import { readDataUrl } from '../utils/files';
  import { contentBounds } from '../utils/exportArea';
  import { notifyError } from '../stores/notify';
  import Layers from '../components/Layers.svelte';
  import ColorPicker from '../components/ColorPicker.svelte';
  import GradientEditor from '../components/GradientEditor.svelte';
  import { parseGradient, gradientFrom, formatGradient, solidOf, gradientCss } from '../utils/gradient';
  import SliderInput from '../components/SliderInput.svelte';
  import FontPicker from '../components/FontPicker.svelte';
  import WeightControl from '../components/WeightControl.svelte';
  import { fontStylesMap, stylesNow } from '../fonts/styles';
  import { decorationLines, toggleDecoration, MIN_FONT_SIZE, MAX_FONT_SIZE, type DecorationLine } from '../utils/text';
  import type { BackgroundType, BgFit, TextProps, TextShape, LineCap, LineJoin } from '../utils/types';

  $: property = $ui.property;
  $: doc = $documentStore;
  $: sel = $selectedShapes;
  const TITLES: Record<string, string> = { fill: 'Fill', stroke: 'Stroke', geometry: 'Geometry', 'text-props': 'Typography', layers: 'Objects', history: 'History', canvas: 'Canvas' };
  $: title = TITLES[property] ?? '';
  $: objectCount = countShapes($shapesStore);
  $: primary = sel[0] ?? null;                         // what the controls DISPLAY
  $: single = sel.length === 1 ? sel[0] : null;        // geometry needs exactly one

  // ── paint ────────────────────────────────────────────────────────────────
  // A group has no paint of its own: the controls show its first shape and change them all.
  $: paintSrc    = primary ? leaves([primary])[0] ?? null : null;
  $: fill        = paintSrc?.fill ?? (!sel.length && $ui.tool === 'text' ? $ui.textFill : $ui.fill);
  $: stroke      = paintSrc?.stroke ?? $ui.stroke;
  $: strokeWidth = paintSrc?.strokeWidth ?? $ui.strokeWidth;
  $: opacity     = primary?.opacity ?? 1;
  $: linecap     = paintSrc?.strokeLinecap ?? $ui.strokeLinecap;
  $: linejoin    = paintSrc?.strokeLinejoin ?? $ui.strokeLinejoin;
  // The dash preset the controls show: inferred from the shape's real pattern (a group shows its first leaf's).
  $: dashLeaf    = paintSrc;
  $: dashNow     = dashLeaf ? inferDash(dashLeaf.strokeDasharray, dashLeaf.strokeWidth, dashLeaf.strokeLinecap) : $ui.dashKind;

  type PaintType = 'none' | 'solid' | 'linear' | 'radial';
  const paintType = (p: string): PaintType => p === 'none' || p === 'transparent' ? 'none' : parseGradient(p)?.type ?? 'solid';
  $: fillType   = paintType(fill);
  $: strokeType = paintType(stroke);
  // What "Solid" returns to: the last plain color (a gradient's first stop counts)
  let lastFill = '#aaaaaa', lastStroke = '#000000';
  $: if (fill !== 'none') lastFill = solidOf(fill);
  $: if (stroke !== 'none') lastStroke = solidOf(stroke);

  // Fill rule: only paths use it (overlapping or nested contours, e.g. after a boolean operation or an import).
  $: pathLeaf = sel.length ? leaves(sel).find(s => s.type === 'path') as import('../utils/types').PathShape | undefined : undefined;
  const STAR = 'M10 1.5 15.3 18.2 1.2 7.4H18.8L4.7 18.2Z';
  const FILL_RULES: Array<['nonzero' | 'evenodd', string, boolean]> = [
    ['nonzero', 'Non-zero: overlapping parts are filled', false],
    ['evenodd', 'Even-odd: overlapping parts become holes', true],
  ];

  /** The value for switching a paint to `type` (keeps the gradient's stops, or starts from the plain color). */
  function paintFor(type: PaintType, current: string, last: string): string {
    if (type === 'none') return 'none';
    if (type === 'solid') return solidOf(current === 'none' ? last : current);
    return formatGradient(gradientFrom(current === 'none' ? last : current, type));
  }
  /** The face of a type button: what the paint would look like if you chose it (the current one shows itself). */
  function typePreview(type: PaintType, current: string, last: string): string {
    if (type === 'none') return 'transparent';
    const g = parseGradient(paintFor(type, current, last));
    return g ? gradientCss(g, false) : solidOf(paintFor(type, current, last));
  }

  // preview strokes use the real generator (2 px wide, current cap) so the icons match what is drawn
  $: dashIcons = DASH_KINDS.map(k => ({ kind: k, label: DASH_LABEL[k], value: dashFor(k, 2, linecap) }));

  // ── geometry ─────────────────────────────────────────────────────────────
  // One shape: its own, unrotated box (rotation is a separate field). Several: the box around all of them on the
  // canvas; moving and resizing it moves and scales every shape (like the Select tool's handles).
  $: geo = sel.filter(s => s.visible);
  $: many = geo.length > 1;
  $: gb = single ? getLocalBounds(single) : many ? unionBounds(geo.map(getWorldBounds)) ?? ZERO : ZERO;
  const ZERO = { x: 0, y: 0, width: 0, height: 0 };
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const numOf = (e: Event) => parseFloat((e.target as HTMLInputElement).value);
  const geomKey = () => `geom:${geo.map(s => s.id).join(',')}`;

  function moveBy(dx: number, dy: number) {
    if (single) editor.replaceShape(translateShape(single, dx, dy), 'Move', geomKey());
    else if (many) editor.replaceShapes(geo.map(s => translateShape(s, dx, dy)), `Move ${geo.length} shapes`, geomKey());
  }
  const setX = (v: number) => { if (!Number.isNaN(v)) moveBy(v - gb.x, 0); };
  const setY = (v: number) => { if (!Number.isNaN(v)) moveBy(0, v - gb.y); };

  /** W or H; with the chain on, the other side follows (proportions kept). The top-left corner stays put. */
  function setSizeTo(axis: 'w' | 'h', v: number) {
    if (Number.isNaN(v) || v < 1 || gb.width <= 0 && axis === 'w' || gb.height <= 0 && axis === 'h') return;
    const k = axis === 'w' ? v / gb.width : v / gb.height;
    const w = axis === 'w' ? v : $ui.keepAspect ? gb.width * k : gb.width;
    const h = axis === 'h' ? v : $ui.keepAspect ? gb.height * k : gb.height;
    if (single) editor.replaceShape(setShapeSize(single, Math.max(1, w), Math.max(1, h)), 'Resize', geomKey());
    else if (many) editor.replaceShapes(resizeMany(geo, 'se', { x: gb.x + Math.max(1, w), y: gb.y + Math.max(1, h) }), `Resize ${geo.length} shapes`, geomKey());
  }

  // Rotation origin (percent of the box): where the shape turns. Changing it moves nothing.
  $: org = single?.origin ?? { x: 0.5, y: 0.5 };
  function setOrigin(axis: 'x' | 'y', pct: number) {
    if (!single || Number.isNaN(pct)) return;
    editor.replaceShape(withOrigin(single, { ...org, [axis]: pct / 100 }), 'Rotation origin', `origin:${single.id}`);
  }
  /** Chain link icon: closed = the two values are linked. */
  const chain = (closed: boolean) => `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">${closed
    ? '<path d="M6.5 9.5l3-3"/><path d="M7 4.5l1.2-1.2a2.6 2.6 0 0 1 3.7 3.7L10.7 8.2"/><path d="M9 11.5l-1.2 1.2a2.6 2.6 0 0 1-3.7-3.7L5.3 7.8"/>'
    : '<path d="M7 4.5l1.2-1.2a2.6 2.6 0 0 1 3.7 3.7L10.7 8.2"/><path d="M9 11.5l-1.2 1.2a2.6 2.6 0 0 1-3.7-3.7L5.3 7.8"/><path d="M5 2.5v1.5M2.5 5H4M11 13.5V12M13.5 11H12"/>'}</svg>`;
  const ORIGIN_PRESETS: Array<[number, number, string]> = [
    [0, 0, 'Top left'], [0.5, 0, 'Top'], [1, 0, 'Top right'],
    [0, 0.5, 'Left'], [0.5, 0.5, 'Centre'], [1, 0.5, 'Right'],
    [0, 1, 'Bottom left'], [0.5, 1, 'Bottom'], [1, 1, 'Bottom right'],
  ];

  const setRot = (deg: number) => single && editor.replaceShape(rotateToAbout(single, deg), 'Rotate', `rot:${single.id}`);

  // Corner radii (rectangles): "Equal" keeps rx and ry together; it starts on when they already match.
  let radiusFor = '', linkRadii = true;
  $: if (single && single.id !== radiusFor) { radiusFor = single.id; linkRadii = single.type !== 'rectangle' || single.rx === single.ry; }
  function setRadius(axis: 'rx' | 'ry', v: number) {
    if (!single || single.type !== 'rectangle' || Number.isNaN(v)) return;
    editor.replaceShape(setRectRadii(single, linkRadii ? { rx: Math.max(0, v), ry: Math.max(0, v) } : { [axis]: Math.max(0, v) }), 'Corner radius', `rad:${single.id}`);
  }

  // Custom dash pattern (px, absolute) and offset. While typing, the field shows the draft, not the normalised value.
  let dashDraft: string | null = null, dashBad = false;
  $: dashText = dashLeaf?.strokeDasharray ?? '';
  $: dashOffset = dashLeaf?.strokeDashoffset ?? 0;
  function onDashInput(e: Event) {
    dashDraft = (e.target as HTMLInputElement).value;
    const v = parseDashInput(dashDraft);
    dashBad = v === null;
    if (v) editor.setDash({ dasharray: formatDash(v) });
  }

  // ── text ─────────────────────────────────────────────────────────────────
  $: tp = ((single?.type === 'text' ? single : null) as TextShape | null) ?? $ui.textProps as TextProps;
  const setTp = <K extends keyof TextProps>(k: K, v: TextProps[K]) => editor.setTextProp(k, v);
  // What the chosen family really offers (weights, italic); re-read when a lookup finishes.
  const stylesWith = (_known: unknown, family: string) => stylesNow(family);
  $: fontStylesOf = stylesWith($fontStylesMap, tp.fontFamily);
  const DECORATIONS: Array<[DecorationLine, string, string]> = [['underline', 'Underline', 'deco-under'], ['line-through', 'Strikethrough', 'deco-through'], ['overline', 'Overline', 'deco-over']];

  // ── canvas ───────────────────────────────────────────────────────────────
  let bgInput: HTMLInputElement;
  async function onBgImage(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      if (!file.type.startsWith('image/')) throw new Error('Please choose an image file.');
      editor.setBgImage(await readDataUrl(file));
    } catch (err) { notifyError(err); }
  }
  const setSize = (w: number, h: number) => {
    if (Number.isNaN(w) || Number.isNaN(h)) return;
    editor.setCanvasSize(Math.min(MAX_CANVAS, Math.max(16, Math.round(w))), Math.min(MAX_CANVAS, Math.max(16, Math.round(h))));
  };
  /** While typing: apply only values that are already valid (so "8" on the way to "800" is not clamped to 16). */
  const setSizeLive = (w: number, h: number) => {
    if (w >= 16 && w <= 8000 && h >= 16 && h <= 8000) setSize(w, h);
  };
  const PAINT_TYPES: Array<[PaintType, string]> = [['solid', 'Solid'], ['linear', 'Linear'], ['radial', 'Radial'], ['none', 'None']];
  const SIZES: Array<[string, string, number, number]> = [['A4', 'A4 landscape', 1122, 794], ['HD', 'HD', 1280, 720], ['4K', '4K', 3840, 2160], ['Square', 'Square', 800, 800]];
  const BGS: Array<[BackgroundType, string, string]> = [
    ['white', 'White', 'bg-white'], ['black', 'Black', 'bg-black'],
    ['transparent-light', 'Light transparent', 'bg-transparent-light'], ['transparent-dark', 'Dark transparent', 'bg-transparent-dark'],
  ];
  const FITS: Array<[BgFit, string]> = [['cover', 'Fill'], ['contain', 'Fit inside'], ['stretch', 'Stretch']];

  /** Canvas = the background image's own size (scaled down, aspect kept, when larger than the canvas limit). */
  async function canvasToImage() {
    try {
      const img = new Image();
      await new Promise<void>((ok, fail) => { img.onload = () => ok(); img.onerror = () => fail(new Error('The image could not be read.')); img.src = doc.bgImage; });
      const k = Math.min(1, MAX_CANVAS / Math.max(img.naturalWidth, img.naturalHeight));
      setSize(img.naturalWidth * k, img.naturalHeight * k);
      editor.setBgFit('stretch');                   // same aspect → nothing is cropped or letterboxed
    } catch (err) { notifyError(err); }
  }

  // ── resizing (drag the left edge; on narrow screens the top edge) ────────
  // The panel takes its real size in the layout, so the drawing area always ends at the panel's edge.
  let resizing = false;
  /** Narrow screens: the tallest the sheet may get (the drawing area keeps PANEL_HEIGHT_RESERVE px). */
  const maxHeight = () => {
    const ws = slotEl?.parentElement?.closest('.svge-workspace') as HTMLElement | null;
    return (ws?.clientHeight ?? window.innerHeight) - PANEL_HEIGHT_RESERVE;
  };
  let slotEl: HTMLElement;
  function startResize(e: PointerEvent) {
    e.preventDefault();
    const startX = e.clientX, startW = $ui.panelWidth;
    const startY = e.clientY, startH = $ui.panelHeight, vertical = $narrow, maxH = maxHeight();
    // Capture: every pointer event of the drag goes to the grip, never to the controls the pointer passes over
    // (the color picker reacts to a moving pointer with a button down).
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* not supported: pointer-events:none below still protects */ }
    resizing = true;
    const move = (ev: PointerEvent) => vertical
      ? ui.setPanelHeight(startH + (startY - ev.clientY), maxH)
      : ui.setPanelWidth(Math.min(startW + (startX - ev.clientX), window.innerWidth * 0.6));
    const up = () => { resizing = false; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }
  function resizeKey(e: KeyboardEvent) {
    if ($narrow) {
      if (e.key === 'ArrowUp') { e.preventDefault(); ui.setPanelHeight($ui.panelHeight + 16, maxHeight()); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); ui.setPanelHeight($ui.panelHeight - 16, maxHeight()); }
      return;
    }
    if (e.key === 'ArrowLeft') { e.preventDefault(); ui.setPanelWidth($ui.panelWidth + 16); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); ui.setPanelWidth($ui.panelWidth - 16); }
  }

  // ── history ──────────────────────────────────────────────────────────────
  // Timeline index: past entries 0..n-1, current n, future n+1…  (every label names the state it points at)
  $: past = $historyPast;
  $: future = $historyFuture;
</script>

<div class="svge-panel-slot" bind:this={slotEl} class:open={$ui.panelOpen} class:resizing
  style="--panel-w:{$ui.panelWidth}px; --panel-h:{Math.min($ui.panelHeight, $narrow ? maxHeight() : Infinity)}px">
<div class="svge-panel" class:open={$ui.panelOpen} aria-hidden={!$ui.panelOpen}>
  <!-- Fixed to the panel's left edge (narrow screens: its top edge): it travels with the panel when it is resized -->
  <button
    class="svge-panel-collapse"
    on:click={() => ui.setPanelOpen(!$ui.panelOpen)}
    title={$ui.panelOpen ? 'Collapse panel' : 'Expand panel'}
    aria-label={$ui.panelOpen ? 'Collapse panel' : 'Expand panel'}
  ><span class="svge-collapse-arrow">{$narrow ? ($ui.panelOpen ? '▾' : '▴') : $ui.panelOpen ? '›' : '‹'}</span></button>
  {#if $ui.panelOpen}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div class="svge-panel-grip" role="separator" aria-orientation={$narrow ? 'horizontal' : 'vertical'} aria-label="Resize panel" tabindex="0"
      aria-valuemin={$narrow ? PANEL_MIN_HEIGHT : PANEL_MIN_WIDTH} aria-valuemax={$narrow ? maxHeight() : PANEL_MAX_WIDTH}
      aria-valuenow={$narrow ? $ui.panelHeight : $ui.panelWidth}
      on:pointerdown={startResize} on:keydown={resizeKey}
      on:dblclick={() => $narrow ? ui.setPanelHeight(PANEL_MIN_HEIGHT, maxHeight()) : ui.setPanelWidth(PANEL_MIN_WIDTH)}></div>
    <div class="svge-panel-inner">
      <div class="panel-title">
        <span>{title}</span>{#if property === 'layers'}<span class="panel-count">{objectCount}</span>{/if}
      </div>

      {#if property === 'fill'}
        <div class="svge-section">
          <div class="svge-section-head">Type</div>
          <div class="type-row">
            {#each PAINT_TYPES as [t, label]}
              <button class="type-btn" class:active={fillType === t} title={label} aria-label={label} aria-pressed={fillType === t}
                on:click={() => editor.setStyle({ fill: paintFor(t, fill, lastFill) }, t === 'none' ? 'Remove fill' : 'Set fill')}>
                {#if t === 'none'}
                  <svg class="none-icon" viewBox="0 0 10 10" aria-hidden="true"><line x1="0" y1="10" x2="10" y2="0" stroke="currentColor" stroke-width="1" vector-effect="non-scaling-stroke" /></svg>
                {:else}
                  <span class="type-face" style="background:{typePreview(t, fill, lastFill)}"></span>
                {/if}
              </button>
            {/each}
          </div>
        </div>
        {#if fillType === 'solid'}
          <div class="svge-section">
            <div class="svge-section-head">Color</div>
            <ColorPicker value={fill} showAlpha={true} on:change={e => editor.setStyle({ fill: e.detail }, 'Change fill')} />
          </div>
        {:else if fillType === 'linear' || fillType === 'radial'}
          <div class="svge-section">
            <div class="svge-section-head">Gradient</div>
            <GradientEditor value={fill} on:change={e => editor.setStyle({ fill: e.detail }, 'Change fill gradient')} />
          </div>
        {/if}
        {#if fillType !== 'none' && pathLeaf}
          <div class="svge-section">
            <div class="svge-section-head">Rule</div>
            <div class="btn-row">
              {#each FILL_RULES as [rule, label, holes]}
                <button class="prop-btn rule-btn" class:active={(pathLeaf.fillRule ?? 'nonzero') === rule} aria-pressed={(pathLeaf.fillRule ?? 'nonzero') === rule}
                  title={label} aria-label={label} on:click={() => editor.setFillRule(rule)}>
                  <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
                    <path d={STAR} fill="currentColor" fill-opacity="0.75" fill-rule={holes ? 'evenodd' : 'nonzero'} stroke="currentColor" stroke-width="0.8" stroke-linejoin="round" />
                  </svg>
                </button>
              {/each}
            </div>
          </div>
        {/if}
        <div class="svge-section">
          <div class="svge-section-head">Object opacity</div>
          <SliderInput value={Math.round(opacity * 100)} min={0} max={100} step={1} unit="%"
            disabled={!sel.length} onChange={v => editor.setStyle({ opacity: v / 100 }, 'Change opacity')} />
        </div>

      {:else if property === 'stroke'}
        <div class="svge-section">
          <div class="svge-section-head">Type</div>
          <div class="type-row">
            {#each PAINT_TYPES as [t, label]}
              <button class="type-btn" class:active={strokeType === t} title={label} aria-label={label} aria-pressed={strokeType === t}
                on:click={() => editor.setStyle({ stroke: paintFor(t, stroke, lastStroke) }, t === 'none' ? 'Remove stroke' : 'Set stroke')}>
                {#if t === 'none'}
                  <svg class="none-icon" viewBox="0 0 10 10" aria-hidden="true"><line x1="0" y1="10" x2="10" y2="0" stroke="currentColor" stroke-width="1" vector-effect="non-scaling-stroke" /></svg>
                {:else}
                  <span class="type-face" style="background:{typePreview(t, stroke, lastStroke)}"></span>
                {/if}
              </button>
            {/each}
          </div>
        </div>
        {#if strokeType !== 'none'}
          <div class="svge-section">
            {#if strokeType === 'solid'}
              <div class="svge-section-head">Color</div>
              <ColorPicker value={stroke} showAlpha={true} on:change={e => editor.setStyle({ stroke: e.detail }, 'Change stroke')} />
            {:else}
              <div class="svge-section-head">Gradient</div>
              <GradientEditor value={stroke} on:change={e => editor.setStyle({ stroke: e.detail }, 'Change stroke gradient')} />
            {/if}
          </div>
          <div class="svge-section">
            <div class="svge-section-head">Width</div>
            <SliderInput value={strokeWidth} min={0} max={40} step={0.5} unit="px"
              onChange={v => editor.setStyle({ strokeWidth: v }, 'Change stroke width')} />
          </div>
          <div class="svge-section">
            <button class="svge-action-btn full-w" disabled={!editor.canStrokeToPath(sel)} on:click={() => editor.strokeToPath()}
              title="Turn the stroke into a filled shape you can edit node by node">Stroke to path</button>
          </div>
          <div class="svge-section">
            <div class="svge-section-head">Dash pattern</div>
            <div class="dash-row">
              {#each dashIcons as p}
                <button class="dash-btn" class:active={dashNow === p.kind} title={p.label} aria-label={p.label}
                  on:click={() => editor.setDashKind(p.kind)}>
                  <svg width="40" height="10" viewBox="0 0 40 10" aria-hidden="true">
                    <line x1="2" y1="5" x2="38" y2="5" stroke="currentColor" stroke-width="2" stroke-linecap={linecap} stroke-dasharray={p.value || undefined} />
                  </svg>
                </button>
              {/each}
            </div>
            <div class="dash-fields">
              <label class="dash-pattern">
                <span class="geom-lbl">Pattern</span>
                <input type="text" class="svge-num-input" class:bad={dashBad} disabled={!sel.length} inputmode="decimal"
                  placeholder="dash gap …  (px)" aria-label="Dash pattern in pixels" spellcheck="false"
                  title="Dash and gap lengths in px, e.g. 12 4 2 4. A typed pattern keeps its lengths when the width changes; the presets above grow with the width."
                  value={dashDraft ?? dashText} on:input={onDashInput} on:blur={() => { dashDraft = null; dashBad = false; }} />
              </label>
              <label class="dash-pattern">
                <span class="geom-lbl">Offset</span>
                <input type="number" class="svge-num-input" step="1" disabled={!sel.length || !dashText} value={dashOffset}
                  on:input={e => { const v = numOf(e); if (!Number.isNaN(v)) editor.setDash({ offset: v }); }} />
              </label>
            </div>
          </div>
          <div class="svge-section">
            <div class="svge-section-head">Line cap</div>
            <div class="btn-row">
              {#each [['butt', 'Flat'], ['round', 'Round'], ['square', 'Square']] as [val, lbl]}
                <button class="prop-btn" class:active={linecap === val}
                  on:click={() => editor.setStyle({ strokeLinecap: val as LineCap }, 'Change line cap')}>{lbl}</button>
              {/each}
            </div>
          </div>
          <div class="svge-section">
            <div class="svge-section-head">Line join</div>
            <div class="btn-row">
              {#each [['miter', 'Miter'], ['round', 'Round'], ['bevel', 'Bevel']] as [val, lbl]}
                <button class="prop-btn" class:active={linejoin === val}
                  on:click={() => editor.setStyle({ strokeLinejoin: val as LineJoin }, 'Change line join')}>{lbl}</button>
              {/each}
            </div>
          </div>
        {/if}

      {:else if property === 'geometry'}
        {#if single || many}
          <div class="svge-section">
            <div class="svge-section-head">Position{#if many}<span class="head-note">{geo.length} shapes</span>{/if}</div>
            <div class="svge-pair">
              <label class="svge-pair-field"><span>X</span><input type="number" class="svge-num-input" value={r1(gb.x)} step="1" on:input={e => setX(numOf(e))} /></label>
              <label class="svge-pair-field"><span>Y</span><input type="number" class="svge-num-input" value={r1(gb.y)} step="1" on:input={e => setY(numOf(e))} /></label>
            </div>
          </div>
          <div class="svge-section">
            <div class="svge-section-head">Size
              <button class="link-btn" class:on={$ui.keepAspect} aria-pressed={$ui.keepAspect}
                title={$ui.keepAspect ? 'Proportions kept: W and H change together' : 'Keep proportions'}
                aria-label="Keep proportions" on:click={() => ui.set({ keepAspect: !$ui.keepAspect })}>{@html chain($ui.keepAspect)}</button>
            </div>
            <div class="svge-pair">
              <label class="svge-pair-field"><span>W</span><input type="number" class="svge-num-input" value={r1(gb.width)} min="1" step="1" on:input={e => setSizeTo('w', numOf(e))} /></label>
              <label class="svge-pair-field"><span>H</span><input type="number" class="svge-num-input" value={r1(gb.height)} min="1" step="1" on:input={e => setSizeTo('h', numOf(e))} /></label>
            </div>
          </div>
          {#if single}
            <div class="svge-section">
              <div class="svge-section-head" title="The point the shape turns about when it is rotated (the crosshair of the Select tool). Moving it moves nothing.">Origin<span class="head-note">% of box</span></div>
              <div class="origin-row">
                <div class="svge-pair">
                  <label class="svge-pair-field"><span>X</span><input type="number" class="svge-num-input" value={Math.round(org.x * 100)} step="5" on:input={e => setOrigin('x', numOf(e))} /></label>
                  <label class="svge-pair-field"><span>Y</span><input type="number" class="svge-num-input" value={Math.round(org.y * 100)} step="5" on:input={e => setOrigin('y', numOf(e))} /></label>
                </div>
                <div class="origin-grid" role="group" aria-label="Origin presets">
                  {#each ORIGIN_PRESETS as [ox, oy, name]}
                    <button class="origin-dot" class:on={Math.abs(org.x - ox) < 1e-6 && Math.abs(org.y - oy) < 1e-6} title={name} aria-label={name}
                      on:click={() => editor.replaceShape(withOrigin(single, { x: ox, y: oy }), 'Rotation origin')}></button>
                  {/each}
                </div>
              </div>
            </div>
            <div class="svge-section">
              <div class="svge-section-head">Rotation</div>
              <SliderInput value={Math.round(single.rotation)} min={0} max={360} step={1} unit="°" numWidth={48} onChange={setRot} />
            </div>
            {#if single.type === 'rectangle'}
              <div class="svge-section">
                <div class="svge-section-head">Corner radius
                  <button class="link-btn" class:on={linkRadii} aria-pressed={linkRadii} title={linkRadii ? 'Both radii stay equal' : 'Keep both radii equal'}
                    aria-label="Keep both radii equal" on:click={() => (linkRadii = !linkRadii)}>{@html chain(linkRadii)}</button>
                </div>
                <div class="svge-pair">
                  <label class="svge-pair-field"><span style="margin-right: 4px;">Rx</span><input type="number" class="svge-num-input" value={r1(single.rx)} min="0" step="1" on:input={e => setRadius('rx', numOf(e))} /></label>
                  <label class="svge-pair-field"><span style="margin-right: 4px;">Ry</span><input type="number" class="svge-num-input" value={r1(single.ry)} min="0" step="1" on:input={e => setRadius('ry', numOf(e))} /></label>
                </div>
              </div>
            {/if}
          {/if}
        {:else}
          <p class="svge-empty">Select a shape to view its geometry.</p>
        {/if}

      {:else if property === 'text-props'}
        <div class="svge-section">
          <div class="svge-section-head">Font family</div>
          <FontPicker value={tp.fontFamily} onChange={f => setTp('fontFamily', f)} />
        </div>
        <div class="svge-section">
          <div class="svge-section-head">Size</div>
          <SliderInput value={tp.fontSize} min={MIN_FONT_SIZE} max={MAX_FONT_SIZE} sliderMin={6} sliderMax={200} step={1} unit="px"
            onChange={v => setTp('fontSize', v)} />
        </div>
        <div class="svge-section">
          <div class="svge-section-head">Weight</div>
          <WeightControl styles={fontStylesOf} value={tp.fontWeight} onChange={w => setTp('fontWeight', w)} />
        </div>
        <div class="svge-section">
          <div class="svge-section-head">Style</div>
          <button class="svge-style-btn" class:active={tp.fontStyle === 'italic'} aria-pressed={tp.fontStyle === 'italic'}
            title={fontStylesOf.italic ? 'Italic' : 'This font has no italic face: the letters are slanted instead'}
            on:click={() => setTp('fontStyle', tp.fontStyle === 'italic' ? 'normal' : 'italic')}><em>Italic</em>{fontStylesOf.italic ? '' : ' (Synthesized)'}</button>
        </div>
        <div class="svge-section">
          <div class="svge-section-head">Line</div>
          <div class="btn-row">
            {#each DECORATIONS as [line, label, cls]}
              <button class="prop-btn {cls}" class:active={decorationLines(tp.textDecoration).includes(line)} aria-pressed={decorationLines(tp.textDecoration).includes(line)}
                title={label} aria-label={label} on:click={() => setTp('textDecoration', toggleDecoration(tp.textDecoration, line))}>Aa</button>
            {/each}
          </div>
        </div>
        <div class="svge-section">
          <div class="svge-section-head">Anchor</div>
          <div class="btn-row">
            {#each [['start', 'Start'], ['middle', 'Middle'], ['end', 'End']] as [val, label]}
              <button class="prop-btn" class:active={tp.textAnchor === val} title="The text {val === 'start' ? 'starts' : val === 'end' ? 'ends' : 'is centred'} at its anchor point"
                on:click={() => setTp('textAnchor', val as TextProps['textAnchor'])}>{label}</button>
            {/each}
          </div>
        </div>
        <div class="svge-section">
          <div class="svge-section-head">Spacing</div>
          <div class="geom-grid sliders spacing">
            <span class="geom-lbl" title="Letter spacing">Letter</span>
            <SliderInput value={tp.letterSpacing ?? 0} min={-5} max={40} step={0.5} unit="px" onChange={v => setTp('letterSpacing', v)} />
            <span class="geom-lbl" title="Word spacing">Word</span>
            <SliderInput value={tp.wordSpacing ?? 0} min={-10} max={100} step={1} unit="px" onChange={v => setTp('wordSpacing', v)} />
            <span class="geom-lbl" title="Line height (× font size)">Line</span>
            <SliderInput value={tp.lineHeight ?? 1.25} min={0.5} max={3} step={0.05} unit="×" numWidth={60} onChange={v => setTp('lineHeight', v)} />
          </div>
        </div>

      {:else if property === 'layers'}
        <Layers />

      {:else if property === 'history'}
        <!-- Buttons stay put above the list (the newest entry is right below them); only the list scrolls -->
        <div class="history-actions">
          <button class="svge-action-btn" disabled={!$canUndo} on:click={editor.undo}>↺ Undo</button>
          <button class="svge-action-btn" disabled={!$canRedo} on:click={editor.redo}>↻ Redo</button>
        </div>
        <div class="history-list">
          {#each [...future].reverse() as entry, i}
            <button class="history-item future" title="Redo to this state" on:click={() => documentStore.goTo(past.length + future.length - i)}>
              <span class="history-arrow">↻</span><span class="history-label">{entry.label}</span>
            </button>
          {/each}
          <div class="history-present"><span class="history-dot">●</span><span class="history-label">{$historyNow}</span></div>
          {#each [...past].reverse() as entry, i}
            <button class="history-item" title="Go back to this state" on:click={() => documentStore.goTo(past.length - 1 - i)}>
              <span class="history-arrow">↺</span><span class="history-label">{entry.label}</span>
            </button>
          {/each}
        </div>

      {:else if property === 'canvas'}
        <div class="svge-section">
          <div class="svge-section-head">Size</div>
          <div class="svge-pair">
            <label class="svge-pair-field"><span>W</span><input type="number" class="svge-num-input" value={doc.width} min="16" max="8000" step="1" on:input={e => setSizeLive(numOf(e), doc.height)} on:change={e => setSize(numOf(e), doc.height)} /></label>
            <label class="svge-pair-field"><span>H</span><input type="number" class="svge-num-input" value={doc.height} min="16" max="8000" step="1" on:input={e => setSizeLive(doc.width, numOf(e))} on:change={e => setSize(doc.width, numOf(e))} /></label>
          </div>
          <div class="size-presets">
            {#each SIZES as [lbl, name, w, h]}<button class="preset-btn" title="{name} · {w} × {h} px" on:click={() => setSize(w, h)}>{lbl}</button>{/each}
          </div>
          <button class="svge-action-btn full-w fit-btn" disabled={!contentBounds(doc.shapes)} on:click={() => editor.fitCanvasToContent()}
            title="Resize the canvas to the visible objects (+20 px margin) and move them inside">Fit canvas to objects</button>
        </div>
        <div class="svge-section">
          <div class="svge-section-head">Background</div>
          <div class="svge-bg-options">
            {#each BGS as [val, label, cls]}
              <button class="svge-bg-btn {cls}" class:active={doc.background === val} title={label} aria-label={label} on:click={() => editor.setBackground(val)}></button>
            {/each}
            <!-- Custom color: an outlined square with a +, which shows the chosen color once it is active -->
            <button class="svge-bg-btn svge-bg-custom" class:active={doc.background === 'custom'}
              style={doc.background === 'custom' ? `background:${doc.bgColor ?? '#ffffff'}` : ''}
              title="Custom color" aria-label="Custom color" on:click={() => editor.setBgColor(doc.bgColor ?? '#ffffff')}>
              {#if doc.background !== 'custom'}<span aria-hidden="true">+</span>{/if}
            </button>
          </div>
          {#if doc.background === 'custom'}
            <div class="bg-custom-picker">
              <ColorPicker value={doc.bgColor ?? '#ffffff'} showAlpha={false} on:change={e => editor.setBgColor(e.detail)} />
            </div>
          {/if}
        </div>
        <div class="svge-section">
          <div class="svge-section-head">Background image</div>
          {#if doc.bgImage}
            <div class="bg-preview">
              <img src={doc.bgImage} alt="Background" class="bg-thumb" />
              <button class="clear-btn" on:click={() => editor.setBgImage('')}>Remove</button>
            </div>
            <div class="btn-row bg-fit-row">
              {#each FITS as [val, lbl]}
                <button class="prop-btn" class:active={(doc.bgFit ?? 'cover') === val} title={val === 'cover' ? 'Fill the canvas, cropping the overflow' : lbl} on:click={() => editor.setBgFit(val)}>{lbl}</button>
              {/each}
            </div>
            <button class="svge-action-btn full-w fit-btn" on:click={canvasToImage}
              title="Make the canvas as large as the image (capped at 8000 px)">Resize canvas to image</button>
          {:else}
            <button class="svge-action-btn full-w" on:click={() => bgInput.click()}>Choose image…</button>
          {/if}
          <input bind:this={bgInput} type="file" accept="image/*" style="display:none" on:change={onBgImage} />
        </div>
        <div class="svge-section">
          <div class="svge-section-head">Grid</div>
          <label class="svge-toggle-row">
            <input type="checkbox" checked={$ui.gridEnabled} on:change={e => ui.set({ gridEnabled: (e.target as HTMLInputElement).checked })} /> Show grid
          </label>
          {#if $ui.gridEnabled}
            <div class="geom-grid sliders" style="margin-top:8px">
              <span class="geom-lbl">X</span><SliderInput value={$ui.gridSizeX} min={2} max={200} step={1} unit="px" onChange={v => ui.set({ gridSizeX: v })} />
              <span class="geom-lbl">Y</span><SliderInput value={$ui.gridSizeY} min={2} max={200} step={1} unit="px" onChange={v => ui.set({ gridSizeY: v })} />
            </div>
          {/if}
        </div>
        <div class="svge-section">
          <div class="svge-section-head">Snap</div>
          <label class="svge-toggle-row">
            <input type="checkbox" checked={$ui.snapEnabled} on:change={e => ui.set({ snapEnabled: (e.target as HTMLInputElement).checked })} /> Snap to grid
          </label>
          <label class="svge-toggle-row" title="Edges and centers of other objects, the canvas and guides (Ctrl while dragging turns it off)">
            <input type="checkbox" checked={$ui.snapObjects} on:change={e => ui.set({ snapObjects: (e.target as HTMLInputElement).checked })} /> Snap to objects &amp; guides
          </label>
          <label class="svge-toggle-row" title="Drag from a ruler to place a guide">
            <input type="checkbox" checked={$ui.guidesVisible} on:change={e => ui.set({ guidesVisible: (e.target as HTMLInputElement).checked })} /> Show guides
          </label>
          {#if doc.guides?.length}
            <button class="svge-action-btn full-w fit-btn" on:click={() => editor.clearGuides()}>Clear {doc.guides.length} guide{doc.guides.length === 1 ? '' : 's'}</button>
          {/if}
        </div>

      {:else}
        <div class="svge-empty-panel"><span>Select a tab →</span></div>
      {/if}

      </div>
  {/if}
</div>
</div>

<style>
  .svge-panel-slot { position: relative; width: 0; height: 100%; flex-shrink: 0; transition: width 0.2s ease; }
  .svge-panel-slot.open { width: var(--panel-w); }
  .svge-panel-slot.resizing { transition: none; user-select: none; }
  .svge-panel {
    position: absolute; inset: 0; z-index: 5;
    background: var(--bg-color);
  }
  .svge-panel.open { border-left: 1px solid var(--border-color); }
  .svge-panel-slot.resizing .svge-panel-inner { pointer-events: none; }
  .svge-panel-inner { height: 100%; padding: 10px 10px 0; box-sizing: border-box; display: flex; flex-direction: column; overflow-y: auto; overflow-x: hidden; }
  .panel-title {
    flex: none; display: flex; align-items: center; justify-content: space-between;
    font-size: 1.05rem; font-weight: 600; color: var(--text-color); padding: 2px 2px 10px;
  }
  .panel-count {
    font-size: 0.75rem; font-weight: 500; background: var(--tool-active); border: 1px solid var(--border-color);
    border-radius: 9px; padding: 0 7px; line-height: 17px; opacity: 0.8;
  }

  .svge-panel-collapse {
    position: absolute; left: -17px; top: 50%; transform: translateY(-50%);
    width: 16px; height: 32px; padding: 0; display: flex; align-items: center; justify-content: center;
    background: var(--toolbar-bg); border: 1px solid var(--border-color); border-right: none;
    border-radius: 4px 0 0 4px; cursor: pointer;
  }
  .svge-panel-collapse:hover { background: var(--ruler-bg); }
  .svge-collapse-arrow { font-size: 0.85rem; color: var(--text-color); opacity: 0.6; line-height: 1; user-select: none; }

  .svge-panel-grip {
    position: absolute; left: -3px; top: 0; bottom: 0; width: 7px; cursor: ew-resize; z-index: 2; touch-action: none;
  }
  .svge-panel-grip:hover, .svge-panel-grip:focus-visible, .svge-panel-slot.resizing .svge-panel-grip {
    background: var(--accent-color); opacity: 0.45; outline: none;
  }

  /* ── Narrow screens: a sheet that slides up from the bottom of the drawing area (App.svelte places the slot) ── */
  @media (max-width: 640px) {
    .svge-panel-slot { width: auto; height: 0; transition: height 0.2s ease; }
    .svge-panel-slot.open { width: auto; height: var(--panel-h); }
    .svge-panel.open { border-left: none; border-top: 1px solid var(--border-color); }
    .svge-panel-collapse {
      left: 50%; top: -17px; transform: translateX(-50%); width: 36px; height: 16px;
      border: 1px solid var(--border-color); border-bottom: none; border-radius: 4px 4px 0 0;
    }
    .svge-panel-grip { left: 0; right: 0; top: -3px; bottom: auto; width: auto; height: 7px; cursor: ns-resize; }
    .svge-panel-inner { padding-bottom: 10px; }
  }

  .svge-section { margin-bottom: 16px; }
  .svge-section-head {
    font-size: 0.7rem; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.08em; color: var(--text-color); opacity: 0.55; margin-bottom: 7px;
  }

  /* ── Type row: small rounded squares, like the canvas background swatches ─── */
  .type-row { display: flex; flex-wrap: nowrap; gap: 6px; }
  .type-btn {
    flex: 0 1 34px; min-width: 22px; height: 34px; padding: 0; box-sizing: border-box;
    display: flex; align-items: center; justify-content: center; position: relative; overflow: hidden;
    background: transparent; border: 2px solid var(--border-color); border-radius: 5px; cursor: pointer;
    color: var(--text-color); transition: border-color 0.12s, transform 0.1s;
  }
  .type-btn:hover  { transform: scale(1.05); }
  .type-btn.active { border-color: var(--accent-color); border-width: 2.5px; }
  .type-face { position: absolute; inset: 0; }
  .none-icon { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0.7; }

  /* ── Geometry grid ─────────────────── */
  /* Two number fields side by side (X / Y, W / H, Rx / Ry): a short label in front of each, px implied. */
  .svge-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; flex: 1; min-width: 0; }
  .svge-pair-field { display: flex; align-items: center; padding-left: 4px; min-width: 0; }
  .svge-pair-field > span {
    flex: none; min-width: 12px; font-size: 0.75rem; font-family: monospace; opacity: 0.6; color: var(--text-color);
  }
  .svge-pair-field .svge-num-input { min-width: 0; }
  .svge-section-head:has(.link-btn), .svge-section-head:has(.head-note) { display: flex; align-items: center; justify-content: space-between; }
  .head-note { text-transform: none; letter-spacing: 0; font-weight: 400; }
  .link-btn {
    width: 22px; height: 18px; padding: 0; display: flex; align-items: center; justify-content: center;
    border: 1px solid transparent; border-radius: 4px; background: transparent; color: var(--text-color); cursor: pointer; opacity: 0.8;
  }
  .link-btn:hover { background: var(--ruler-bg); border-color: var(--border-color); }
  .link-btn.on { background: var(--tool-active); border-color: var(--tool-border-active); opacity: 1; }
  .origin-row { display: flex; align-items: center; gap: 8px; }
  .origin-grid { flex: none; display: grid; grid-template-columns: repeat(3, 10px); gap: 3px; padding: 3px; border: 1px solid var(--border-color); border-radius: 4px; }
  .origin-dot { width: 10px; height: 10px; padding: 0; border-radius: 50%; border: 1px solid var(--border-color); background: var(--bg-color); cursor: pointer; }
  .origin-dot:hover { border-color: var(--accent-color); }
  .origin-dot.on { background: var(--accent-color); border-color: var(--accent-color); }

  .geom-grid {
    display: grid; grid-template-columns: 16px minmax(0, 1fr) 18px; gap: 5px 4px; align-items: center;
  }
  
  .geom-grid.sliders { grid-template-columns: 16px minmax(0, 1fr); }
  .geom-lbl { font-size: 0.75rem; font-family: monospace; opacity: 0.6; text-align: right; color: var(--text-color); }
  .geom-unit { font-size: 0.7rem; opacity: 0.45; color: var(--text-color); }

  /* ── History list ──────────────────── */
  .history-actions { flex: none; display: flex; gap: 6px; margin-bottom: 10px; }
  .history-list {
    flex: 1; min-height: 0; overflow-y: auto; margin-bottom: 10px;
    border: 1px solid var(--border-color);
    border-radius: 5px; display: flex; flex-direction: column; user-select: none;
  }
  .history-item {
    display: flex; align-items: center; gap: 6px; padding: 5px 8px;
    background: transparent; border: none; border-bottom: 1px solid var(--border-color);
    cursor: pointer; text-align: left; color: var(--text-color); font-size: 0.82rem; transition: background 0.1s;
  }
  .history-item:last-child { border-bottom: none; }
  .history-item:hover { background: var(--ruler-bg); }
  .history-item.future { opacity: 0.45; }
  .history-present {
    display: flex; align-items: center; gap: 6px; padding: 5px 8px;
    background: var(--tool-active); border-bottom: 1px solid var(--border-color);
    font-size: 0.82rem; color: var(--text-color); font-weight: 600;
  }
  .history-arrow { font-size: 0.75rem; opacity: 0.5; flex-shrink: 0; }
  .history-dot   { font-size: 0.55rem; color: var(--accent-color); flex-shrink: 0; }
  .history-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .dash-fields { display: flex; flex-direction: column; gap: 5px; margin-top: 8px; }
  .dash-pattern { display: grid; grid-template-columns: 44px minmax(0, 1fr); gap: 6px; align-items: center; }
  .dash-pattern .geom-lbl { text-align: left; font-family: inherit; }
  .svge-num-input.bad { border-color: #e74c3c; }
  .svge-num-input:disabled { opacity: 0.45; }
  .rule-btn { height: 30px; display: flex; align-items: center; justify-content: center; }
  .geom-grid.sliders.spacing { grid-template-columns: 40px minmax(0, 1fr); }
  .spacing .geom-lbl { text-align: left; font-family: inherit; }
  .deco-under, .deco-through, .deco-over { font-size: 0.9rem; }
  .deco-under { text-decoration: underline; }
  .deco-through { text-decoration: line-through; }
  .deco-over { text-decoration: overline; }
  .svge-style-btn em { margin-right: 3px; }
  /* ── Dash / linecap / linejoin ──────── */
  .dash-row { display: flex; gap: 4px; }
  .dash-btn {
    flex: 1; height: 28px; display: flex; align-items: center; justify-content: center;
    background: transparent; border: 1px solid var(--border-color); border-radius: 4px;
    cursor: pointer; color: var(--text-color); padding: 0 2px; transition: background 0.1s;
  }
  .dash-btn:hover  { background: var(--ruler-bg); }
  .dash-btn.active { background: var(--tool-active); border-color: var(--tool-border-active); }
  .btn-row { display: flex; gap: 4px; }
  .prop-btn {
    flex: 1; height: 26px; background: transparent; border: 1px solid var(--border-color);
    border-radius: 4px; cursor: pointer; font-size: 0.78rem; color: var(--text-color); transition: background 0.1s;
  }
  .prop-btn:hover  { background: var(--ruler-bg); }
  .prop-btn.active { background: var(--tool-active); border-color: var(--tool-border-active); }

  /* ── Canvas panel ──────────────────── */
  .size-presets { display: flex; flex-wrap: nowrap; gap: 4px; margin-top: 8px; }
  .preset-btn {
    flex: 1 1 auto; min-width: 0; padding: 2px 4px; height: 24px; background: transparent; border: 1px solid var(--border-color);
    border-radius: 3px; cursor: pointer; font-size: 0.75rem; color: var(--text-color); transition: background 0.1s;
  }
  .preset-btn:hover { background: var(--ruler-bg); }

  .bg-preview  { display: flex; align-items: center; gap: 8px; }
  .bg-thumb    { width: 48px; height: 36px; object-fit: cover; border: 1px solid var(--border-color); border-radius: 3px; }
  .clear-btn {
    padding: 3px 8px; background: transparent; border: 1px solid var(--border-color);
    border-radius: 3px; cursor: pointer; font-size: 0.78rem; color: var(--text-color);
  }
  .clear-btn:hover { background: #e74c3c18; border-color: #e74c3c55; color: #e74c3c; }
  .full-w { width: 100%; }

  /* ── Generic ──────────────────────── */
  .svge-num-input {
    padding: 0 6px; height: 28px; border: 1px solid var(--border-color); border-radius: 4px;
    background: var(--bg-color); color: var(--text-color); font-size: 0.82rem; font-family: monospace;
    width: 100%; box-sizing: border-box;
  }
  .svge-num-input:focus { outline: none; border-color: var(--accent-color); }
  .svge-unit { font-size: 0.72rem; opacity: 0.48; color: var(--text-color); flex-shrink: 0; }
  .svge-row  { display: flex; align-items: center; gap: 4px; }
  .svge-style-btn {
    padding: 4px 8px; height: 28px; background: transparent; border: 1px solid var(--border-color);
    border-radius: 4px; cursor: pointer; font-size: 0.75rem; color: var(--text-color); transition: background 0.12s;
  }
  .svge-style-btn:hover  { background: var(--ruler-bg); }
  .svge-style-btn.active { background: var(--tool-active); border-color: var(--tool-border-active); }
  .svge-bg-options { display: flex; flex-wrap: nowrap; gap: 6px; }   /* never wraps: the swatches shrink when the scrollbar takes width */
  .svge-bg-custom {
    background: transparent; display: flex; align-items: center; justify-content: center;
    color: var(--text-color); font-size: 1.4rem; font-weight: 300; line-height: 1; border-style: dashed;
  }
  .svge-bg-custom.active { border-style: solid; }
  .bg-custom-picker { margin-top: 10px; }
  .bg-fit-row { margin-top: 8px; }
  .fit-btn { margin-top: 8px; }
  .svge-bg-btn {
    flex: 0 1 34px; min-width: 22px; height: 34px; border: 2px solid var(--border-color); border-radius: 5px;
    cursor: pointer; padding: 0; transition: border-color 0.12s, transform 0.1s;
  }
  .svge-bg-btn:hover  { transform: scale(1.05); }
  .svge-bg-btn.active { border-color: var(--accent-color); border-width: 2.5px; }
  .svge-action-btn {
    flex: 1; padding: 5px; height: 30px; border: 1px solid var(--border-color); border-radius: 4px;
    background: var(--bg-color); color: var(--text-color); font-size: 0.82rem; cursor: pointer;
  }
  .svge-action-btn:hover:not(:disabled) { background: var(--ruler-bg); }
  .svge-action-btn:disabled { opacity: 0.35; cursor: not-allowed; }
  .svge-toggle-row { display: flex; align-items: center; gap: 6px; font-size: 0.82rem; color: var(--text-color); cursor: pointer; }
  .svge-empty { font-size: 0.82rem; opacity: 0.4; margin: 0; color: var(--text-color); }
  .svge-empty-panel {
    height: 100%; display: flex; align-items: center; justify-content: center;
    font-size: 0.82rem; opacity: 0.3; color: var(--text-color); padding: 20px;
  }
  .svge-badge {
    display: inline-block; font-size: 0.75rem; background: var(--tool-active);
    border: 1px solid var(--border-color); border-radius: 3px; padding: 1px 6px; font-family: monospace; color: var(--text-color);
  }
  .svge-mono { font-size: 0.72rem; font-family: monospace; opacity: 0.45; color: var(--text-color); word-break: break-all; }
</style>