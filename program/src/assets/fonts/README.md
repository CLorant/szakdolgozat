# Bundled fonts for the CSS generic families

The editor draws the generic families with these files, and converts such text to paths with the same files, so
the outline always matches what is on screen. All are licensed under the SIL Open Font License 1.1 (`OFL.txt` in
each folder) and come from the Fontsource npm packages.

| Generic      | Font                        | Weights          | Italic        |
|--------------|-----------------------------|------------------|---------------|
| `sans-serif` | Noto Sans (variable)        | 100–900          | yes           |
| `serif`      | Noto Serif (variable)       | 100–900          | yes           |
| `monospace`  | Noto Sans Mono (variable)   | 100–900          | synthesized   |
| `system-ui`  | Inter (variable)            | 100–900          | yes           |
| `cursive`    | Comic Neue                  | 300, 400, 700    | yes           |
| `fantasy`    | Anton                       | 400              | synthesized   |

Subsets: Latin, Latin Extended, Cyrillic (+ext), Greek (+ext), Vietnamese where the font has them (Comic Neue is
Latin only; other characters fall back to Noto Sans). `src/lib/fonts/bundledData.ts` lists the files with their
unicode ranges. Each file is downloaded only when a character in its range is used.
