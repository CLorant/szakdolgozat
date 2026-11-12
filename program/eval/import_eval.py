"""Import study: how faithfully does the importer keep real SVG files?

For every file: importSvg() -> buildSvgFile() (text kept as live text),
then the original and the exported SVG are both drawn by Chromium onto a
white canvas whose longer side is 400 px. A pixel is "ink" when any channel
is more than 40 below white in either image; an ink pixel "differs" when the
largest channel difference is above 64. The score is differing / ink pixels.

Usage (in the project folder):
    npm run dev -- --port 5199          # in one terminal
    python3 eval/import_eval.py FILES_DIR results.json
FILES_DIR holds one sub-folder per source with the .svg files listed in
eval/files.txt. Needs: pip install playwright (Chromium).
"""
import asyncio, json, os, sys
from playwright.async_api import async_playwright

JS = r"""
async ({ text }) => {
  const imp = await import('/src/lib/utils/svgImport.ts');
  const ex = await import('/src/lib/utils/exportDoc.ts');
  let r;
  try { r = imp.importSvg(text); } catch (e) { return { error: String(e.message || e) }; }
  const W0 = r.width || 300, H0 = r.height || 150;
  const doc = { shapes: r.shapes, width: W0, height: H0, background: 'transparent-light', bgImage: '' };
  const out = await ex.buildSvgFile(doc, { text: 'live', opaque: false });
  const k = 400 / Math.max(W0, H0);
  const W = Math.max(1, Math.round(W0 * k)), H = Math.max(1, Math.round(H0 * k));
  const render = async (svg) => {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const img = new Image();
    try { await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = url; }); }
    catch { return null; }
    const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.drawImage(img, 0, 0, W, H);
    URL.revokeObjectURL(url);
    return g.getImageData(0, 0, W, H).data;
  };
  const a = await render(text), b = await render(out.svg);
  if (!a || !b) return { error: !a ? 'original does not render' : 'export does not render', warnings: r.warnings };
  let ink = 0, diff = 0;
  for (let i = 0; i < a.length; i += 4) {
    const ia = Math.max(255 - a[i], 255 - a[i+1], 255 - a[i+2]) > 40;
    const ib = Math.max(255 - b[i], 255 - b[i+1], 255 - b[i+2]) > 40;
    if (ia || ib) {
      ink++;
      if (Math.max(Math.abs(a[i]-b[i]), Math.abs(a[i+1]-b[i+1]), Math.abs(a[i+2]-b[i+2])) > 64) diff++;
    }
  }
  return { warnings: r.warnings, shapes: r.shapes.length, diff: ink ? diff / ink : 0, ink };
}
"""

async def main(root, out_path, url='http://localhost:5199/'):
    res = {}
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await (await b.new_context(viewport={'width': 1200, 'height': 800})).new_page()
        # keep the run offline: only the dev server may be reached
        await pg.route('**/*', lambda r: r.continue_() if 'localhost' in r.request.url else r.abort())
        await pg.goto(url); await pg.wait_for_selector('svg.svge-canvas')
        for src in sorted(os.listdir(root)):
            res[src] = []
            for name in sorted(os.listdir(os.path.join(root, src))):
                text = open(os.path.join(root, src, name), encoding='utf-8').read()
                try: r = await pg.evaluate(JS, {'text': text})
                except Exception as e: r = {'error': 'evaluate: ' + str(e)[:200]}
                r['name'] = name; res[src].append(r)
                print(src, name, r.get('error') or f"diff={r['diff']:.3f} warnings={len(r['warnings'])}", flush=True)
        await b.close()
    json.dump(res, open(out_path, 'w'), ensure_ascii=False, indent=1)

if __name__ == '__main__':
    asyncio.run(main(sys.argv[1], sys.argv[2]))
