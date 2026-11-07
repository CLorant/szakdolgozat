<script lang="ts">
  /**
   * @file Help → keyboard shortcuts, mouse controls and the non-obvious things worth knowing.
   * The tool keys come from tools/catalog.ts, so this list cannot drift from the toolbar.
   */
  import Modal from './Modal.svelte';
  import { helpDialogOpen } from '../stores/dialogs';
  import { TOOLS } from '../tools/catalog';
  import { copyDebugInfo } from '../utils/debugInfo';

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const mod = isMac ? '⌘' : 'Ctrl';

  const EDITING: Array<[string, string]> = [
    [`${mod} Z`, 'Undo'], [`${mod} Y`, 'Redo'],
    [`${mod} C / X / V`, 'Copy, cut, paste (also between tabs and other apps)'],
    [`${mod} D`, 'Duplicate'], [`${mod} A`, 'Select all'],
    [`${mod} G`, 'Group'], [`${mod} Shift G`, 'Ungroup'],
    ['] / [', 'Bring forward / send backward'], [`${mod} ] / [`, 'Bring to front / send to back'],
    ['Arrows', 'Nudge 1 px (Shift: 10 px); the picked nodes in the Edit tool'], ['Del', 'Delete the selection, or the picked nodes'],
    ['Right-click', 'Menu for what is under the pointer (touch: hold a finger still)'],
    ['Esc', 'Cancel a drag, finish drawing, leave a group'], [`${mod} S`, 'Save project'],
  ];
  const VIEW: Array<[string, string]> = [
    ['Wheel', 'Pan up and down (Shift: left and right)'], [`${mod} wheel`, 'Zoom at the pointer'],
    ['Space drag', 'Pan'], ['Middle drag', 'Pan (also beside the page)'], ['Two fingers', 'Pinch to zoom, drag to pan'],
    [`${mod} + / −`, 'Zoom in / out'], [`${mod} 0`, 'Zoom 100%'],
  ];
  const DRAWING: Array<[string, string]> = [
    ['Shift', 'Squares, circles, 45° lines, proportional resize, add to selection'],
    ['Alt', 'Draw rectangles and ellipses from the centre'],
    [mod, 'Hold while dragging to turn snapping off'],
    ['Double-click', 'Edit text, enter a group, or edit the nodes of a shape'],
    ['Edit tool', 'Shift-click or drag a rectangle to pick several nodes; they move together'],
    ['B / A', 'While drawing a path: go on with the Pen / with arcs'],
    ['End of a path', 'With the path selected, start the Pen, Arc or Freehand on its end to continue it'],
  ];

  let debugNote = '';
  async function copyDebug() {
    const how = await copyDebugInfo();
    debugNote = how === 'download' ? 'Saved as svg-editor-debug.txt.' : 'Copied to the clipboard.';
  }
</script>

<Modal open={$helpDialogOpen} title="Help" width={700} onClose={() => { $helpDialogOpen = false; debugNote = ''; }}>
  <div class="grid">
    <section>
      <h3>Tools</h3>
      <dl>
        {#each TOOLS as t}<dt><kbd>{t.shortcut}</kbd></dt><dd>{t.label}</dd>{/each}
      </dl>
    </section>
    <section>
      <h3>Editing</h3>
      <dl>{#each EDITING as [k, v]}<dt><kbd>{k}</kbd></dt><dd>{v}</dd>{/each}</dl>
    </section>
    <section>
      <h3>View</h3>
      <dl>{#each VIEW as [k, v]}<dt><kbd>{k}</kbd></dt><dd>{v}</dd>{/each}</dl>
    </section>
    <section>
      <h3>While drawing</h3>
      <dl>{#each DRAWING as [k, v]}<dt><kbd>{k}</kbd></dt><dd>{v}</dd>{/each}</dl>
    </section>
  </div>
  <section class="tips">
    <h3>Good to know</h3>
    <ul>
      <li>Your work is saved in this browser as you go. Use <b>File → Save project</b> to keep a file.</li>
      <li>Drag from a ruler to place a guide; drag it back onto the ruler to remove it.</li>
      <li>In the Objects panel, drag a row to reorder (touch: hold it first). The padlock makes a shape unclickable on the canvas, handy for backgrounds.</li>
      <li>Click the color swatch next to the sliders for the recent colors and the colors already in the drawing.</li>
      <li>Text converts to paths exactly as drawn, so the file looks the same without the fonts.</li>
    </ul>
  </section>
  <footer class="foot">
    <span>Reporting a problem? Attach the debug info.</span>
    <span>{#if debugNote}<span class="done">{debugNote}</span>{/if}<button class="link" on:click={copyDebug}>Copy debug info</button></span>
  </footer>
</Modal>

<style>
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 22px; }
  section { padding: 12px 0 4px; }
  h3 { margin: 0 0 8px; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.75; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 5px 10px; margin: 0; font-size: 0.8rem; align-items: baseline; }
  dt { white-space: nowrap; }
  dd { margin: 0; opacity: 0.85; }
  kbd { background: var(--bg-color); border: 1px solid var(--border-color); border-radius: 3px; padding: 1px 5px; font-family: monospace; font-size: 0.74rem; }
  .tips { border-top: 1px solid var(--border-color); margin-top: 8px; }
  ul { margin: 0; padding-left: 18px; font-size: 0.8rem; line-height: 1.45; opacity: 0.85; }
  .foot { display: flex; justify-content: space-between; gap: 8px; align-items: center; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border-color); font-size: 0.72rem; opacity: 0.8; }
  .link { background: none; border: none; padding: 0; color: var(--accent-color); text-decoration: underline; cursor: pointer; font-size: inherit; white-space: nowrap; }
  .done { margin-right: 8px; opacity: 0.8; }
  @media (max-width: 520px) { .grid { grid-template-columns: 1fr; } }
</style>
