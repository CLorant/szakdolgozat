/**
 * @file Pasting and copying through the system clipboard: the window's copy / cut / paste events (App.svelte wires
 * them) and the menus. Which source wins when several are available: see pasteContent.
 */
import { editor } from '../stores/editor';
import { MARKER, looksLikeSvg } from './clipboard';
import { isImageFile } from './imageImport';
import { importFile } from './fileActions';
import { notify, notifyError } from '../stores/notify';
import { clientToDoc } from './guides';
import type { Point } from './types';

/**
 * Pastes clipboard TEXT. Text tagged by this editor → the stored shapes (full fidelity, also from another tab);
 * other SVG text → imported; empty → the editor's own last copy. Anything else (ordinary text) is left alone.
 * Returns true when something was handled.
 */
export function pasteClipboardText(text: string): boolean {
  if (!text.trim()) return editor.paste();
  if (MARKER.test(text)) return editor.paste() || editor.pasteSvg(text);
  if (looksLikeSvg(text)) return editor.pasteSvg(text);
  return false;
}

/** What the system clipboard offers, read from a paste event or from navigator.clipboard. */
export interface ClipContent { text: string; svg: string; image: File | null; }

/**
 * One order for every way of pasting (Ctrl V, Edit → Paste, the context menu):
 *   1. our own copy (tagged SVG text): the stored shapes, exactly;
 *   2. SVG from another program (vector, so it stays editable; Inkscape also puts a PNG next to it);
 *   3. a picture (a screenshot, an image copied from a web page or a photo app): an image shape;
 *   4. nothing usable on the system clipboard: the editor's own last copy.
 * The system clipboard comes first because every copy in this editor writes to it too: whatever is there is never
 * older than the editor's own copy. `at` = centre of the result (context menu: where it was opened).
 */
export async function pasteContent(c: ClipContent, at?: Point): Promise<boolean> {
  const svgText = looksLikeSvg(c.text) ? c.text : looksLikeSvg(c.svg) ? c.svg : '';
  const shapes = (fn: () => boolean) => at ? editor.pasteAt(at, fn) : Promise.resolve(fn());
  if (svgText) return shapes(() => pasteClipboardText(svgText));
  if (c.image) {
    const f = c.image;
    const named = f.name && f.name !== 'image.png' ? f : new File([f], `Pasted image.${f.type.split('/')[1] || 'png'}`, { type: f.type });
    await importFile(named, at, 'Paste image');
    return true;
  }
  if (c.text.trim()) return false;                                  // ordinary text: not ours to paste
  return shapes(() => editor.paste());
}

const editable = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

/** copy / cut event: the selection goes to the system clipboard as SVG text. Text fields keep their normal behaviour. */
export function onCopyEvent(e: ClipboardEvent, cut: boolean) {
  if (editable(e.target)) return;
  const text = cut ? editor.cut() : editor.copy();
  if (text === null || !e.clipboardData) return;
  e.clipboardData.setData('text/plain', text);
  e.preventDefault();
}

export function onPasteEvent(e: ClipboardEvent) {
  if (editable(e.target)) return;
  const d = e.clipboardData;
  const c: ClipContent = {
    text: d?.getData('text/plain') ?? '',
    svg: d?.getData('image/svg+xml') ?? '',
    image: [...(d?.files ?? [])].find(isImageFile) ?? null,
  };
  if (!c.text.trim() || looksLikeSvg(c.text) || c.svg || c.image) e.preventDefault();   // leave ordinary text alone
  pasteContent(c).catch(notifyError);
}

/**
 * Menu / context menu → Paste: reads the system clipboard where the browser allows it (Chrome asks once; Firefox and
 * Safari show a small "Paste" button), else falls back to the editor's own last copy.
 */
export async function pasteFromMenu(at?: Point) {
  const c: ClipContent = { text: '', svg: '', image: null };
  try {
    if (navigator.clipboard?.read) {
      for (const item of await navigator.clipboard.read()) {
        for (const type of item.types) {
          if (type === 'text/plain' && !c.text) c.text = await (await item.getType(type)).text();
          else if (type === 'image/svg+xml' && !c.svg) c.svg = await (await item.getType(type)).text();
          else if (type.startsWith('image/') && !c.image) {
            const blob = await item.getType(type);
            c.image = new File([blob], `Pasted image.${type.split('/')[1]}`, { type });
          }
        }
      }
    } else c.text = await navigator.clipboard.readText();
  } catch { /* denied or unsupported: the editor's own copy */ }
  if (!(await pasteContent(c, at))) notify('The clipboard holds text, not a drawing or a picture.', 'warn');
}

/** Menu → Copy / Cut: through the browser's copy command so the system clipboard is filled; plain copy if it refuses. */
export function copyFromMenu(cut = false) {
  let done = false;
  try { done = document.execCommand(cut ? 'cut' : 'copy'); } catch { /* not allowed */ }
  if (!done) { if (cut) editor.cut(); else editor.copy(); }
}

/** Files dropped on the drawing area: SVGs become shapes, bitmaps image shapes centred where they were dropped. */
export async function onDropFiles(e: DragEvent) {
  const files = [...(e.dataTransfer?.files ?? [])];
  if (!files.length) return;
  e.preventDefault();
  const at = clientToDoc(e.clientX, e.clientY) ?? undefined;
  const warnings: string[] = [];
  for (const f of files) {
    if (!isImageFile(f) && !/svg/i.test(f.type) && !/\.svg$/i.test(f.name)) { warnings.push(`${f.name} is not an SVG or an image.`); continue; }
    try { warnings.push(...(await importFile(f, at)).warnings); } catch (err) { notifyError(err); }
  }
  if (warnings.length) notify(warnings.join('\n'), 'warn', 9000);
}
