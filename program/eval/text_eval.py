"""Text-to-path accuracy: live text versus its outline, on the editor canvas.

A one-line text (72 px, zoom 1) is placed on an empty document and the
canvas is captured; then the text is replaced by the result of
outlineTexts() and captured again. Pixels darker than 215 (of 255) in
either capture are ink; an ink pixel differs when the grey levels differ
by more than 64. Network access is blocked, so only the fonts bundled
with the editor are used for the generic families.

Usage: npm run dev -- --port 5199, then python3 eval/text_eval.py
"""
import asyncio, io, json, sys
from PIL import Image
from playwright.async_api import async_playwright

FAMILIES = ['serif', 'sans-serif', 'monospace', 'fantasy', 'cursive']
TEXT = sys.argv[1] if len(sys.argv) > 1 else 'Árvíztűrő tükörfúrógép AVATAR fi'

SETUP = """async ({fam, w, text}) => {
  const ed = (await import('/src/lib/stores/editor.ts')).editor;
  const sh = await import('/src/lib/utils/shapes.ts');
  const ui = (await import('/src/lib/stores/ui.ts')).ui;
  ed.newDocument(1200, 160);
  const t = sh.makeText(20, 110, text, { ...ui.get().textProps, fontFamily: fam, fontSize: 72, fontWeight: w },
                        { fill: '#000000', stroke: 'none', strokeWidth: 0 });
  ed.addShapes([t]); ed.deselectAll(); ui.set({ tool: 'transform', panelOpen: false }); window.__t = t;
  (await import('/src/lib/utils/zoom.ts')).zoomTo(1);
}"""
OUTLINE = """async () => {
  const ed = (await import('/src/lib/stores/editor.ts')).editor;
  const ex = await import('/src/lib/utils/exportDoc.ts');
  const r = await ex.outlineTexts([window.__t]);
  ed.replaceShape(r.shapes[0], 'outline'); ed.deselectAll(); return r.warnings;
}"""

def score(a, b):
    A, B = a.load(), b.load(); ink = diff = 0
    for y in range(a.size[1]):
        for x in range(a.size[0]):
            if A[x, y] < 215 or B[x, y] < 215:
                ink += 1
                if abs(A[x, y] - B[x, y]) > 64: diff += 1
    return diff / ink if ink else 0.0

async def main():
    out = []
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await (await b.new_context(viewport={'width': 1600, 'height': 700}, device_scale_factor=1)).new_page()
        await pg.route('**/*', lambda r: r.continue_() if 'localhost' in r.request.url else r.abort())
        await pg.goto('http://localhost:5199/'); await pg.wait_for_selector('svg.svge-canvas')
        canvas = pg.locator('svg.svge-canvas')
        for fam in FAMILIES:
            for w in (400, 700):
                await pg.evaluate(SETUP, {'fam': fam, 'w': w, 'text': TEXT}); await pg.wait_for_timeout(1500)
                a = Image.open(io.BytesIO(await canvas.screenshot())).convert('L')
                warnings = await pg.evaluate(OUTLINE); await pg.wait_for_timeout(800)
                b2 = Image.open(io.BytesIO(await canvas.screenshot())).convert('L')
                d = score(a, b2); out.append(dict(family=fam, weight=w, diff=d, warnings=warnings))
                print(f'{fam:11} {w}  {d*100:6.2f}%  {warnings}', flush=True)
        await b.close()
    json.dump(out, open('text_results.json', 'w'), ensure_ascii=False, indent=1)

asyncio.run(main())
