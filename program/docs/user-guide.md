# User guide

A tour of the editor. Help → Help inside the editor has the complete list of keyboard shortcuts.

## The window

| Area | What it holds |
|---|---|
| Menu bar (top) | File, Edit, View, Object, Help; the theme switch on the right |
| Command bar (under the menus) | Undo / Redo, zoom, and the controls of the current tool or selection (rotation, opacity, align, combine, group…) |
| Toolbar (left) | The tools, and the Shift lock for touch screens (⇧) |
| Canvas (middle) | The page, with rulers. The area around the page can be used too |
| Property tabs (right) | Fill, Stroke, Geometry, Typography, Objects, History, Canvas. A tab opens its panel; the same tab closes it |

On a narrow screen (a phone held upright) the property panel opens as a sheet under the drawing; drag its top edge
to make it taller, or use the small tab on its edge to close it.

## Tools

| Tool | Key | Use |
|---|---|---|
| Select | V | Click selects, Shift-click adds, drag on empty canvas selects with a rectangle. Drag to move, the handles resize (Shift keeps the proportions), the knob above rotates (Shift: 15° steps). The crosshair in the middle is the rotation origin: drag it to turn the shape about another point, double-click it to centre it again |
| Edit Nodes | E | Drag nodes and Bézier handles. Shift-click or drag a rectangle to pick several nodes; they move, nudge and delete together. Double-click a path to add a node, double-click a node to switch it between corner and smooth. Rectangles show corner-radius handles, ellipses radius handles |
| Pen | B | Click for a corner node, click and drag for a smooth node. Click the first node to close the path; double-click, Enter or Esc finishes an open one; Backspace removes the last node. Press A to go on with arcs |
| Arc | A | Drag from one end of the arc to the other (or click both ends), move to bend it, click. The next arc starts where this one ended: click its end, bend, click. Double-click, Enter or Esc finishes; ending an arc on the first point closes the path. Shift rounds the sweep to 15° (90° and 180° exactly); Backspace removes the last arc. Press B to go on with the Pen |
| Freehand | F | Draw; the stroke is smoothed into a few curve nodes |
| Line | L | Drag. Shift: 0°, 45°, 90° … |
| Rectangle | R | Drag. Shift: square; Alt: from the centre |
| Ellipse | O | Drag. Shift: circle; Alt: from the centre |
| Polygon | P | Click the corners; click the first one to close. The command bar switches between Polygon and Polyline |
| Text | T | Click to place a text and type; Esc or Ctrl Enter finishes. Click an existing text to edit it |
| Blob | Shift B | Paint with a round brush; strokes that touch a shape of the same fill and stroke merge with it |
| Scissors | C | Drag across shapes to cut them along the line (Shift: a straight cut); end the drag where it started to cut out the inside (lasso); click an outline to split it at that point. If the cut reaches selected shapes, only those are cut |
| Pan | H | Drag to move the view. Space-drag and the middle mouse button pan with any tool |

**Mixing Pen and Arc:** while a path is being drawn, B and A switch between the Pen and the Arc tool and the same
path goes on, so straight segments, curves and arcs can follow each other in one shape.

**Continuing a path:** select an open path (or a line), then start the Pen, the Arc or the Freehand tool on one of its
ends (a purple ring shows where): the new part is added to that path, which keeps its name and style. Ending on its
other end closes it. Only the selected path is continued, so a new path started on another path's end stays separate.

## Selection and objects

- **Context menu:** right-click a shape or the empty canvas (on a touch screen: hold a finger still for half a
  second with the Select or Edit tool). It offers what applies: cut, copy, paste here, arrange, group, combine,
  align, flip, lock, hide, convert, delete; on empty canvas paste, select all, unlock all and view options.
- **Object menu:** Arrange (z-order), Align, Flip, Group, Combine (boolean operations) and Path (Shape to Path,
  Stroke to Path).
- **Groups:** Ctrl G groups, Ctrl Shift G ungroups. Double-click a group to work inside it; Esc or a click outside
  leaves it.
- **Combine:** with two or more shapes selected, the command bar shows Unite, Subtract, Intersect, Exclude and
  Divide. Subtract cuts the shapes in front out of the bottom one; Divide splits everything into the pieces the
  outlines make.
- **Objects panel:** every shape, topmost first. Click selects, double-click renames, drag a row to reorder or to
  move it into a group (on a touch screen, hold the row first). The row buttons hide (●), lock (padlock) and delete.
  A locked shape stays visible but cannot be clicked on the canvas, so a background can't be moved by accident.

## Panels

| Panel | Contents |
|---|---|
| Fill | Solid, linear or radial gradient, or none; the color picker; object opacity; the fill rule (non-zero / even-odd) for paths |
| Stroke | Paint type and color; width; Stroke to path; dash pattern (Solid, Dashed, Dotted, Dash-dot, or typed lengths) and its offset; line cap and join |
| Geometry | Position and size (several shapes: the box around all of them); the chain keeps the proportions. For one shape also the rotation origin (in percent of the box, or one of nine points), the rotation, and the corner radius of rectangles |
| Typography | Font family (Google Fonts, Local Fonts), size, weight, italic, underline / strike / overline, anchor, letter and word spacing, line height |
| Objects | The shape list (above) |
| History | Every step by name; click one to go back to it |
| Canvas | Page size and presets, Fit canvas to content, background (white, black, light / dark transparent, a color, an image), grid and snapping |

**Colors:** the swatch next to the sliders opens the recent colors and the colors already used in the drawing.
The color code (HEX, RGB, HSL) is remembered for every picker.

**Dash patterns:** the presets grow with the stroke width (a dotted line stays dotted at any width). A pattern
typed in the Pattern field keeps its lengths in pixels.

## Files

| Command | Result |
|---|---|
| File → Save project (Ctrl S) | A `.svgedit.json` file with everything, including names, locks, guides and the rotation origins |
| File → Open… | A project file, or an SVG to edit |
| File → Import… | Adds an SVG or a picture (PNG, JPG, WebP, GIF…) to the drawing. Pictures can also be dropped on the canvas or pasted |
| File → Export as SVG / PNG / JPG / WebP | Uses the settings of File → Export options… |

**Export options:** the area (the page, or a box around the objects with padding), the background, a viewBox-only
SVG, and what happens to fonts: Google fonts embedded (only the characters used, or whole script subsets) or
linked, local fonts referenced or embedded, or all text converted to paths so that no font is needed at all.
Raster images are at least 4000 px wide by default, or scaled, or a set width.

**Autosave:** the drawing is kept in the browser while you work and comes back when the page is opened again. It
is not a substitute for saving a project file: clearing the browser's data removes it.

**Copy and paste:** Ctrl C / Ctrl V copy shapes within the editor, between editor tabs (full fidelity) and to other
programs as SVG. Pasting accepts the editor's own shapes, SVG from other programs and pictures, in that order.

## Settings that are remembered

The editor remembers, in this browser: the grid and snapping settings, the panel size, the chain in Geometry, the
Blob brush size, the polygon / polyline choice, the export options, the color code, the recent colors and the
theme. They are not stored in project files, so a drawing looks the same wherever it is opened.

## Touch screens

- One finger draws or drags with the current tool. Two fingers zoom (pinch) and move the view, with any tool.
- The ⇧ button at the bottom of the toolbar is a Shift key that stays on: squares, circles, 45° lines, adding to the
  selection.
- Hold a finger still to open the context menu (Select and Edit tools) or to pick up a row in the Objects panel.
- Handles have larger invisible grab areas than they look.
