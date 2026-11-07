<script lang="ts">
  /**
   * @file File → Export options…
   * Settings are saved as they change (utils/exportSettings.ts); File → "Export as …" uses them.
   * Radio groups are drawn like the checkboxes (a ticked square).
   */
  import { onDestroy } from 'svelte';
  import { exportDialogOpen, exportSettings } from '../utils/exportSettings';
  import { documentStore } from '../stores/document';
  import { exportArea } from '../utils/exportArea';
  import { exportSize } from '../utils/exportDoc';
  import SliderInput from './SliderInput.svelte';
  import Modal from './Modal.svelte';

  $: gen = $exportSettings.general;
  $: svg = $exportSettings.svg;
  $: ras = $exportSettings.raster;
  $: doc = $documentStore;

  // What the raster export would produce, live.
  $: rasterInfo = (() => {
    try {
      const a = exportArea(doc, gen.area, gen.padding);
      const s = exportSize(a.width, a.height, ras.size === 'auto' ? { minWidth: 4000 } : ras.size === 'scale' ? { scale: ras.scale } : { width: ras.width });
      return { text: `${s.width} × ${s.height} px${s.limited ? ' (limited by the browser)' : ''}`, bad: s.limited };
    } catch (e) { return { text: (e as Error).message, bad: true }; }
  })();

  const num = (e: Event) => parseFloat((e.target as HTMLInputElement).value);
  onDestroy(() => { $exportDialogOpen = false; });
</script>

<Modal open={$exportDialogOpen} title="Export Options" onClose={() => { $exportDialogOpen = false; }}>
  <section>
    <h3>General</h3>
    <div class="group">
      <div class="label">Area</div>
      <label class="opt"><input type="radio" name="area" checked={gen.area === 'canvas'} on:change={() => exportSettings.patchGeneral({ area: 'canvas' })} /><span class="box"></span>Canvas (page)</label>
      <label class="opt"><input type="radio" name="area" checked={gen.area === 'content'} on:change={() => exportSettings.patchGeneral({ area: 'content' })} /><span class="box"></span>Fit around objects</label>
      <label class="pad" class:off={gen.area !== 'content'}>Padding
        <input type="number" min="0" max="1000" step="1" value={gen.padding} disabled={gen.area !== 'content'}
          on:input={e => { const v = num(e); if (v >= 0) exportSettings.patchGeneral({ padding: v }); }} /> px
      </label>
    </div>
    <label class="opt"><input type="checkbox" checked={gen.background} on:change={e => exportSettings.patchGeneral({ background: e.currentTarget.checked })} /><span class="box"></span>Include canvas background</label>
  </section>

  <section>
    <h3>SVG</h3>
    <label class="opt"><input type="checkbox" checked={svg.scalable} on:change={e => exportSettings.patchSvg({ scalable: e.currentTarget.checked })} /><span class="box"></span>ViewBox only <small>(no width / height)</small></label>

    <h4>Text &amp; fonts</h4>
    <label class="opt global"><input type="checkbox" checked={svg.textToPaths} on:change={e => exportSettings.patchSvg({ textToPaths: e.currentTarget.checked })} /><span class="box"></span>Convert all text to paths <small>(no fonts needed)</small></label>

    <div class="cols" class:dim={svg.textToPaths} aria-disabled={svg.textToPaths}>
      <div class="col">
        <div class="col-title">Google Fonts</div>
        <div class="label">Include fonts as</div>
        <label class="opt"><input type="radio" name="g-inc" disabled={svg.textToPaths} checked={svg.google.include === 'embedded'} on:change={() => exportSettings.patchSvg({ google: { ...svg.google, include: 'embedded' } })} /><span class="box"></span>Embedded</label>
        <label class="opt"><input type="radio" name="g-inc" disabled={svg.textToPaths} checked={svg.google.include === 'linked'} on:change={() => exportSettings.patchSvg({ google: { ...svg.google, include: 'linked' } })} /><span class="box"></span>Linked</label>
        <div class="label">Character coverage</div>
        <label class="opt"><input type="radio" name="g-cov" disabled={svg.textToPaths} checked={svg.google.coverage === 'used'} on:change={() => exportSettings.patchSvg({ google: { ...svg.google, coverage: 'used' } })} /><span class="box"></span>Used glyphs only</label>
        <label class="opt"><input type="radio" name="g-cov" disabled={svg.textToPaths} checked={svg.google.coverage === 'full'} on:change={() => exportSettings.patchSvg({ google: { ...svg.google, coverage: 'full' } })} /><span class="box"></span>Full subset</label>
      </div>
      <div class="col">
        <div class="col-title">Local Fonts</div>
        <div class="label">Include fonts as</div>
        <label class="opt"><input type="radio" name="s-inc" disabled={svg.textToPaths} checked={svg.local.include === 'reference'} on:change={() => exportSettings.patchSvg({ local: { include: 'reference' } })} /><span class="box"></span>Reference</label>
        <label class="opt"><input type="radio" name="s-inc" disabled={svg.textToPaths} checked={svg.local.include === 'embedded'} on:change={() => exportSettings.patchSvg({ local: { include: 'embedded' } })} /><span class="box"></span>Embedded</label>
        <p class="note">Reference needs the font installed where the SVG is opened. Embedded includes the whole file: check its licence.</p>
      </div>
    </div>
    <p class="note">Linked fonts only work when the SVG is viewed as a page, not as an image.</p>
  </section>

  <section>
    <h3>Raster <small>PNG · JPG · WebP</small></h3>

    <div class="group">
      <div class="label">Size</div>
      <label class="opt"><input type="radio" name="r-size" checked={ras.size === 'auto'} on:change={() => exportSettings.patchRaster({ size: 'auto' })} /><span class="box"></span>At least 4000 px wide</label>
      <label class="opt"><input type="radio" name="r-size" checked={ras.size === 'scale'} on:change={() => exportSettings.patchRaster({ size: 'scale' })} /><span class="box"></span>Scale
        <input class="inline" type="number" min="0.1" max="16" step="0.5" value={ras.scale} disabled={ras.size !== 'scale'}
          on:input={e => { const v = num(e); if (v > 0) exportSettings.patchRaster({ scale: v }); }} /> ×</label>
      <label class="opt"><input type="radio" name="r-size" checked={ras.size === 'width'} on:change={() => exportSettings.patchRaster({ size: 'width' })} /><span class="box"></span>Width
        <input class="inline wide" type="number" min="1" max="16384" step="1" value={ras.width} disabled={ras.size !== 'width'}
          on:input={e => { const v = num(e); if (v >= 1) exportSettings.patchRaster({ width: v }); }} /> px</label>
      <div class="result" class:bad={rasterInfo.bad}>→ {rasterInfo.text}</div>
    </div>

    <h4>Quality <small>JPG · WebP</small></h4>
    <SliderInput value={ras.quality} min={1} max={100} step={1} unit="%" onChange={v => exportSettings.patchRaster({ quality: v })} />
  </section>

  <footer class="foot">
    <span>Saved automatically · export from <b>File → Export as …</b></span>
    <button class="link" on:click={() => exportSettings.reset()}>Reset to defaults</button>
  </footer>
</Modal>

<style>
  section { padding: 12px 0 6px; }
  section + section { border-top: 1px solid var(--border-color); }
  h3 { margin: 0 0 10px; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.75; }
  h3 small, h4 small { text-transform: none; letter-spacing: 0; opacity: 0.6; font-weight: 400; margin-left: 4px; }
  h4 { margin: 14px 0 6px; font-size: 0.8rem; font-weight: 600; }
  .group { margin-bottom: 10px; }
  .label { font-size: 0.72rem; opacity: 0.6; margin: 6px 0 3px; }

  .opt { display: flex; align-items: center; gap: 8px; min-height: 26px; font-size: 0.83rem; cursor: pointer; }
  .opt small, h3 small { opacity: 0.6; font-size: 0.72rem; }
  .opt input[type='radio'], .opt input[type='checkbox'] { position: absolute; opacity: 0; width: 0; height: 0; }
  .box {
    width: 16px; height: 16px; flex-shrink: 0; border: 1.5px solid var(--text-color); border-radius: 3px; opacity: 0.55;
    display: inline-flex; align-items: center; justify-content: center; background: var(--bg-color);
  }
  .opt:hover .box { opacity: 0.9; }
  input:checked + .box { background: var(--accent-color); border-color: var(--accent-color); opacity: 1; }
  input:checked + .box::after { content: '✓'; color: #fff; font-size: 0.7rem; line-height: 1; font-weight: 700; }
  input:focus-visible + .box { outline: 2px solid var(--accent-color); outline-offset: 2px; }
  input:disabled + .box { opacity: 0.25; }
  .opt:has(input:disabled) { cursor: not-allowed; opacity: 0.6; }

  .pad { display: flex; align-items: center; gap: 6px; font-size: 0.8rem; margin: 2px 0 0 24px; }
  .pad.off { opacity: 0.4; }
  .pad input, .inline {
    width: 64px; height: 24px; padding: 0 5px; border: 1px solid var(--border-color); border-radius: 4px;
    background: var(--bg-color); color: var(--text-color); font-family: monospace; font-size: 0.8rem; text-align: center;
  }
  .inline { width: 52px; } .inline.wide { width: 68px; }
  .pad input:focus, .inline:focus { outline: none; border-color: var(--accent-color); }
  .inline:disabled, .pad input:disabled { opacity: 0.45; }

  .result { margin: 4px 0 0 24px; font-size: 0.78rem; font-family: monospace; opacity: 0.8; }
  .result.bad { color: #e67e22; opacity: 1; }

  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 8px; }
  .cols.dim { opacity: 0.45; }
  .col { min-width: 0; }
  .col-title { font-size: 0.78rem; font-weight: 600; padding-bottom: 4px; border-bottom: 1px solid var(--border-color); margin-bottom: 2px; }
  .note { font-size: 0.72rem; line-height: 1.35; opacity: 0.65; margin: 6px 0 0; }

  .foot { display: flex; justify-content: space-between; gap: 8px; align-items: center; padding-top: 12px; border-top: 1px solid var(--border-color); font-size: 0.72rem; opacity: 0.8; }
  .link { background: none; border: none; padding: 0; color: var(--accent-color); text-decoration: underline; cursor: pointer; font-size: inherit; white-space: nowrap; }

  @media (max-width: 420px) { .cols { grid-template-columns: 1fr; } }
</style>
