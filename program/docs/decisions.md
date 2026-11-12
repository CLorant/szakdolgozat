# Design decisions

The choices that shaped the editor, why they were made, and what was considered instead. Each entry is short on
purpose; [architecture.md](architecture.md) describes how the result works.

## Platform and structure

**Svelte 5 + TypeScript, no UI framework, no server.** The editor is a single-page app that runs entirely in the
browser; files are read and written through the browser. Svelte's stores give a small, explicit state layer, and the
compiler keeps the runtime small. A component library was not used: an editor's controls (color picker, sliders,
handles, the Objects list) are specialised anyway, and a library would bring its own look and weight. *Rejected:*
React (more runtime and boilerplate for the same result), Bootstrap (an early version used it; it fought the dense
editor layout and was removed).

**One action layer (`editor.ts`) between the UI and the document.** Every change goes through a named action that
commits one history step. Panels, menus, the command bar, the context menu and the tools therefore behave the same
way and are tested once. *Rejected:* one large store that components changed directly (the editor's first version), which
made consistent undo steps hard and spread the same logic over several components.

**Tools as plain objects driven by `PointerInfo`.** A tool receives document coordinates, modifiers and the hit
target, and calls actions; it never touches the DOM. Tools can be unit-tested by feeding them synthetic events.

## Rendering

**The browser does the hit-testing.** Shapes are rendered with `data-*` attributes and the event target tells which
shape, handle or node is under the pointer. Hit-testing curves, thick strokes, rotated shapes and text exactly by
hand is a large amount of geometry; the browser already does it, and does it the same way it paints. Invisible wide
strokes make thin lines easy to grab.

**The canvas is the export.** The renderer writes the same attributes as the SVG serializer, so what is on screen is
what the file contains. Values are always written explicitly because SVG's defaults (miter joins, butt caps) differ
from the editor's defaults (round).

**No scrollbars; an endless view.** The view is an offset that can go anywhere, like in design tools. Scrollbars
limited panning to the page plus a margin, and shapes outside the page are allowed.

## Model

**Paint as a string, including gradients.** Colors and gradients go through the same code paths (style changes,
coalescing, undo, copy) because both are strings. *Rejected:* a separate gradient object model, which would have
needed a second path through every style operation.

**Rotation about the box centre; the rotation origin is an editing aid.** The stored rotation is always about the
centre of the shape's own box, which keeps resize, mirror, alignment and the SVG output simple and unambiguous. The
origin (Geometry → Origin, the crosshair) only decides where the shape turns while it is rotated in the editor,
like Inkscape's rotation centre. *Rejected:* a real `transform-origin` that changes the meaning of `rotation`: every
geometric operation (bounds, resize, mirror, group transforms, conversions, import) assumes the centre, so changing
it risked subtle errors throughout the code for no visible gain.

**Dash presets scale with the stroke width; typed patterns do not.** Dashed, Dotted and Dash-dot describe a look,
and that look only exists relative to the width: a dot must be as long as the line is thick, and a fixed "6 4"
becomes solid at width 12 because round caps fill the gaps. The presets are therefore regenerated when the width or
cap changes, with the caps compensated. A pattern the user types is stored in absolute pixels, exactly as SVG stores
it. CSS borders and Inkscape behave the same way.

## Geometry operations

**paper.js for boolean operations and cuts.** It computes unions, differences and intersections on the Bézier
curves themselves, so two united circles keep a handful of curved, editable nodes. *Rejected:* polygon-clipping and
clipper2-ts, which flatten every curve into hundreds of corner nodes. paper.js is larger (about 110 KB gzip) and is
loaded only when first needed.

**Cutting an area = intersection and difference with a region built from the knife.** A line has no area, so the
knife is extended past both ends and closed around one side; the two pieces are `shape ∩ region` and
`shape − region`. Both are closed shapes, so the stroke runs along the cut. A lasso is already a region.

**Scissors cut what the knife reaches, the selection only if it is reached.** Requiring a selection first (as some
editors do) made the second cut silently do nothing, because after a cut the pieces are selected.

**Clipper for Stroke to Path and the Blob.** Offsetting a stroke and merging painted areas are polygon operations
by nature, and Clipper is robust at them.

**An Arc tool (3-point arc), no Quadratic mode.** Circular arcs are a common need (rounded joints, parts of
circles) that is hard to draw precisely with the Pen. Three points (two ends, one on the arc) work the same with a
mouse and a finger. A separate Quadratic Bézier mode was not added: a quadratic curve is a special case of the cubic
the Pen already draws, the output would be cubic anyway, and a mode switch is one more thing to learn. The Pen keeps
its industry-standard name.

**Pen and Arc draw one path; arcs chain.** A shape often mixes straight lines, curves and arcs (a rounded
bracket, a keyhole). One shared draft lets B and A switch tools mid-path, and every arc starts where the previous
segment ended, so the Arc tool works like the Pen: add segments, finish with a double-click, Enter or Esc, close on
the first point. *Rejected:* tangent-only chained arcs (one click per arc, as in CAD): faster for S-curves, but a
corner between two arcs would need a modifier, and the 3-point gesture is the same for the first and every next arc.

**Open paths continue from a selected path's end only.** Pen, Arc and Freehand extend a path when started on one
of its ends, as in Inkscape. Restricting it to the selected path keeps the common case (drawing a new path from a
snapped endpoint) separate. The Line tool does not continue paths: it draws separate lines on purpose, and a click
with the Pen already adds a straight segment.

## Fonts

**Google Fonts through the CSS2 API, asking only for what is needed.** Picker rows request a few hundred bytes each
(`text=` with the letters of the name); text to path requests one file with exactly the used characters; the canvas
loads the real faces. Only styles the family really has are requested (from Fontsource metadata), because a request
for a missing style fails as a whole with HTTP 400 and the browser logs it.

**Bundled fonts only for the generic families.** `sans-serif`, `serif` and the others are drawn with bundled open
fonts so that the outline of such a text matches the screen. Other fonts are not bundled: the catalog is the whole
Google collection.

**Never substitute a font silently.** If a font cannot be obtained, conversion to paths is refused with a reason.
A look-alike would change the drawing without the user noticing.

**fontkit for outlines.** opentype.js could not read some kerning tables (Inter's outlines differed from the screen
by about 40 % of pixels); fontkit does full OpenType shaping and matches the browser within 1–2 %.

## Files and storage

**A JSON project format next to SVG.** SVG cannot keep everything the editor needs (names, locks, guides, the
rotation origin, gradient definitions in the editor's form) without private extensions. The project file is strictly
validated on load.

**Preferences in the browser, not in the project.** Grid, snapping, panel sizes and similar settings describe how a
person works, not what they drew, so they follow the person (localStorage) and a project looks the same wherever it
is opened. Ruler guides are the exception: they belong to a drawing and are saved in the project (never exported).

**Clipboard: the system clipboard first.** Every copy in the editor also writes the system clipboard, so whatever is
there is never older than the editor's own copy. Pasting takes, in order: the editor's tagged SVG (full fidelity
through localStorage), SVG from another program (stays editable; Inkscape also puts a PNG next to it), a picture,
and only when the system clipboard holds nothing usable, the editor's last copy.

## Interface

**Contextual command bar.** The bar under the menus shows the controls of the current tool and selection (rotation,
opacity, align, combine, group). It keeps the property panel for properties and puts actions where the pointer is.
On narrow screens it scrolls sideways without a visible scrollbar rather than growing a "more" menu.

**A context menu that lists only what applies.** Disabled items make a long menu harder to scan. Every item is also
available elsewhere, so the context menu is a shortcut, never the only way. On touch screens it opens with a long
press implemented by the editor, because iOS Safari never sends the browser's `contextmenu` event.

**Locked shapes let clicks through.** A lock exists so that a background cannot be moved or cut by accident; making
the shape transparent to the pointer achieves that everywhere at once (selection, rubber band, Scissors, Blob).

**Recent colors behind the swatch.** The color picker appears in four places (fill, stroke, gradient stops,
background). A permanent row of recent colors would cost space in each, so the swatch opens a small popover with the
recent colors and the colors already in the drawing.

**Snapping indicators with a light casing instead of changing colors.** Snap and guide lines are drawn on a thin
white casing, so a pink line over a pink shape stays visible. Picking a contrasting color per position would mean
sampling the canvas while dragging.

**Phones: the property panel as a bottom sheet.** On a narrow screen a side panel would cover the drawing. The sheet
sits under the drawing area, between the toolbar and the tab strip, so tools and tabs stay reachable; it is
resizable and remembers its height.
