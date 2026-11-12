# Evaluation scripts

These scripts produced the measurements in chapter 6 of the thesis.

* `import_eval.py` – the import study (139 real SVG files, see `files.txt`).
* `text_eval.py` – accuracy of converting text to paths.

Both drive the running development server (`npm run dev -- --port 5199`)
with Playwright's Chromium and load the editor's own modules, so they
measure exactly the code in `src/`.

The SVG files themselves are not included because of their licences.
`files.txt` lists every file and the package and version it comes from;
put them in one folder per source and pass that folder to `import_eval.py`.
