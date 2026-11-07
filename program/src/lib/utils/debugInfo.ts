/**
 * @file Help → "Copy debug info": everything needed to reproduce a problem in one paste (browser, window, editor state,
 * the last history entries, recent errors and the document). The error buffer starts when this module is first
 * imported, so errors from before the user asks are captured too.
 */

import { findShape, countShapes, maxDepth } from './tree';
import { get } from 'svelte/store';
import { documentStore, historyPast, historyFuture, historyNow } from '../stores/document';
import { ui } from '../stores/ui';
import { viewport } from '../stores/viewport';
import { serializeProject, PROJECT_FORMAT } from './project';
import { downloadText } from './files';
import type { DocumentState } from './types';

// ── recent error buffer ──────────────────────────────────────────────────────

export interface LoggedError { time: string; kind: string; message: string; }
const MAX_ERRORS = 20;
const errors: LoggedError[] = [];

function record(kind: string, ...args: unknown[]) {
  const message = args.map(a => {
    if (a instanceof Error) return a.stack ?? `${a.name}: ${a.message}`;
    if (typeof a === 'string') return a;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(' ').slice(0, 1500);
  errors.push({ time: new Date().toISOString(), kind, message });
  if (errors.length > MAX_ERRORS) errors.shift();
}

let installed = false;
export function installErrorCapture() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', e => record('error', e.error ?? e.message));
  window.addEventListener('unhandledrejection', e => record('unhandledrejection', e.reason));
  const orig = console.error.bind(console);
  console.error = (...args: unknown[]) => { record('console.error', ...args); orig(...args); };
}
installErrorCapture();

export const recentErrors = (): readonly LoggedError[] => errors;
export function clearRecentErrors() { errors.length = 0; }

// ── report ───────────────────────────────────────────────────────────────────

const HISTORY_LINES = 15;

/** The document with a (possibly huge) background image replaced by a size note. */
function docForReport(doc: DocumentState): { doc: DocumentState; note: string } {
  if (!doc.bgImage) return { doc, note: '' };
  return { doc: { ...doc, bgImage: '' }, note: `(background image omitted: ${doc.bgImage.length} characters)` };
}

export function buildDebugReport(): string {
  const doc = documentStore.get();
  const past = get(historyPast);
  const future = get(historyFuture);
  const u = ui.get();
  const selected = u.selectedIds.map(id => { const s = findShape(doc.shapes, id); return s ? `${s.type}:${s.id}` : `missing:${id}`; });

  const hasWin = typeof window !== 'undefined';
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const env = {
    time: new Date().toISOString(),
    userAgent: nav?.userAgent ?? 'n/a',
    platform: nav?.platform ?? 'n/a',
    language: nav?.language ?? 'n/a',
    window: hasWin ? `${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio}x` : 'n/a',
    theme: typeof document !== 'undefined' ? document.documentElement.getAttribute('data-theme') ?? 'n/a' : 'n/a',
    url: hasWin ? window.location.href : 'n/a',
  };
  const editorState = {
    tool: u.tool,
    zoom: viewport.get().zoom,
    scroll: [viewport.get().scrollLeft, viewport.get().scrollTop],
    selection: selected,
    enteredGroups: u.groupPath,
    grid: u.gridEnabled, snap: u.snapEnabled, gridSize: [u.gridSizeX, u.gridSizeY],
    canvas: `${doc.width}x${doc.height}, background=${doc.background}`,
    shapes: `${countShapes(doc.shapes)} (${doc.shapes.length} top level, depth ${maxDepth(doc.shapes)})`,
  };
  const history = [
    ...past.slice(-HISTORY_LINES).map(e => `  ${e.label}`),
    `> ${get(historyNow)}   (current)`,
    ...future.slice(0, 3).map(e => `  ${e.label}   (redo)`),
  ];
  const { doc: shown, note } = docForReport(doc);

  return [
    '=== SVG Editor debug info ===',
    '',
    '--- Environment ---',
    JSON.stringify(env, null, 2),
    '',
    '--- Editor state ---',
    JSON.stringify(editorState, null, 2),
    '',
    `--- History (last ${Math.min(past.length, HISTORY_LINES)} of ${past.length} past, ${future.length} redo) ---`,
    ...history,
    '',
    `--- Recent errors (${errors.length}) ---`,
    errors.length ? errors.map(e => `[${e.time}] ${e.kind}: ${e.message}`).join('\n') : '(none)',
    '',
    `--- Document (${PROJECT_FORMAT}; save this as a .svgedit.json to reload it) ${note}---`,
    serializeProject(shown),
    '',
  ].join('\n');
}

/** Legacy fallback for contexts where navigator.clipboard is missing or denied. */
function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined') return false;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

export type CopyMethod = 'clipboard' | 'legacy' | 'download';

/** Copies the report; if the browser refuses, downloads it as a text file instead. */
export async function copyDebugInfo(): Promise<CopyMethod> {
  const text = buildDebugReport();
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return 'clipboard';
    }
  } catch { /* permission denied or insecure context → fall through */ }
  if (legacyCopy(text)) return 'legacy';
  downloadText(text, 'svg-editor-debug.txt', 'text/plain');
  return 'download';
}
