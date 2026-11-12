# Contributing

## Commands

```sh
npm install
npm run dev          # development server
npm test             # unit and component tests (Vitest, jsdom)
npm run test:watch   # the same, re-running on change
npm run check        # type checks (svelte-check + tsc)
npm run build        # production build in dist/
```

Before committing: `npm run check` (0 errors, 0 warnings) and `npm test` (all green).

## Where things go

See [docs/architecture.md](docs/architecture.md). In short: the model and pure functions in `src/lib/utils`, state
and the editing actions in `src/lib/stores` (every document change goes through `editor.ts`), one module per tool in
`src/lib/tools`, fonts in `src/lib/fonts`, components in `src/lib/components` and `src/lib/layouts`.

## Tests

Tests live in `tests/`, grouped by area: `model/`, `tools/`, `io/`, `fonts/`, `ui/`. A file is named after the
feature it covers (`tools/scissors.test.ts`), not after when it was written. Files that mount Svelte components end
in `.dom.test.ts` and start with `// @vitest-environment jsdom`.

- A new feature gets its tests in the file of its area; a fixed bug gets a test that failed before the fix.
- Tests must not use the network. Google Fonts and Fontsource are replaced by `tests/helpers/fakeGoogle.ts`; add
  font files to `tests/fixtures/fonts` when a test needs one.
- Tools are tested by feeding them `PointerInfo` objects (see `tests/tools/select.test.ts`); actions through
  `editor.*` and the stores; components by mounting them and dispatching DOM events.

## Comments

The code follows the TSDoc / JSDoc conventions used by the TypeScript handbook and the Google TypeScript style
guide:

- **File header.** Every module starts with a `/** @file … */` block: one sentence saying what the file is for,
  then any background a reader needs (formats, the rule it implements, what it deliberately does not do). In a
  Svelte component the block is the first thing in `<script>`. The path is not repeated; the file name says it.
- **Documentation comments (`/** … */`)** go on exported functions, types, interfaces, their fields and component
  props: what it is or does, what it returns, when it throws. They are read in editor tooltips, so the first
  sentence must stand alone.
- **Implementation comments (`//`)** explain *why* a piece of code is the way it is (a browser quirk, a geometric
  rule, a trade-off), never *what* the next line obviously does. Put them above the code, or at the end of a
  short line.
- **No history.** Comments describe the code as it is. What it used to do, which bug a line fixed, or who asked
  for it belongs in the commit message.
- **Sentences.** Start with a capital letter and end with a full stop when a comment is a sentence. Use the same
  words as the user interface (Objects, Typography, Local Fonts…).
- **Section dividers** (`// ── name ──────`) may split a long file into parts; keep them short and consistent.

## Documentation

- `README.md`: what the editor is, how to run it, its limitations.
- `docs/user-guide.md`: how to use it. Update it when a tool, panel or menu changes.
- `docs/architecture.md`: how the code is organised. Update it when a module, store or storage key is added.
- `docs/decisions.md`: why. Add an entry when a choice between real alternatives is made.

## Notifications

Toasts are for what the user must know and cannot see: a refused action, data that could not be kept, a
problem with a file. Successful actions show their result on the canvas.
