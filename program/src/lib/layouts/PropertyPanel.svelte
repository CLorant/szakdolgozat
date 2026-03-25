<script lang="ts">
  import { editorStore }    from '../stores/editorStore';
  import Layers             from '../components/Layers.svelte';
  import ColorPicker        from '../components/ColorPicker.svelte';
  import SliderInput        from '../components/SliderInput.svelte';
  import FontPicker         from '../components/FontPicker.svelte';
  import { getShapeBounds } from '../utils/bounds';
  import { applyBoundsToShape } from '../utils/bounds';
  import { translateShape } from '../utils/geometry';
  import type { BackgroundType, Shape, BoundingBox, TextProps } from '../utils/types';

  let selectedProperty = '';
  let panelOpen        = false;
  let shapes:  Shape[] = [];
  let selectedShapeIds: string[] = [];
  let primaryShape: Shape | null = null;

  let currentFill        = '#aaaaaa';
  let currentStroke      = '#000000';
  let currentStrokeWidth = 2;
  let background: BackgroundType = 'white';
  let gridEnabled  = false;
  let gridSizeX    = 20;
  let gridSizeY    = 20;
  let snapEnabled  = false;
  let canUndo      = false;
  let canRedo      = false;
  let canvasWidth  = 800;
  let canvasHeight = 600;
  let canvasBgImage = '';
  let historyLabels: string[] = [];
  let futureLabels:  string[] = [];
  let textProps = editorStore.getState().textProps;

  let fill:        string = '#aaaaaa';
  let stroke:      string = '#000000';
  let strokeWidth: number = 2;
  let opacity:     number = 1;
  let strokeLinecap:   'butt'|'round'|'square' = 'round';
  let strokeLinejoin:  'miter'|'round'|'bevel'  = 'round';
  let strokeDasharray: string = '';

  let geomX      = 0;
  let geomY      = 0;
  let geomW      = 0;
  let geomH      = 0;
  let geomRot    = 0;
  let geomBounds: BoundingBox = { x: 0, y: 0, width: 0, height: 0 };

  editorStore.subscribe(s => {
    selectedProperty   = s.selectedProperty;
    panelOpen          = s.panelOpen;
    shapes             = s.shapes;
    selectedShapeIds   = s.selectedShapeIds;
    currentFill        = s.currentFill;
    currentStroke      = s.currentStroke;
    currentStrokeWidth = s.currentStrokeWidth;
    background         = s.background;
    gridEnabled        = s.gridEnabled;
    gridSizeX          = s.gridSizeX;
    gridSizeY          = s.gridSizeY;
    snapEnabled        = s.snapEnabled;
    canUndo            = s.canUndo;
    canRedo            = s.canRedo;
    canvasWidth        = s.canvasWidth;
    canvasHeight       = s.canvasHeight;
    canvasBgImage      = s.canvasBgImage;
    historyLabels      = s.historyLabels;
    futureLabels       = s.futureLabels;
    textProps          = s.textProps;

    primaryShape = s.selectedShapeIds[0]
      ? s.shapes.find(sh => sh.id === s.selectedShapeIds[0]) ?? null
      : null;

    fill        = primaryShape?.fill        ?? s.currentFill;
    stroke      = primaryShape?.stroke      ?? s.currentStroke;
    strokeWidth = primaryShape?.strokeWidth ?? s.currentStrokeWidth;
    opacity     = primaryShape?.opacity     ?? 1;
    strokeLinecap   = (primaryShape as any)?.strokeLinecap   ?? 'round';
    strokeLinejoin  = (primaryShape as any)?.strokeLinejoin  ?? 'round';
    strokeDasharray = (primaryShape as any)?.strokeDasharray ?? '';

    if (primaryShape) {
      geomBounds = getShapeBounds(primaryShape);
      geomX   = Math.round(geomBounds.x   * 10) / 10;
      geomY   = Math.round(geomBounds.y   * 10) / 10;
      geomW   = Math.round(geomBounds.width  * 10) / 10;
      geomH   = Math.round(geomBounds.height * 10) / 10;
      geomRot = (primaryShape as any).rotation ?? 0;
    }
  });

  $: fillType   = (fill   === 'none' || fill   === 'transparent') ? 'none' : 'solid';
  $: strokeType = (stroke === 'none' || stroke === 'transparent') ? 'none' : 'solid';
  let lastFill   = '#aaaaaa';
  let lastStroke = '#000000';
  $: if (fillType   === 'solid' && fill   !== 'none') lastFill   = fill;
  $: if (strokeType === 'solid' && stroke !== 'none') lastStroke = stroke;
  $: activeText = (primaryShape?.type === 'text' ? primaryShape : null) as any;
  // Display text props: selected text shape's props take priority over global defaults
  $: tp = activeText ?? textProps;

  // ── Setters ───────────────────────────────────────────────────────────────
  function setFill(v: string) {
    if (primaryShape) editorStore.updateShape(primaryShape.id, { fill: v });
    else editorStore.setFill(v);
  }
  function setStroke(v: string) {
    if (primaryShape) editorStore.updateShape(primaryShape.id, { stroke: v });
    else editorStore.setStroke(v);
  }
  function setStrokeWidth(v: number) {
    if (primaryShape) editorStore.updateShape(primaryShape.id, { strokeWidth: v });
    else editorStore.setStrokeWidth(v);
  }
  function setOpacity(v: number) {
    if (primaryShape) editorStore.updateShape(primaryShape.id, { opacity: v });
  }
  function setFillType(t: 'none'|'solid')   { setFill(t === 'none' ? 'none' : lastFill);   }
  function setStrokeType(t: 'none'|'solid') { setStroke(t === 'none' ? 'none' : lastStroke); }
  function setStrokeAttr(key: string, v: string) {
    if (primaryShape) editorStore.updateShape(primaryShape.id, { [key]: v } as any);
  }

  /**
   * Update a text property on both the selected shape (if any) and the global
   * text-props defaults so new shapes inherit the setting.
   *
   * BUG FIX: previously this function called itself recursively
   * (`setTp(key, value)` at the bottom) which caused an immediate stack
   * overflow / Maximum call stack size exceeded error. The last line must
   * call `editorStore.setTextProp`, not `setTp`.
   */
  function setTp<K extends keyof TextProps>(key: K, value: TextProps[K]) {
    if (activeText) editorStore.updateShape(activeText.id, { [key]: value } as any);
    editorStore.setTextProp(key, value);
  }

  // ── Geometry setters ──────────────────────────────────────────────────────
  function applyGeomX(newX: number) {
    if (!primaryShape) return;
    const dx = newX - geomBounds.x;
    editorStore.updateShape(primaryShape.id, translateShape(primaryShape, dx, 0) as any);
  }
  function applyGeomY(newY: number) {
    if (!primaryShape) return;
    const dy = newY - geomBounds.y;
    editorStore.updateShape(primaryShape.id, translateShape(primaryShape, 0, dy) as any);
  }
  function applyGeomW(newW: number) {
    if (!primaryShape || newW < 1) return;
    const nb: BoundingBox = { ...geomBounds, width: newW };
    editorStore.updateShape(primaryShape.id, applyBoundsToShape(primaryShape, nb) as any);
  }
  function applyGeomH(newH: number) {
    if (!primaryShape || newH < 1) return;
    const nb: BoundingBox = { ...geomBounds, height: newH };
    editorStore.updateShape(primaryShape.id, applyBoundsToShape(primaryShape, nb) as any);
  }
  function applyGeomRot(deg: number) {
    if (!primaryShape) return;
    editorStore.updateShape(primaryShape.id, { rotation: ((deg % 360) + 360) % 360 } as any);
  }
  function onGeomInput(e: Event, fn: (v: number) => void) {
    const v = parseFloat((e.target as HTMLInputElement).value);
    if (!isNaN(v)) fn(v);
  }

  // ── Image background ──────────────────────────────────────────────────────
  let bgImageInput: HTMLInputElement;
  function pickBgImage() { bgImageInput?.click(); }
  function onBgImageChange(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => editorStore.setCanvasBgImage(reader.result as string);
    reader.readAsDataURL(file);
  }
  function clearBgImage() { editorStore.setCanvasBgImage(''); }

  const dashPresets = [
    { label: '—',   value: '' },
    { label: '- -', value: '6,4' },
    { label: '···', value: '2,4' },
    { label: '-·-', value: '8,4,2,4' },
  ];
</script>

<div class="svge-panel" class:open={panelOpen} aria-hidden={!panelOpen}>
  {#if panelOpen}
    <div class="svge-panel-inner">

      <!-- ── Fill ─────────────────────────────────────────────────────────── -->
      {#if selectedProperty === 'fill'}
        <div class="svge-section">
          <div class="svge-section-head">Fill type</div>
          <div class="type-row">
            <button class="type-btn" class:active={fillType==='none'} on:click={() => setFillType('none')}>
              <span class="no-fill-icon">⊘</span> None
            </button>
            <button class="type-btn" class:active={fillType==='solid'} on:click={() => setFillType('solid')}>
              <span class="solid-dot" style="background:{fillType==='solid'?fill.slice(0,7):'#aaa'}"></span> Solid
            </button>
          </div>
        </div>
        {#if fillType === 'solid'}
          <div class="svge-section">
            <div class="svge-section-head">Fill colour</div>
            <ColorPicker value={fill} showAlpha={true} on:change={e => setFill(e.detail)} />
          </div>
        {/if}
        <div class="svge-section">
          <div class="svge-section-head">Object opacity</div>
          <SliderInput value={Math.round(opacity*100)} min={0} max={100} step={1} unit="%"
            disabled={!primaryShape} onChange={v => setOpacity(v/100)} />
        </div>

      <!-- ── Stroke ─────────────────────────────────────────────────────── -->
      {:else if selectedProperty === 'stroke'}
        <div class="svge-section">
          <div class="svge-section-head">Stroke type</div>
          <div class="type-row">
            <button class="type-btn" class:active={strokeType==='none'} on:click={() => setStrokeType('none')}>
              <span class="no-fill-icon">⊘</span> None
            </button>
            <button class="type-btn" class:active={strokeType==='solid'} on:click={() => setStrokeType('solid')}>
              <span class="solid-dot" style="background:{strokeType==='solid'?stroke.slice(0,7):'#aaa'}"></span> Solid
            </button>
          </div>
        </div>
        {#if strokeType === 'solid'}
          <div class="svge-section">
            <div class="svge-section-head">Stroke colour</div>
            <ColorPicker value={stroke} showAlpha={false} on:change={e => setStroke(e.detail)} />
          </div>
          <div class="svge-section">
            <div class="svge-section-head">Width</div>
            <SliderInput value={strokeWidth} min={0} max={40} step={0.5} unit="px"
              onChange={v => setStrokeWidth(v)} />
          </div>
          <div class="svge-section">
            <div class="svge-section-head">Dash pattern</div>
            <div class="dash-row">
              {#each dashPresets as p}
                <button class="dash-btn" class:active={strokeDasharray===p.value}
                  on:click={() => setStrokeAttr('strokeDasharray', p.value)} title={p.value||'Solid'}>
                  <svg width="32" height="10" viewBox="0 0 32 10">
                    <line x1="1" y1="5" x2="31" y2="5" stroke="currentColor" stroke-width="2"
                      stroke-linecap="round" stroke-dasharray={p.value||undefined}/>
                  </svg>
                </button>
              {/each}
            </div>
          </div>
          <div class="svge-section">
            <div class="svge-section-head">Line cap</div>
            <div class="btn-row">
              {#each [['butt','Flat'],['round','Round'],['square','Square']] as [val, lbl]}
                <button class="prop-btn" class:active={strokeLinecap===val}
                  on:click={() => setStrokeAttr('strokeLinecap', val)}>{lbl}</button>
              {/each}
            </div>
          </div>
          <div class="svge-section">
            <div class="svge-section-head">Line join</div>
            <div class="btn-row">
              {#each [['miter','Miter'],['round','Round'],['bevel','Bevel']] as [val, lbl]}
                <button class="prop-btn" class:active={strokeLinejoin===val}
                  on:click={() => setStrokeAttr('strokeLinejoin', val)}>{lbl}</button>
              {/each}
            </div>
          </div>
        {/if}

      <!-- ── Geometry ───────────────────────────────────────────────────── -->
      {:else if selectedProperty === 'geometry'}
        {#if primaryShape}
          <div class="svge-section">
            <div class="svge-section-head">Position</div>
            <div class="geom-grid">
              <span class="geom-lbl">X</span>
              <input type="number" class="svge-num-input" value={geomX} step="1"
                on:change={e => onGeomInput(e, applyGeomX)} />
              <span class="geom-unit">px</span>

              <span class="geom-lbl">Y</span>
              <input type="number" class="svge-num-input" value={geomY} step="1"
                on:change={e => onGeomInput(e, applyGeomY)} />
              <span class="geom-unit">px</span>
            </div>
          </div>

          <div class="svge-section">
            <div class="svge-section-head">Size</div>
            <div class="geom-grid">
              <span class="geom-lbl">W</span>
              <input type="number" class="svge-num-input" value={geomW} min="1" step="1"
                on:change={e => onGeomInput(e, applyGeomW)} />
              <span class="geom-unit">px</span>

              <span class="geom-lbl">H</span>
              <input type="number" class="svge-num-input" value={geomH} min="1" step="1"
                on:change={e => onGeomInput(e, applyGeomH)} />
              <span class="geom-unit">px</span>
            </div>
          </div>

          <div class="svge-section">
            <div class="svge-section-head">Rotation</div>
            <SliderInput value={geomRot} min={0} max={360} step={1} unit="°"
              numWidth={48} onChange={applyGeomRot} />
          </div>

          {#if primaryShape.type === 'rectangle'}
            <div class="svge-section">
              <div class="svge-section-head">Corner radius</div>
              <div class="geom-grid">
                <span class="geom-lbl">RX</span>
                <input type="number" class="svge-num-input" value={primaryShape.rx ?? 0} min="0" step="1"
                  on:change={e => {
                    const v = parseFloat((e.target as HTMLInputElement).value);
                    if (!isNaN(v) && primaryShape) editorStore.updateShape(primaryShape.id, { rx: v, ry: v } as any);
                  }} />
                <span class="geom-unit">px</span>
              </div>
            </div>
          {/if}

          {#if primaryShape.type === 'text'}
            <div class="svge-section">
              <div class="svge-section-head">Font size</div>
              <div class="geom-grid">
                <span class="geom-lbl">Sz</span>
                <input type="number" class="svge-num-input" value={primaryShape.fontSize} min="1" step="1"
                  on:change={e => {
                    const v = parseFloat((e.target as HTMLInputElement).value);
                    if (!isNaN(v) && primaryShape) editorStore.updateShape(primaryShape.id, { fontSize: v } as any);
                  }} />
                <span class="geom-unit">px</span>
              </div>
            </div>
          {/if}

        {:else}
          <p class="svge-empty">Select a shape to view its geometry.</p>
        {/if}

      <!-- ── Transform ─────────────────────────────────────────────────── -->
      {:else if selectedProperty === 'transform'}
        {#if primaryShape}
          <div class="svge-section">
            <div class="svge-section-head">Shape</div>
            <span class="svge-badge">{primaryShape.type}</span>
          </div>
          <div class="svge-section">
            <div class="svge-section-head">ID</div>
            <span class="svge-mono">{primaryShape.id}</span>
          </div>
        {:else}
          <p class="svge-empty">Select a shape.</p>
        {/if}

      <!-- ── Text props ─────────────────────────────────────────────────── -->
      {:else if selectedProperty === 'text-props'}
        <div class="svge-section">
          <div class="svge-section-head">Font family</div>
          <FontPicker
            value={tp.fontFamily}
            onChange={f => setTp('fontFamily', f)}
          />
        </div>
        <div class="svge-section">
          <div class="svge-section-head">Size</div>
          <div class="svge-row">
            <input type="number" class="svge-num-input" value={tp.fontSize} min="6" max="400"
              on:change={e => setTp('fontSize', parseFloat((e.target as HTMLInputElement).value))} />
            <span class="svge-unit">px</span>
          </div>
        </div>
        <div class="svge-section">
          <div class="svge-section-head">Style</div>
          <div class="svge-row" style="gap:4px">
            <button class="svge-style-btn" class:active={tp.fontWeight==='bold'}
              on:click={() => setTp('fontWeight', tp.fontWeight==='bold'?'normal':'bold')}><strong>B</strong></button>
            <button class="svge-style-btn" class:active={tp.fontStyle==='italic'}
              on:click={() => setTp('fontStyle', tp.fontStyle==='italic'?'normal':'italic')}><em>I</em></button>
            <button class="svge-style-btn" class:active={tp.textDecoration==='underline'}
              on:click={() => setTp('textDecoration', tp.textDecoration==='underline'?'none':'underline')}><u>U</u></button>
          </div>
        </div>
        <div class="svge-section">
          <div class="svge-section-head">Alignment</div>
          <div class="svge-row" style="gap:4px">
            {#each [['start','⊣ Left'],['middle','⊼ Center'],['end','⊢ Right']] as [val, label]}
              <button class="svge-style-btn" class:active={tp.textAnchor===val}
                on:click={() => setTp('textAnchor', val as any)}>{label}</button>
            {/each}
          </div>
        </div>
        <div class="svge-section">
          <div class="svge-section-head">Letter spacing</div>
          <SliderInput value={tp.letterSpacing ?? 0} min={-5} max={20} step={0.5} unit="px"
            onChange={v => setTp('letterSpacing', v)} />
        </div>

      <!-- ── Layers ─────────────────────────────────────────────────────── -->
      {:else if selectedProperty === 'layers'}
        <Layers />

      <!-- ── Defs ───────────────────────────────────────────────────────── -->
      {:else if selectedProperty === 'defs'}
        <div class="svge-section">
          <div class="svge-section-head">Defs / Symbols</div>
          <p class="svge-empty">Symbol and gradient management coming soon.</p>
        </div>

      <!-- ── History ───────────────────────────────────────────────────── -->
      {:else if selectedProperty === 'history'}
        <div class="svge-section">
          <div class="svge-section-head">Actions</div>
          <div class="history-list">
            {#each [...futureLabels].reverse() as label, i}
              <button
                class="history-item future"
                title="Redo to this state"
                on:click={() => {
                  const times = futureLabels.length - i;
                  for (let t = 0; t < times; t++) editorStore.redo();
                }}
              >
                <span class="history-arrow">↻</span>
                <span class="history-label">{label}</span>
              </button>
            {/each}

            <div class="history-present">
              <span class="history-dot">●</span>
              <span class="history-label">Current state</span>
            </div>

            {#each [...historyLabels].reverse() as label, i}
              {@const idx = historyLabels.length - 1 - i}
              <button
                class="history-item"
                title="Undo to this state"
                on:click={() => editorStore.jumpToHistory(idx)}
              >
                <span class="history-arrow">↺</span>
                <span class="history-label">{label}</span>
              </button>
            {/each}

            {#if !historyLabels.length && !futureLabels.length}
              <p class="svge-empty" style="padding:8px 0">No actions yet.</p>
            {/if}
          </div>
        </div>
        <div class="svge-section">
          <div class="svge-row" style="gap:6px">
            <button class="svge-action-btn" disabled={!canUndo} on:click={() => editorStore.undo()}>↺ Undo</button>
            <button class="svge-action-btn" disabled={!canRedo} on:click={() => editorStore.redo()}>↻ Redo</button>
          </div>
        </div>

      <!-- ── Canvas ─────────────────────────────────────────────────────── -->
      {:else if selectedProperty === 'canvas'}
        <div class="svge-section">
          <div class="svge-section-head">Canvas size</div>
          <div class="geom-grid">
            <span class="geom-lbl">W</span>
            <input type="number" class="svge-num-input" value={canvasWidth} min="100" max="8000" step="1"
              on:change={e => {
                const v = parseInt((e.target as HTMLInputElement).value);
                if (!isNaN(v)) editorStore.setCanvasSize(v, canvasHeight);
              }} />
            <span class="geom-unit">px</span>

            <span class="geom-lbl">H</span>
            <input type="number" class="svge-num-input" value={canvasHeight} min="100" max="8000" step="1"
              on:change={e => {
                const v = parseInt((e.target as HTMLInputElement).value);
                if (!isNaN(v)) editorStore.setCanvasSize(canvasWidth, v);
              }} />
            <span class="geom-unit">px</span>
          </div>
          <div class="size-presets">
            {#each [['A4 landscape','1122,794'],['HD','1280,720'],['4K','3840,2160'],['Square','800,800']] as [lbl, dims]}
              <button class="preset-btn" on:click={() => {
                const [w,h] = dims.split(',').map(Number);
                editorStore.setCanvasSize(w, h);
              }}>{lbl}</button>
            {/each}
          </div>
        </div>

        <div class="svge-section">
          <div class="svge-section-head">Background</div>
          <div class="svge-bg-options">
            {#each [['white','White','bg-white'],['black','Black','bg-black'],['transparent-light','Light transparent','bg-transparent-light'],['transparent-dark','Dark transparent','bg-transparent-dark']] as [val, label, cls]}
              <button class="svge-bg-btn {cls}" class:active={background===val}
                title={label} on:click={() => editorStore.setBackground(val as BackgroundType)}></button>
            {/each}
          </div>
        </div>

        <div class="svge-section">
          <div class="svge-section-head">Background image</div>
          {#if canvasBgImage}
            <div class="bg-preview">
              <img src={canvasBgImage} alt="Background" class="bg-thumb" />
              <button class="clear-btn" on:click={clearBgImage}>Remove</button>
            </div>
          {:else}
            <button class="svge-action-btn full-w" on:click={pickBgImage}>Choose image…</button>
          {/if}
          <input bind:this={bgImageInput} type="file" accept="image/*"
            style="display:none" on:change={onBgImageChange} />
        </div>

        <div class="svge-section">
          <div class="svge-section-head">Grid</div>
          <label class="svge-toggle-row">
            <input type="checkbox" checked={gridEnabled}
              on:change={e => editorStore.setGridEnabled((e.target as HTMLInputElement).checked)} />
            Show grid
          </label>
          {#if gridEnabled}
            <div class="geom-grid" style="margin-top:8px">
              <span class="geom-lbl">X</span>
              <SliderInput value={gridSizeX} min={2} max={200} step={1} unit="px"
                onChange={v => editorStore.setGridSizeX(v)} />
              <span></span>
              <span class="geom-lbl">Y</span>
              <SliderInput value={gridSizeY} min={2} max={200} step={1} unit="px"
                onChange={v => editorStore.setGridSizeY(v)} />
            </div>
          {/if}
        </div>

        <div class="svge-section">
          <div class="svge-section-head">Snap</div>
          <label class="svge-toggle-row">
            <input type="checkbox" checked={snapEnabled}
              on:change={e => editorStore.setSnapEnabled((e.target as HTMLInputElement).checked)} />
            Snap to grid
          </label>
        </div>

      {:else}
        <div class="svge-empty-panel"><span>Select a tab →</span></div>
      {/if}

    </div>
  {/if}
</div>

<style>
  .svge-panel {
    width: 0; overflow: hidden; transition: width 0.2s ease;
    background: var(--bg-color); border-left: none; height: 100%; flex-shrink: 0;
  }
  .svge-panel.open { width: 224px; border-left: 1px solid var(--border-color); overflow-y: auto; }
  .svge-panel-inner { width: 224px; padding: 10px; box-sizing: border-box; }

  .svge-section { margin-bottom: 16px; }
  .svge-section-head {
    font-size: 0.72rem; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.08em; color: var(--text-color); opacity: 0.55; margin-bottom: 7px;
  }

  /* ── Type row ─────────────────────── */
  .type-row { display: flex; gap: 5px; }
  .type-btn {
    flex: 1; height: 30px; display: flex; align-items: center; justify-content: center;
    gap: 5px; background: transparent; border: 1px solid var(--border-color);
    border-radius: 5px; cursor: pointer; font-size: 0.82rem; color: var(--text-color); transition: background 0.1s;
  }
  .type-btn:hover  { background: var(--ruler-bg); }
  .type-btn.active { background: var(--tool-active); border-color: var(--tool-border-active); }
  .no-fill-icon { font-size: 0.85rem; opacity: 0.55; }
  .solid-dot { width: 10px; height: 10px; border-radius: 50%; border: 1px solid rgba(0,0,0,0.15); flex-shrink: 0; }

  /* ── Geometry grid ─────────────────── */
  .geom-grid {
    display: grid; grid-template-columns: 22px 1fr 20px; gap: 5px 4px; align-items: center;
  }
  .geom-lbl { font-size: 0.75rem; font-family: monospace; opacity: 0.6; text-align: right; color: var(--text-color); }
  .geom-unit { font-size: 0.7rem; opacity: 0.45; color: var(--text-color); }

  /* ── History list ──────────────────── */
  .history-list {
    max-height: 260px; overflow-y: auto; border: 1px solid var(--border-color);
    border-radius: 5px; display: flex; flex-direction: column;
    scrollbar-width: thin; scrollbar-color: var(--border-color) transparent;
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
  .size-presets { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
  .preset-btn {
    padding: 2px 7px; height: 24px; background: transparent; border: 1px solid var(--border-color);
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
    border-radius: 4px; cursor: pointer; font-size: 0.85rem; color: var(--text-color); transition: background 0.12s;
  }
  .svge-style-btn:hover  { background: var(--ruler-bg); }
  .svge-style-btn.active { background: var(--tool-active); border-color: var(--tool-border-active); }
  .svge-bg-options { display: flex; gap: 6px; }
  .svge-bg-btn {
    width: 44px; height: 44px; border: 2px solid var(--border-color); border-radius: 5px;
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