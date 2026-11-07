/**
 * @file What the File menu does. Every function either succeeds or throws an Error whose message can be shown as it
 * is; a cancelled file dialog resolves to null. Asking about unsaved changes is the caller's job.
 */

import { documentStore, emptyDocument } from '../stores/document';
import { editor } from '../stores/editor';
import { buildSvgFromSettings, renderRaster } from './exportDoc';
import { exportSettings, svgSettingsOf, rasterSettingsOf } from './exportSettings';
import { importSvg } from './svgImport';
import { makeImage } from './shapes';
import { IMAGE_ACCEPT, isImageFile, loadImageFile, placeImage } from './imageImport';
import { downloadBlob, downloadText, pickFile, readText } from './files';
import {
  serializeProject, parseProject, markSaved, clearAutosave, loadAutosave, dirty, PROJECT_EXTENSION,
} from './project';

export { dirty };

export function newProject() {
  editor.newDocument();
  markSaved();
  clearAutosave();
}

/** Restores the autosaved document, if any. Call once at start-up, before startAutosave(). */
export function restoreAutosave(): boolean {
  const doc = loadAutosave();
  if (!doc || (!doc.shapes.length && !doc.bgImage)) return false;
  editor.loadDocument(doc, 'Restore autosave');
  markSaved(documentStore.get());
  return true;
}

export function saveProject(name = 'drawing') {
  downloadText(serializeProject(documentStore.get()), name + PROJECT_EXTENSION, 'application/json');
  markSaved();
}

/** Opens a project file (.json) or an SVG as a new document. Returns warnings, or null if cancelled. */
export async function openFile(): Promise<{ warnings: string[] } | null> {
  const file = await pickFile(`${PROJECT_EXTENSION},.json,.svg,image/svg+xml`);
  if (!file) return null;
  const text = await readText(file);
  if (text.trimStart().startsWith('{')) {
    editor.loadDocument(parseProject(text));
    markSaved();
    return { warnings: [] };
  }
  const r = importSvg(text);
  editor.loadDocument({ ...emptyDocument(), shapes: r.shapes, width: r.width ?? 800, height: r.height ?? 600 }, 'Open SVG');
  markSaved();
  return { warnings: r.warnings };
}

/**
 * Adds a file to the current drawing as ONE undo step: an SVG as editable shapes, a bitmap as an image shape.
 * `at` = where to centre a bitmap (document units; default: the page centre).
 */
export async function importFile(file: File, at?: { x: number; y: number }, label?: string): Promise<{ count: number; warnings: string[] }> {
  editor.leaveGroups();                       // imported shapes always land on the top level
  if (isImageFile(file)) {
    const img = await loadImageFile(file);
    const box = placeImage(img.width, img.height, documentStore.get(), at);
    editor.addShapes([makeImage(box.x, box.y, box.width, box.height, img.href, file.name.replace(/\.[^.]+$/, ''))], label ?? `Import ${file.name}`);
    return { count: 1, warnings: [] };
  }
  const r = importSvg(await readText(file));
  if (!r.shapes.length) throw new Error('No supported shapes were found in this SVG.');
  editor.addShapes(r.shapes, label ?? `Import ${file.name}`);
  return { count: r.shapes.length, warnings: r.warnings };
}

/** File → Import…: an SVG or a bitmap. Null if cancelled. */
export async function importFromPicker(): Promise<{ count: number; warnings: string[] } | null> {
  const file = await pickFile(`.svg,image/svg+xml,${IMAGE_ACCEPT}`);
  return file ? importFile(file) : null;
}

/** SVG file with the saved export settings (File → Export options…). Resolves to warnings to show. */
export async function exportSvg(name = 'drawing'): Promise<string[]> {
  const { svg, warnings } = await buildSvgFromSettings(documentStore.get(), svgSettingsOf(exportSettings.get()));
  downloadText(svg, name + '.svg', 'image/svg+xml');
  return warnings;
}

export type RasterExt = 'png' | 'jpg' | 'webp';
/** Raster image with the saved export settings. Resolves to the pixel size and any warnings. */
export async function exportRasterFile(fmt: RasterExt, name = 'drawing') {
  const r = await renderRaster(documentStore.get(), fmt === 'jpg' ? 'jpeg' : fmt, rasterSettingsOf(exportSettings.get()));
  downloadBlob(r.blob, `${name}.${fmt}`);
  return { width: r.size.width, height: r.size.height, warnings: r.warnings };
}
