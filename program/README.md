# Solid SVG Editor

A vector graphics editor that runs in the browser and works directly on SVG: shapes, paths, text and images are
drawn, edited and saved as standard SVG, with a project format for continuing work later. Written in Svelte 5 and
TypeScript, without a server: everything happens on the user's machine.

Built as a BSc thesis project at the University of Miskolc (Miskolci Egyetem).

## Features

- **Drawing:** rectangle, ellipse, line, polygon / polyline, Pen (Bézier) and Arc (circular arcs) in one path, Freehand,
  Text, Blob (paint shapes that merge).
- **Editing:** select, move, resize and rotate one shape or several; a rotation origin that can be moved; node
  editing with several nodes at once; open paths continued from their ends; groups (enter, edit inside,
  ungroup); align, flip, z-order; lock and hide.
- **Shapes from shapes:** boolean operations (Unite, Subtract, Intersect, Exclude, Divide) that keep curves,
  Scissors (cut at a point, along a freehand or straight knife, or cut out a lasso), Shape to Path, Stroke to Path.
- **Paint:** solid colors with opacity, linear and radial gradients, dash patterns, caps and joins, fill rule;
  recent colors and the colors already in the drawing.
- **Text:** Google Fonts (the whole catalog), fonts installed on the computer (Chromium), bundled fonts for the
  generic families; weights, italic, decoration, letter / word spacing, line height; text to path.
- **Files:** open and import SVG (and pictures); export SVG (fonts linked, embedded or converted to paths), PNG,
  JPG and WebP; save and open projects (`.svgedit.json`); autosave in the browser; copy and paste between tabs and
  with other programs.
- **Workspace:** zoom and endless panning, rulers and guides, grid, snapping to the grid and to objects, undo
  history with named steps, context menu, light and dark theme, phone and tablet layout with touch support.

The Help menu in the editor lists every tool, shortcut and mouse control. See [docs/user-guide.md](docs/user-guide.md)
for more detail.

## Running the program

Requires Node.js 20.19 or newer (Vite 7).

```sh
npm install
npm run dev        # development server (http://localhost:5173)
npm run build      # production build in dist/ (static files: any web server can host them)
npm run preview    # serve the production build locally
npm test           # unit and component tests (Vitest + jsdom)
npm run check      # type checks (svelte-check + tsc)
```

## Browser support

Developed and tested in Chromium (Chrome, Edge). The editor uses only standard web APIs; two features depend on
the browser:

- **Local fonts** need the Local Font Access API (Chrome and Edge). Elsewhere a short list of common installed
  fonts is offered for display, but they cannot be converted to paths.
- **Paste from the menus** reads the system clipboard, which Firefox and Safari allow only after a confirmation;
  Ctrl / ⌘ V works everywhere.

Firefox, Safari and real touch devices have not been tested systematically.

## Documentation

| Document | For |
|---|---|
| [docs/user-guide.md](docs/user-guide.md) | Using the editor: tools, panels, files, touch screens |
| [docs/architecture.md](docs/architecture.md) | How the code is organised: data model, stores, tools, rendering, files, fonts |
| [docs/decisions.md](docs/decisions.md) | Design decisions and the reasons for them, with the alternatives that were rejected |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Working on the code: commands, tests, comment conventions |

## Limitations

- **SVG features not supported:** patterns, clipping paths, masks, filters, markers, blend modes, text on a path,
  `<tref>`, SVG fonts, animations and CSS style sheets. On import they are skipped with a warning (patterns become a grey fill).
  `<symbol>` is supported through `<use>`; of a `<switch>` the first child whose conditions hold is imported.
  `eval/` holds the scripts that measured the importer on 139 real files and the accuracy of text to path.
- **Text:** no text on a path; mixed right-to-left and left-to-right text is not reordered when converted to paths
  (a warning says so). A font that cannot be obtained is never replaced by a look-alike: conversion is refused.
- **Boolean operations** on shapes with different gradients keep the gradient of the shape whose style the result
  takes.
- **Non-uniform resizing** of a multi-selection that contains rotated shapes is approximate (the model has no skew).
- **Storage:** autosave uses the browser's local storage (about 5 MB). A drawing with large embedded pictures can
  exceed it; the editor warns, and File → Save project keeps the work.
- **Google Fonts** need the network the first time each font and style is used.

## Licence

The bundled fonts in `src/assets/fonts` are under the SIL Open Font License 1.1 (see the `OFL.txt` in each folder).
