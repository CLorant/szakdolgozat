/**
 * @file Keeps the editor's fonts in step with the document (and with the font chosen for new text).
 */
import { documentStore } from '../stores/document';
import { ui } from '../stores/ui';
import { ensureEditorFont, syncEditorFonts } from './editorFonts';

/** Call once at start-up; returns the stop function. */
export function startFontSync(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (fn: () => void) => { clearTimeout(timer); timer = setTimeout(fn, 150); };    // dragging changes the doc ~60×/s

  const stopDoc = documentStore.subscribe(doc => schedule(() => syncEditorFonts(doc.shapes)));
  const stopUi = ui.subscribe(u => {
    const p = u.textProps;
    void ensureEditorFont(p.fontFamily, p.fontWeight, p.fontStyle);
  });
  return () => { clearTimeout(timer); stopDoc(); stopUi(); };
}
