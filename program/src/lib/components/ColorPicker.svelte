<script lang="ts">
  /**
   * ColorPicker — fully custom, pointer-captured, no external library.
   *
   * Props:
   *   value     — current color as hex string ('#rrggbb' or '#rrggbbaa')
   *   showAlpha — whether to show the alpha slider (default true)
   *
   * Dispatches:
   *   change(hex: string) — every time the color changes interactively
   */
  import { createEventDispatcher } from 'svelte';

  export let value     = '#aaaaaa';
  export let showAlpha = true;

  const dispatch = createEventDispatcher<{ change: string }>();

  // ── Internal HSV + alpha ────────────────────────────────────────────────
  let h = 0, s = 100, v = 100, a = 1;
  let mode: 'hex' | 'rgb' | 'hsl' = 'hex';
  let hexText = '';

  /**
   * The last hex value we ourselves emitted. If the parent echoes this same
   * value back through the `value` prop we skip re-syncing so we don't
   * overwrite the user's live drag position.
   */
  let _lastEmittedHex = '';

  // Re-parse whenever the prop changes from outside, but not when the parent
  // is just echoing back what we already emitted.
  $: if (value && value !== _lastEmittedHex) _syncFromProp(value);

  function _syncFromProp(val: string) {
    const c = parseColor(val);
    if (!c) return;
    const hsv = _rgbToHsv(c.r, c.g, c.b);
    if (hsv.s > 1) h = hsv.h;
    s = hsv.s; v = hsv.v;
    a = showAlpha ? c.a : 1;
    _refreshHexText();
  }

  function _refreshHexText() {
    const rgb = _hsvToRgb(h, s, v);
    hexText = _rgbToHex(rgb.r, rgb.g, rgb.b, showAlpha ? a : 1).toUpperCase();
  }

  // ── Derived display values ───────────────────────────────────────────────
  $: _rgb  = _hsvToRgb(h, s, v);
  $: _hsl  = _rgbToHsl(_rgb.r, _rgb.g, _rgb.b);
  $: _alphaGrad = `linear-gradient(to right, rgba(${_rgb.r},${_rgb.g},${_rgb.b},0) 0%, rgb(${_rgb.r},${_rgb.g},${_rgb.b}) 100%)`;
  $: _swatchStyle = `background: rgba(${_rgb.r},${_rgb.g},${_rgb.b},${a})`;

  /**
   * Compute the current color DIRECTLY from h/s/v/a rather than reading the
   * reactive `_hex` variable, which may not have updated yet inside an event
   * handler (Svelte 4 defers reactive re-computations to after the current
   * tick). Dispatching a stale value was the root cause of the "jump back"
   * bug on SV panel and alpha slider drags.
   */
  function _emit() {
    const rgb = _hsvToRgb(h, s, v);
    const currentHex = _rgbToHex(rgb.r, rgb.g, rgb.b, showAlpha ? a : 1);
    _lastEmittedHex = currentHex;
    dispatch('change', currentHex);
  }

  // ── SV (saturation/value) panel ─────────────────────────────────────────
  function onSVDown(e: PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    _updateSV(e);
  }
  function onSVMove(e: PointerEvent) {
    if (!(e.buttons & 1)) return;
    _updateSV(e);
  }
  function _updateSV(e: PointerEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    s = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width)  * 100));
    v = Math.max(0, Math.min(100, (1 - (e.clientY - rect.top)  / rect.height) * 100));
    _refreshHexText();
    _emit();
  }

  // ── Hue slider ───────────────────────────────────────────────────────────
  function onHueDown(e: PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    _updateHue(e);
  }
  function onHueMove(e: PointerEvent) {
    if (!(e.buttons & 1)) return;
    _updateHue(e);
  }
  function _updateHue(e: PointerEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    h = Math.max(0, Math.min(360, ((e.clientX - rect.left) / rect.width) * 360));
    _refreshHexText();
    _emit();
  }

  // ── Alpha slider ─────────────────────────────────────────────────────────
  function onAlphaDown(e: PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    _updateAlpha(e);
  }
  function onAlphaMove(e: PointerEvent) {
    if (!(e.buttons & 1)) return;
    _updateAlpha(e);
  }
  function _updateAlpha(e: PointerEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    a = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    _refreshHexText();
    _emit();
  }

  // ── Hex input ────────────────────────────────────────────────────────────
  // Using bind:value so user can type freely; we commit on blur or Enter.
  function commitHex() {
    const raw = hexText.trim();
    const c   = parseColor(raw.startsWith('#') ? raw : '#' + raw);
    if (c) {
      const hsv = _rgbToHsv(c.r, c.g, c.b);
      if (hsv.s > 1) h = hsv.h;
      s = hsv.s; v = hsv.v;
      a = showAlpha ? c.a : 1;
      _refreshHexText();
      _emit();
    } else {
      // Invalid input — reset display to current valid color
      _refreshHexText();
    }
  }
  function onHexKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); commitHex(); }
  }

  // ── Alpha % input ─────────────────────────────────────────────────────────
  function commitAlpha(e: Event) {
    const n = parseFloat((e.target as HTMLInputElement).value);
    if (!isNaN(n)) { a = Math.max(0, Math.min(1, n / 100)); _refreshHexText(); _emit(); }
  }

  // ── RGB inputs ───────────────────────────────────────────────────────────
  // Using on:input for immediate apply; the number field only fires valid numbers.
  function setR(n: number) { _setRgb(Math.round(n), _rgb.g, _rgb.b); }
  function setG(n: number) { _setRgb(_rgb.r, Math.round(n), _rgb.b); }
  function setB(n: number) { _setRgb(_rgb.r, _rgb.g, Math.round(n)); }
  function _setRgb(r: number, g: number, b: number) {
    const hsv = _rgbToHsv(r, g, b);
    if (hsv.s > 1) h = hsv.h;
    s = hsv.s; v = hsv.v;
    _refreshHexText(); _emit();
  }

  // ── HSL inputs ───────────────────────────────────────────────────────────
  function setHslH(hh: number) { _setHsl(hh, _hsl.s, _hsl.l); }
  function setHslS(ss: number) { _setHsl(_hsl.h, ss, _hsl.l); }
  function setHslL(ll: number) { _setHsl(_hsl.h, _hsl.s, ll); }
  function _setHsl(hh: number, ss: number, ll: number) {
    const rgb = _hslToRgb(hh, ss, ll);
    const hsv = _rgbToHsv(rgb.r, rgb.g, rgb.b);
    if (hsv.s > 1) h = hsv.h;
    s = hsv.s; v = hsv.v;
    _refreshHexText(); _emit();
  }

  function _numInput(e: Event, cb: (n: number) => void) {
    const val = parseFloat((e.target as HTMLInputElement).value);
    if (!isNaN(val)) cb(val);
  }

  // ── Color math ───────────────────────────────────────────────────────────

  export function parseColor(val: string): { r:number; g:number; b:number; a:number } | null {
    if (!val) return null;
    const hex = val.replace(/^#/, '');
    if (/^[0-9a-fA-F]{3}$/.test(hex)) {
      return {
        r: parseInt(hex[0]+hex[0], 16),
        g: parseInt(hex[1]+hex[1], 16),
        b: parseInt(hex[2]+hex[2], 16), a: 1,
      };
    }
    if (/^[0-9a-fA-F]{6}$/.test(hex)) {
      return {
        r: parseInt(hex.slice(0,2), 16),
        g: parseInt(hex.slice(2,4), 16),
        b: parseInt(hex.slice(4,6), 16), a: 1,
      };
    }
    if (/^[0-9a-fA-F]{8}$/.test(hex)) {
      return {
        r: parseInt(hex.slice(0,2), 16),
        g: parseInt(hex.slice(2,4), 16),
        b: parseInt(hex.slice(4,6), 16),
        a: parseInt(hex.slice(6,8), 16) / 255,
      };
    }
    const m = val.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/i);
    if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? +m[4] : 1 };
    return null;
  }

  function _rgbToHsv(r: number, g: number, b: number) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max - min;
    let hh = 0;
    if (d !== 0) {
      switch (max) {
        case r: hh = ((g-b)/d + (g<b ? 6 : 0)) / 6; break;
        case g: hh = ((b-r)/d + 2) / 6; break;
        case b: hh = ((r-g)/d + 4) / 6; break;
      }
    }
    return { h: hh*360, s: max===0 ? 0 : (d/max)*100, v: max*100 };
  }

  function _hsvToRgb(h: number, s: number, v: number) {
    h /= 360; s /= 100; v /= 100;
    const i = Math.floor(h*6), f = h*6-i;
    const p = v*(1-s), q = v*(1-f*s), t = v*(1-(1-f)*s);
    let r=0,g=0,b=0;
    switch(i%6){
      case 0:r=v;g=t;b=p;break; case 1:r=q;g=v;b=p;break;
      case 2:r=p;g=v;b=t;break; case 3:r=p;g=q;b=v;break;
      case 4:r=t;g=p;b=v;break; case 5:r=v;g=p;b=q;break;
    }
    return { r:Math.round(r*255), g:Math.round(g*255), b:Math.round(b*255) };
  }

  function _rgbToHsl(r: number, g: number, b: number) {
    r/=255; g/=255; b/=255;
    const max=Math.max(r,g,b), min=Math.min(r,g,b), l=(max+min)/2;
    let hh=0, ss=0;
    if (max !== min) {
      const d = max-min;
      ss = l>0.5 ? d/(2-max-min) : d/(max+min);
      switch(max){
        case r: hh=((g-b)/d+(g<b?6:0))/6;break;
        case g: hh=((b-r)/d+2)/6;break;
        case b: hh=((r-g)/d+4)/6;break;
      }
    }
    return { h:Math.round(hh*360), s:Math.round(ss*100), l:Math.round(l*100) };
  }

  function _hslToRgb(h: number, s: number, l: number) {
    h/=360; s/=100; l/=100;
    let r: number, g: number, b: number;
    if (s === 0) { r=g=b=l; }
    else {
      const q = l<0.5 ? l*(1+s) : l+s-l*s, p = 2*l-q;
      const hue2 = (t: number) => {
        if (t<0) t+=1; if (t>1) t-=1;
        if (t<1/6) return p+(q-p)*6*t;
        if (t<1/2) return q;
        if (t<2/3) return p+(q-p)*(2/3-t)*6;
        return p;
      };
      r=hue2(h+1/3); g=hue2(h); b=hue2(h-1/3);
    }
    return { r:Math.round(r*255), g:Math.round(g*255), b:Math.round(b*255) };
  }

  function _toHex2(n: number) { return Math.round(Math.max(0,Math.min(255,n))).toString(16).padStart(2,'0'); }
  function _rgbToHex(r: number, g: number, b: number, al = 1) {
    return '#' + _toHex2(r) + _toHex2(g) + _toHex2(b) + (al < 0.9961 ? _toHex2(al*255) : '');
  }
</script>

<div class="cp-wrap">
  <!-- ── Saturation / Value 2D panel ───────────────────────────────── -->
  <div
    class="sv-panel"
    style="--cp-hue:{h}deg"
    on:pointerdown={onSVDown}
    on:pointermove={onSVMove}
    on:pointerup={() => {}}
    role="presentation"
  >
    <div class="sv-thumb" style="left:{s}%; top:{100-v}%"></div>
  </div>

  <!-- ── Hue slider ────────────────────────────────────────────────── -->
  <div class="slider-row">
    <div class="swatch" style={_swatchStyle}></div>
    <div class="sliders">
      <div
        class="cp-slider hue-track"
        on:pointerdown={onHueDown}
        on:pointermove={onHueMove}
        on:pointerup={() => {}}
        role="presentation"
      >
        <div class="cp-thumb" style="left:{(h/360)*100}%"></div>
      </div>

      <!-- ── Alpha slider ──────────────────────────────────────────── -->
      {#if showAlpha}
        <div
          class="cp-slider alpha-track"
          style="--alpha-grad:{_alphaGrad}"
          on:pointerdown={onAlphaDown}
          on:pointermove={onAlphaMove}
          on:pointerup={() => {}}
          role="presentation"
        >
          <div class="cp-thumb" style="left:{a*100}%"></div>
        </div>
      {/if}
    </div>
  </div>

  <!-- ── Mode tabs ─────────────────────────────────────────────────── -->
  <div class="mode-tabs">
    {#each (['hex','rgb','hsl'] as const) as m}
      <button
        class="mode-tab"
        class:active={mode === m}
        on:click={() => mode = m}
      >{m.toUpperCase()}</button>
    {/each}
  </div>

  <!-- ── Inputs ────────────────────────────────────────────────────── -->
  <div class="inputs">
    {#if mode === 'hex'}
      <!-- bind:value so the user can type freely; committed on blur or Enter -->
      <input
        type="text"
        class="hex-input"
        bind:value={hexText}
        on:blur={commitHex}
        on:keydown={onHexKeyDown}
        spellcheck="false"
        maxlength="9"
      />
      {#if showAlpha}
        <div class="alpha-num-wrap">
          <input
            type="number" min="0" max="100" step="1"
            class="num-small"
            value={Math.round(a*100)}
            on:change={commitAlpha}
          />
          <span class="unit">%</span>
        </div>
      {/if}

    {:else if mode === 'rgb'}
      <div class="channel-row">
        <div class="channel">
          <span class="ch-label">R</span>
          <input type="number" min="0" max="255" step="1" class="num-small" value={_rgb.r}
            on:change={e => _numInput(e, setR)} />
        </div>
        <div class="channel">
          <span class="ch-label">G</span>
          <input type="number" min="0" max="255" step="1" class="num-small" value={_rgb.g}
            on:change={e => _numInput(e, setG)} />
        </div>
        <div class="channel">
          <span class="ch-label">B</span>
          <input type="number" min="0" max="255" step="1" class="num-small" value={_rgb.b}
            on:change={e => _numInput(e, setB)} />
        </div>
        {#if showAlpha}
          <div class="channel">
            <span class="ch-label">A</span>
            <input type="number" min="0" max="100" step="1" class="num-small"
              value={Math.round(a*100)}
              on:change={commitAlpha} />
          </div>
        {/if}
      </div>

    {:else}
      <div class="channel-row">
        <div class="channel">
          <span class="ch-label">H</span>
          <input type="number" min="0" max="360" step="1" class="num-small" value={_hsl.h}
            on:change={e => _numInput(e, setHslH)} />
        </div>
        <div class="channel">
          <span class="ch-label">S</span>
          <input type="number" min="0" max="100" step="1" class="num-small" value={_hsl.s}
            on:change={e => _numInput(e, setHslS)} />
        </div>
        <div class="channel">
          <span class="ch-label">L</span>
          <input type="number" min="0" max="100" step="1" class="num-small" value={_hsl.l}
            on:change={e => _numInput(e, setHslL)} />
        </div>
        {#if showAlpha}
          <div class="channel">
            <span class="ch-label">A</span>
            <input type="number" min="0" max="100" step="1" class="num-small"
              value={Math.round(a*100)}
              on:change={commitAlpha} />
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .cp-wrap {
    display: flex;
    flex-direction: column;
    gap: 8px;
    user-select: none;
  }

  /* ── SV panel ─────────────────────────────────────────────── */
  .sv-panel {
    position: relative;
    width: 100%;
    height: 140px;
    border-radius: 5px;
    cursor: crosshair;
    touch-action: none;
    background:
      linear-gradient(to bottom, transparent 0%, #000 100%),
      linear-gradient(to right, #fff 0%, hsl(var(--cp-hue), 100%, 50%) 100%);
    box-shadow: inset 0 0 0 1px rgba(0,0,0,0.12);
    flex-shrink: 0;
  }

  .sv-thumb {
    position: absolute;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2.5px solid #fff;
    box-shadow: 0 0 0 1.5px rgba(0,0,0,0.35), 0 1px 4px rgba(0,0,0,0.3);
    transform: translate(-50%, -50%);
    pointer-events: none;
  }

  /* ── Swatch + sliders row ─────────────────────────────────── */
  .slider-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .swatch {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 1px solid var(--border-color);
    flex-shrink: 0;
    background-image:
      var(--swatch-bg, none),
      repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%);
    background-size: auto, 8px 8px;
    background-position: auto, 0 0;
  }

  .sliders {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  /* ── Custom slider track ──────────────────────────────────── */
  .cp-slider {
    position: relative;
    height: 10px;
    border-radius: 5px;
    cursor: pointer;
    touch-action: none;
    box-shadow: inset 0 0 0 1px rgba(0,0,0,0.12);
  }

  .hue-track {
    background: linear-gradient(to right,
      #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%);
  }

  .alpha-track {
    background:
      var(--alpha-grad),
      repeating-conic-gradient(#bbb 0% 25%, #fff 0% 50%) 0 0 / 8px 8px;
  }

  .cp-thumb {
    position: absolute;
    top: 50%;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #fff;
    border: 1px solid rgba(0,0,0,0.25);
    box-shadow: 0 1px 4px rgba(0,0,0,0.25);
    transform: translate(-50%, -50%);
    pointer-events: none;
  }

  /* ── Mode tabs ────────────────────────────────────────────── */
  .mode-tabs {
    display: flex;
    gap: 2px;
  }

  .mode-tab {
    flex: 1;
    height: 22px;
    background: transparent;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    color: var(--text-color);
    opacity: 0.55;
    cursor: pointer;
    transition: background 0.1s, opacity 0.1s;
  }
  .mode-tab:hover  { background: var(--ruler-bg); opacity: 0.8; }
  .mode-tab.active { background: var(--tool-active); border-color: var(--tool-border-active); opacity: 1; }

  /* ── Numeric inputs ───────────────────────────────────────── */
  .inputs {
    display: flex;
    gap: 5px;
    align-items: center;
  }

  .hex-input {
    flex: 1;
    height: 28px;
    padding: 0 7px;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    background: var(--bg-color);
    color: var(--text-color);
    font-size: 0.82rem;
    font-family: monospace;
    letter-spacing: 0.04em;
    min-width: 0;
  }
  .hex-input:focus { outline: none; border-color: var(--accent-color); }

  .alpha-num-wrap {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  .channel-row {
    display: flex;
    gap: 4px;
    flex: 1;
  }

  .channel {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    flex: 1;
    min-width: 0;
  }

  .ch-label {
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    color: var(--text-color);
    opacity: 0.5;
    text-transform: uppercase;
  }

  .num-small {
    width: 100%;
    height: 26px;
    padding: 0 3px;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    background: var(--bg-color);
    color: var(--text-color);
    font-size: 0.78rem;
    font-family: monospace;
    text-align: center;
    box-sizing: border-box;
  }
  .num-small:focus { outline: none; border-color: var(--accent-color); }

  .unit {
    font-size: 0.72rem;
    opacity: 0.5;
    color: var(--text-color);
  }
</style>