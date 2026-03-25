<script lang="ts">
  import { onMount } from "svelte";
  import { editorStore } from "../stores/editorStore";
  import { buildSvgDocument } from "../utils/serializer";

  let openMenu: string | null = null;
  const toggle = (name: string) => {
    openMenu = openMenu === name ? null : name;
  };
  const close = () => {
    openMenu = null;
  };

  let gridEnabled = false,
    snapEnabled = false,
    canUndo = false,
    canRedo = false;
  let canvasWidth = 800,
    canvasHeight = 600;
  let canvasBgImage = "";
  editorStore.subscribe((s) => {
    gridEnabled = s.gridEnabled;
    snapEnabled = s.snapEnabled;
    canUndo = s.canUndo;
    canRedo = s.canRedo;
    canvasWidth = s.canvasWidth;
    canvasHeight = s.canvasHeight;
    canvasBgImage = s.canvasBgImage;
  });

  // ── File ──────────────────────────────────────────────────────────────────
  function handleNew() {
    if (
      editorStore.getState().shapes.length > 0 &&
      !confirm("Open a blank canvas? Unsaved work will be lost.")
    )
      return;
    window.open(window.location.pathname, "_blank");
    close();
  }
  function handleOpen() {
    pickSvg((svg) => {
      const key = `svgeopen_${Date.now()}`;
      localStorage.setItem(key, svg);
      window.open(`${window.location.pathname}?svgKey=${key}`, "_blank");
    });
    close();
  }
  function handleImport() {
    pickSvg(importSvg);
    close();
  }
  function handleExportSVG() {
    download(
      buildSvgDocument(
        editorStore.getState().shapes,
        canvasWidth,
        canvasHeight,
        canvasBgImage,
      ),
      "drawing.svg",
      "image/svg+xml",
    );
    close();
  }
  function handleExportPNG() {
    exportRaster("png");
    close();
  }
  function handleExportJPG() {
    exportRaster("jpg");
    close();
  }

  // ── Edit ──────────────────────────────────────────────────────────────────
  function handleUndo() {
    editorStore.undo();
    close();
  }
  function handleRedo() {
    editorStore.redo();
    close();
  }
  function handleCopy() {
    editorStore.copySelected();
    close();
  }
  function handleCut() {
    editorStore.cutSelected();
    close();
  }
  function handlePaste() {
    editorStore.paste();
    close();
  }
  function handleSelectAll() {
    editorStore.selectAll();
    close();
  }
  function handleDeselectAll() {
    editorStore.deselectAll();
    close();
  }
  function handleDelete() {
    editorStore.deleteSelectedShapes();
    close();
  }
  function handleDuplicate() {
    editorStore.copySelected();
    editorStore.paste();
    close();
  }

  // ── View ──────────────────────────────────────────────────────────────────
  function setZoom(z: number) {
    editorStore.setZoom(z);
    close();
  }
  function toggleGrid() {
    editorStore.setGridEnabled(!gridEnabled);
    close();
  }
  function toggleSnap() {
    editorStore.setSnapEnabled(!snapEnabled);
    close();
  }

  // ── Arrange ───────────────────────────────────────────────────────────────
  function bringToFront() {
    const id = editorStore.getState().selectedShapeIds[0];
    if (id) editorStore.bringToFront(id);
    close();
  }
  function sendToBack() {
    const id = editorStore.getState().selectedShapeIds[0];
    if (id) editorStore.sendToBack(id);
    close();
  }
  function moveUp() {
    const id = editorStore.getState().selectedShapeIds[0];
    if (id) editorStore.moveShapeUp(id);
    close();
  }
  function moveDown() {
    const id = editorStore.getState().selectedShapeIds[0];
    if (id) editorStore.moveShapeDown(id);
    close();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function pickSvg(cb: (text: string) => void) {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".svg,image/svg+xml";
    inp.onchange = () => {
      const f = inp.files?.[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => cb(r.result as string);
      r.readAsText(f);
    };
    inp.click();
  }

  function importSvg(svgText: string) {
    const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
    const svgEl = doc.querySelector("svg");
    if (!svgEl) {
      alert("Could not parse SVG.");
      return;
    }
    const {
      currentFill: fill,
      currentStroke: stroke,
      currentStrokeWidth: sw,
    } = editorStore.getState();
    const base = { opacity: 1 as const, visible: true, name: "" };
    const n = (el: Element, a: string) =>
      parseFloat(el.getAttribute(a) ?? "0") || 0;
    const uid = () =>
      `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

    svgEl
      .querySelectorAll("line")
      .forEach((el) =>
        editorStore.addShape({
          id: uid(),
          type: "line",
          x1: n(el, "x1"),
          y1: n(el, "y1"),
          x2: n(el, "x2"),
          y2: n(el, "y2"),
          fill: "none",
          stroke: el.getAttribute("stroke") ?? stroke,
          strokeWidth: n(el, "stroke-width") || sw,
          ...base,
        }),
      );
    svgEl
      .querySelectorAll("rect")
      .forEach((el) =>
        editorStore.addShape({
          id: uid(),
          type: "rectangle",
          x: n(el, "x"),
          y: n(el, "y"),
          width: n(el, "width"),
          height: n(el, "height"),
          fill: el.getAttribute("fill") ?? fill,
          stroke: el.getAttribute("stroke") ?? stroke,
          strokeWidth: n(el, "stroke-width") || sw,
          ...base,
        }),
      );
    svgEl.querySelectorAll("ellipse,circle").forEach((el) => {
      const r = el.tagName === "circle" ? n(el, "r") : null;
      editorStore.addShape({
        id: uid(),
        type: "ellipse",
        cx: n(el, "cx"),
        cy: n(el, "cy"),
        rx: r ?? n(el, "rx"),
        ry: r ?? n(el, "ry"),
        fill: el.getAttribute("fill") ?? fill,
        stroke: el.getAttribute("stroke") ?? stroke,
        strokeWidth: n(el, "stroke-width") || sw,
        ...base,
      });
    });
    svgEl.querySelectorAll("polygon,polyline").forEach((el) => {
      const raw = (el.getAttribute("points") ?? "").trim().split(/[\s,]+/);
      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i + 1 < raw.length; i += 2)
        pts.push({ x: parseFloat(raw[i]), y: parseFloat(raw[i + 1]) });
      if (pts.length >= 2)
        editorStore.addShape({
          id: uid(),
          type: "polygon",
          closed: el.tagName === "polygon",
          points: pts,
          fill: el.getAttribute("fill") ?? fill,
          stroke: el.getAttribute("stroke") ?? stroke,
          strokeWidth: n(el, "stroke-width") || sw,
          ...base,
        });
    });
    svgEl.querySelectorAll("path").forEach((el) => {
      const d = el.getAttribute("d");
      if (!d) return;
      editorStore.addShape({
        id: uid(),
        type: "freehand",
        pathData: d,
        points: [],
        fill: el.getAttribute("fill") ?? "none",
        stroke: el.getAttribute("stroke") ?? stroke,
        strokeWidth: n(el, "stroke-width") || sw,
        ...base,
      });
    });
    svgEl.querySelectorAll("text").forEach((el) => {
      editorStore.addShape({
        id: uid(),
        type: "text",
        x: n(el, "x"),
        y: n(el, "y"),
        content: el.textContent ?? "",
        fontFamily: el.getAttribute("font-family") || "sans-serif",
        fontSize: parseFloat(el.getAttribute("font-size") || "16"),
        fontWeight: (el.getAttribute("font-weight") || "normal") as any,
        fontStyle: (el.getAttribute("font-style") || "normal") as any,
        textDecoration: "none",
        textAnchor: (el.getAttribute("text-anchor") || "start") as any,
        letterSpacing: (el.getAttribute("letter-spacing") || "0") as any,
        fill: el.getAttribute("fill") ?? fill,
        stroke: "none",
        strokeWidth: 0,
        ...base,
      });
    });
  }

  function download(content: string, filename: string, mime: string) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([content], { type: mime }));
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function exportRaster(fmt: "png" | "jpg") {
    const svg = buildSvgDocument(
      editorStore.getState().shapes,
      canvasWidth,
      canvasHeight,
    );
    const canvas = document.createElement("canvas");
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext("2d")!;
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    img.onload = () => {
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob(
        (b) => {
          if (b) {
            const a = document.createElement("a");
            a.href = URL.createObjectURL(b);
            a.download = `drawing.${fmt}`;
            a.click();
            URL.revokeObjectURL(a.href);
          }
        },
        `image/${fmt === "jpg" ? "jpeg" : "png"}`,
      );
    };
    img.src = url;
  }

  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    const key = params.get("svgKey");
    if (key) {
      const svg = localStorage.getItem(key);
      if (svg) {
        localStorage.removeItem(key);
        importSvg(svg);
      }
      window.history.replaceState({}, "", window.location.pathname);
    }
  });
</script>

<svelte:window on:click={close} />

<nav class="svge-menubar">
  <!-- File -->
  <div class="svge-menu-item" on:click|stopPropagation>
    <button
      class="svge-menu-btn"
      class:open={openMenu === "file"}
      on:click|stopPropagation={() => toggle("file")}>File</button
    >
    {#if openMenu === "file"}
      <div class="svge-dropdown" on:click|stopPropagation>
        <button class="svge-dd-item" on:click={handleNew}
          >New <span class="kbd">Ctrl N</span></button
        >
        <button class="svge-dd-item" on:click={handleOpen}>Open…</button>
        <button class="svge-dd-item" on:click={handleImport}
          >Import into canvas…</button
        >
        <div class="svge-dd-sep"></div>
        <button class="svge-dd-item" on:click={handleExportSVG}
          >Export as SVG</button
        >
        <button class="svge-dd-item" on:click={handleExportPNG}
          >Export as PNG</button
        >
        <button class="svge-dd-item" on:click={handleExportJPG}
          >Export as JPG</button
        >
      </div>
    {/if}
  </div>

  <!-- Edit -->
  <div class="svge-menu-item" on:click|stopPropagation>
    <button
      class="svge-menu-btn"
      class:open={openMenu === "edit"}
      on:click|stopPropagation={() => toggle("edit")}>Edit</button
    >
    {#if openMenu === "edit"}
      <div class="svge-dropdown" on:click|stopPropagation>
        <button class="svge-dd-item" disabled={!canUndo} on:click={handleUndo}
          >Undo <span class="kbd">Ctrl Z</span></button
        >
        <button class="svge-dd-item" disabled={!canRedo} on:click={handleRedo}
          >Redo <span class="kbd">Ctrl Y</span></button
        >
        <div class="svge-dd-sep"></div>
        <button class="svge-dd-item" on:click={handleCopy}
          >Copy <span class="kbd">Ctrl C</span></button
        >
        <button class="svge-dd-item" on:click={handleCut}
          >Cut <span class="kbd">Ctrl X</span></button
        >
        <button class="svge-dd-item" on:click={handlePaste}
          >Paste <span class="kbd">Ctrl V</span></button
        >
        <button class="svge-dd-item" on:click={handleDuplicate}
          >Duplicate <span class="kbd">Ctrl D</span></button
        >
        <div class="svge-dd-sep"></div>
        <button class="svge-dd-item" on:click={handleSelectAll}
          >Select All <span class="kbd">Ctrl A</span></button
        >
        <button class="svge-dd-item" on:click={handleDeselectAll}
          >Deselect All <span class="kbd">Esc</span></button
        >
        <div class="svge-dd-sep"></div>
        <button class="svge-dd-item" on:click={handleDelete}
          >Delete <span class="kbd">Del</span></button
        >
      </div>
    {/if}
  </div>

  <!-- View -->
  <div class="svge-menu-item" on:click|stopPropagation>
    <button
      class="svge-menu-btn"
      class:open={openMenu === "view"}
      on:click|stopPropagation={() => toggle("view")}>View</button
    >
    {#if openMenu === "view"}
      <div class="svge-dropdown" on:click|stopPropagation>
        <button class="svge-dd-item" on:click={() => setZoom(0.5)}
          >Zoom 50%</button
        >
        <button class="svge-dd-item" on:click={() => setZoom(1)}
          >Zoom 100% <span class="kbd">Ctrl 0</span></button
        >
        <button class="svge-dd-item" on:click={() => setZoom(2)}
          >Zoom 200%</button
        >
        <div class="svge-dd-sep"></div>
        <button class="svge-dd-item svge-dd-check" on:click={toggleGrid}>
          <span class="svge-check">{gridEnabled ? "✓" : ""}</span> Grid
        </button>
        <button class="svge-dd-item svge-dd-check" on:click={toggleSnap}>
          <span class="svge-check">{snapEnabled ? "✓" : ""}</span> Snap to grid
        </button>
      </div>
    {/if}
  </div>

  <!-- Arrange -->
  <div class="svge-menu-item" on:click|stopPropagation>
    <button
      class="svge-menu-btn"
      class:open={openMenu === "arrange"}
      on:click|stopPropagation={() => toggle("arrange")}>Arrange</button
    >
    {#if openMenu === "arrange"}
      <div class="svge-dropdown" on:click|stopPropagation>
        <button class="svge-dd-item" on:click={bringToFront}
          >Bring to Front <span class="kbd">Ctrl ]</span></button
        >
        <button class="svge-dd-item" on:click={moveUp}>Bring Forward</button>
        <button class="svge-dd-item" on:click={moveDown}>Send Backward</button>
        <button class="svge-dd-item" on:click={sendToBack}
          >Send to Back <span class="kbd">Ctrl [</span></button
        >
      </div>
    {/if}
  </div>
</nav>

<style>
  .svge-menubar {
    display: flex;
    align-items: center;
    gap: 1px;
    padding: 0 4px;
  }

  .svge-menu-item {
    position: relative;
  }

  .svge-menu-btn {
    padding: 0 10px;
    height: 36px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    color: var(--text-color);
    cursor: pointer;
    font-size: 0.875rem;
    transition: background 0.12s;
    white-space: nowrap;
  }

  .svge-menu-btn:hover,
  .svge-menu-btn.open {
    background: var(--ruler-bg);
    border-color: var(--border-color);
  }

  .svge-dropdown {
    position: absolute;
    top: calc(100% + 2px);
    left: 0;
    min-width: 210px;
    background: var(--bg-color);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
    z-index: 2000;
    padding: 4px 0;
  }

  .svge-dd-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    padding: 6px 14px;
    background: transparent;
    border: none;
    color: var(--text-color);
    cursor: pointer;
    font-size: 0.875rem;
    border-radius: 0;
    text-align: left;
  }

  .svge-dd-item:hover:not(:disabled) {
    background: var(--tool-active);
  }
  .svge-dd-item:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .svge-dd-check {
    gap: 8px;
    justify-content: flex-start;
  }
  .svge-check {
    width: 14px;
    font-size: 0.8rem;
    color: var(--tool-border-active);
  }

  .kbd {
    font-size: 0.7rem;
    opacity: 0.4;
    letter-spacing: 0.02em;
    font-family: monospace;
    margin-left: auto;
    padding-left: 12px;
  }

  .svge-dd-sep {
    height: 1px;
    background: var(--border-color);
    margin: 3px 0;
  }
</style>
