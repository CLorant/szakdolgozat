# Architecture

How the editor is put together. The reasons behind the larger choices are in [decisions.md](decisions.md).

## Overview

```
 src/
 ├─ main.ts, App.svelte        mount point and the application shell (menu, bars, canvas, panel, dialogs)
 ├─ app.css                    design tokens (light / dark), shared menu styles
 ├─ assets/fonts/              bundled fonts for the CSS generic families (OFL)
 └─ lib/
    ├─ utils/                  the model and pure functions: shapes, paths, SVG in / out, projects, export …
    ├─ stores/                 application state (Svelte stores) and the editing actions (editor.ts)
    ├─ tools/                  one module per tool: pointer events in, editor actions out
    ├─ fonts/                  font sources (Google, local, bundled), loading, outlining, embedding
    ├─ components/             reusable parts: renderer, overlays, pickers, dialogs, Objects list …
    └─ layouts/                the large regions: Canvas, Toolbar, CommandBar, Menu, PropertyPanel, PropertyBar
```

Data flows one way:

```
 pointer / keyboard ──▶ Canvas.svelte ──▶ tools/* ──▶ editor.* ──▶ documentStore (+ history)
                                                         │                │
 panels, menus, command bar ─────────────────────────────┘                ▼
                                                    components re-render from the stores
```

Components never change the document directly; they call `editor.*`. Tools never touch the DOM; they receive a
`PointerInfo` and call `editor.*` or write preview stores. That is what makes the tools and the actions testable
without a browser.

## The document model (`utils/types.ts`)

A `DocumentState` is plain, serialisable data: `shapes` (a tree), page `width` / `height`, the background (`white`,
`black`, two transparent checkerboards, a custom color, an optional image with its fit) and the ruler `guides`.

Shapes are a discriminated union on `type`:

| Type | Geometry |
|---|---|
| `rectangle` | x, y, width, height, rx, ry |
| `ellipse` | cx, cy, rx, ry |
| `line` | x1, y1, x2, y2 |
| `path` | `nodes` (anchor + optional in / out Bézier handles + smooth flag; `sub` starts a new contour), `closed`, `fillRule` |
| `text` | x, y (anchor), content (lines), font family / size / weight / style, decoration lines, anchor, spacing, line height, flips |
| `image` | x, y, width, height, `href` (a data: URL), flips |
| `group` | `children` |

Every shape also has an `id`, a `name`, `visible`, optional `locked`, `opacity`, the paint (`fill`, `stroke`,
`strokeWidth`, caps, joins, dash array and offset), `rotation` and an optional rotation `origin`.

- **Rotation** is stored in degrees about the centre of the shape's own (unrotated) box; this is what the SVG output
  writes as `rotate(deg cx cy)`. The `origin` is an editing aid only: rotating in the editor turns the shape about
  that point (`rotateShapeAbout`), which updates `rotation` and the position together.
- **Paint** is a string: `none`, `#rrggbb[aa]`, or a gradient encoded as `lg:<angle>;<color>@<offset>,…` /
  `rg:<cx>,<cy>,<r>;…` (`utils/gradient.ts`). Keeping paint a string keeps every style operation (copy, undo,
  compare, coalesce) the same for colors and gradients.
- **Groups** contain shapes in their own frame; a group's rotation and opacity apply to the whole. `utils/tree.ts`
  finds, replaces and moves shapes at any depth; the user "enters" groups (`ui.groupPath`) to edit inside them.

## State (`stores/`)

| Store | Holds |
|---|---|
| `document.ts` | The document and its history: `commit(label, fn, {coalesce})`, live previews for drags (`beginPreview` / `commitPreview` / `cancelPreview`), undo / redo / goTo, a cap of 200 steps |
| `editor.ts` | The **editing actions** — the only code that commits to the document: selection, add, update, style, group, align, flip, z-order, boolean operations, conversions, clipboard, lock … Derived stores `selectedShapes` and `currentLevel` |
| `ui.ts` | Everything that is not the document: tool, selection, entered groups, defaults for new shapes, panel state, grid and snapping. The preference subset is kept in localStorage |
| `viewport.ts` | Zoom, the view offset, the pointer position (rulers) |
| `interaction.ts` | Transient visuals: the preview shape, guide primitives a tool wants drawn, snap lines, the text editor session, picked nodes, the context menu |
| `notify.ts`, `dialogs.ts`, `colorMode.ts`, `recentColors.ts`, `media.ts` | Toasts; dialog flags; the color code; recent colors; narrow-screen and coarse-pointer media queries |

**History.** Every entry is the state *after* the action its label names, so clicking an entry in the History panel
lands exactly on that state. Continuous edits (dragging a color, a slider, typing a number) carry a `coalesce` key:
consecutive commits with the same key within a second become one entry. Drags use previews: nothing is recorded
until the drop, and a drop that changed nothing records nothing.

## Rendering and hit-testing

`layouts/Canvas.svelte` draws one `<svg>` whose `viewBox` is the page. `components/ShapeRenderer.svelte` renders
each shape as `<g data-shape-id="…">` with the same attributes the exported SVG gets, so the canvas is the export.

Hit-testing is left to the browser: the event target of a pointer event is the element under the pointer, and
`tools/hit.ts` reads the `data-shape-id`, `data-handle`, `data-node`, `data-rotate`, `data-pivot` attributes from it.
This is exact for curves, strokes, rotation and text without any geometry code. Thin or unfilled shapes get an
invisible wide stroke so they are easy to grab; locked shapes get `pointer-events: none`, so clicks go through them.

Overlays sit on top of the shapes in the frame of the entered group: `SelectionOverlay` (boxes, handles, knob,
rotation origin), `EditOverlay` (nodes and handles), the guides of `interaction.ts`, ruler guides, and the in-place
`TextEditor` (a `<foreignObject>` textarea).

The view has no scrollbars: `viewport.scrollLeft / scrollTop` is an offset applied as a CSS transform, so the view
can go anywhere (`utils/zoom.ts`). Presses on the area around the page are passed to the same handlers as presses on
the page.

## Tools (`tools/`)

```ts
interface Tool {
  down(i: PointerInfo): void;  move(i: PointerInfo): void;  up(i: PointerInfo): void;
  dblclick?(i): void;  key?(e): boolean;  escape(): boolean;  deactivate(): void;  busy(): boolean;
}
```

`PointerInfo` carries the point in document units (snapped and raw), the modifier keys and the event target. Canvas
converts DOM events into it (including the frame of an entered group and snapping), forwards keys, and finishes a
pending tool when the tool changes. `tools/catalog.ts` lists the tools with label, icon and shortcut for the toolbar
and the Help dialog.

| Module | Tool |
|---|---|
| `select.ts` | Select / move / resize / rotate, rubber band, rotation origin |
| `edit.ts` | Edit Nodes, including several picked nodes |
| `shapeTool.ts` | Rectangle, Ellipse, Line |
| `polygon.ts`, `pen.ts`, `arc.ts`, `freehand.ts` | Click-built paths, Bézier pen, chained circular arcs, smoothed freehand |
| `pathDraft.ts` | The path being drawn, shared by Pen and Arc (switching keeps the path), and continuing a selected open path from an end |
| `text.ts`, `blob.ts`, `scissors.ts`, `pan.ts` | Text placement, Blob, Scissors (knife, lasso, point cut), Hand |
| `snapContext.ts` | The snap targets for a drag (built once per gesture) |

## Geometry libraries

| Library | Used for | Why this one |
|---|---|---|
| paper.js (`paper-core`) | Boolean operations, knife and lasso cuts (`utils/boolean.ts`) | Computes on Bézier curves, so results stay curves. Loaded on first use |
| clipper-lib | Stroke to Path, Blob (`utils/strokeToPath.ts`, `utils/blob.ts`) | Robust polygon offsetting and union; the results are polygons by nature |
| fontkit | Text to path, font metadata (`fonts/sfnt.ts`) | Full OpenType shaping (kerning, ligatures, GPOS); loaded on first use |
| woff2-encoder | Decoding WOFF2 files for fontkit | — |

Everything else (path parsing, arcs, bounds, snapping, rulers, gradients, the SVG importer and serializer) is written
in the project.

## Files and storage

| What | Where | Module |
|---|---|---|
| Project file | `.svgedit.json`: `{ format: "svg-editor-project", version: 1, doc }` | `utils/project.ts` |
| Autosave | localStorage `svg-editor:autosave:v1`, debounced | `utils/project.ts` |
| Preferences | localStorage `svge.preferences.v1` (grid, snapping, panel sizes, aspect chain, brush, polygon mode) | `stores/ui.ts` |
| Export options | localStorage `svge.exportSettings.v1` | `utils/exportSettings.ts` |
| Clipboard between tabs | localStorage `svgeditor.clipboard` | `utils/clipboard.ts` |
| Color code, recent colors, theme | `svge.colorMode`, `svge.recentColors`, `theme` | `stores/colorMode.ts`, `stores/recentColors.ts`, `ThemeToggle.svelte` |
| Google font catalog cache | `svge.googleFontCatalog.v1` (7 days) | `fonts/catalog.ts` |

Loading is defensive: `parseProject` / `normalizeShape` validate every field, drop what is broken (a bad image, a
hostile nesting depth, an unknown type) and fill in defaults, so a damaged file cannot break the editor later.

**SVG out** (`utils/serializer.ts`): explicit attributes (never relying on SVG defaults, which differ from the
editor's), gradients in one `<defs>`, fonts per the export options. **Raster out** (`utils/exportDoc.ts`): the SVG is
drawn into a canvas with all text converted to paths (fonts in an SVG image are unreliable), at least 4000 px wide by
default. **SVG in** (`utils/svgImport.ts`): elements, transforms (a pure rotation stays a rotation, anything else is
baked), styles and inheritance, gradients, `<use>`, text; unsupported features produce warnings.

**Clipboard** (`utils/clipboard.ts`, `utils/clipboardActions.ts`): a copy writes the shapes to localStorage (for
other tabs, full fidelity) and SVG text tagged with a nonce to the system clipboard (for other programs). Pasting
prefers, in order: the editor's tagged SVG, other SVG, a picture, and the editor's own copy when the system clipboard
holds nothing usable.

## Fonts (`fonts/`)

Three sources, resolved by `sources.ts`: **Google Fonts** (catalog of family names, CSS2 API), **local fonts**
(Local Font Access API, Chromium) and the **generic families** (`sans-serif`, `serif`, `monospace`, `system-ui`,
`cursive`, `fantasy`), which the editor draws with bundled open fonts so that what is on screen matches the outlines.

| Task | How |
|---|---|
| Show a font on the canvas | `editorFonts.ts` loads the real faces through the FontFace API; `sync.ts` keeps them in step with the document |
| Preview rows in the picker | Only rows in view are requested, in batches, with `text=` (a few hundred bytes each) under alias names |
| Know the styles of a family | `styles.ts` (Fontsource metadata for Google families); the editor asks only for styles that exist |
| Text → path | `outlineFont.ts` gets one font file per style (`text=` with the used characters, or the local file), `textOutline.ts` lays out like the renderer; missing bold / italic are synthesized |
| Embed in SVG | `embed.ts`: base64 WOFF2 in `<style>`, only the used characters or whole script subsets |

A font that cannot be obtained is never replaced by a look-alike: the conversion is refused with a message.

## Layout and responsiveness

`App.svelte` is a flex layout: toolbar, canvas column (rulers + drawing area), property panel, tab strip. Below
640 px wide (`stores/media.ts`, CSS media queries) the workspace becomes a grid and the property panel a sheet under
the drawing. On coarse pointers handles and nodes get larger invisible grab areas, and a long press opens the
context menu or picks up an Objects row. Two fingers pinch-zoom and pan with any tool: Canvas holds a first touch
back for 90 ms, so a pinch never leaves a stray Pen node or selection change behind.

## Tests (`tests/`)

Vitest with jsdom. `*.dom.test.ts` mount real Svelte components; the rest test pure functions, stores and tools.
No test reaches the network: `tests/helpers/fakeGoogle.ts` stands in for Google Fonts and Fontsource (with the real
API's behaviour where it matters, such as an HTTP 400 for a missing style), using the font files in
`tests/fixtures/fonts`.

| Folder | Covers |
|---|---|
| `model/` | Shapes, paths, gradients, dashes, groups, history, stores, project files, preferences, lock, stroke to path, a random-action fuzz test |
| `tools/` | Select, drawing tools (incl. Arc), Edit Nodes, snapping, Scissors, booleans, Blob |
| `io/` | SVG import and output, export options and sizes, clipboard, images, debug info |
| `fonts/` | Google requests and parsing, local fonts, outlines, embedding, the picker, text model |
| `ui/` | The mounted app, canvas, panels, color picker, dialogs, view helpers, regressions from the bug report |
