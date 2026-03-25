<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { editorStore }   from '../stores/editorStore';
  import ShapeRenderer     from '../components/ShapeRenderer.svelte';
  import { generateFreehandPath, generateQuadraticBezierPath,
           generateCubicBezierPath, generateArcPath } from '../utils/path';
  import { isPointInShape, translateShape } from '../utils/geometry';
  import { getShapeBounds, getHandlePositions, resizeBounds,
           applyBoundsToShape, getEditNodes, applyNodeMove } from '../utils/bounds';
  import type { Shape, TextShape, ToolType, Point, BoundingBox } from '../utils/types';

  export const CANVAS_W = 800;
  export const CANVAS_H = 600;
  export let canvasAreaEl: HTMLElement | null = null;
  export const PADDING = 40;

  // ── Store mirror ──────────────────────────────────────────────────────────
  let shapes:           Shape[]  = [];
  let selectedTool:     ToolType = 'transform';
  let selectedShapeIds: string[] = [];
  let currentFill   = '#aaaaaa', currentStroke = '#000000', currentStrokeWidth = 2;
  let background    = 'white';
  let isDrawing     = false;
  let tempShape:    Shape | null = null;
  let polygonPoints: Point[] = [];
  let zoom = 1;
  let curveSubTool  = 'cubic-bezier';
  let textProps     = editorStore.getState().textProps;
  let snapEnabled   = false;
  let gridSizeX     = 20;
  let gridSizeY     = 20;
  let gridEnabled   = false;
  let polygonClosed = true;
  let canvasWidth   = 800;
  let canvasHeight  = 600;
  let canvasBgImage = '';

  editorStore.subscribe(s => {
    shapes             = s.shapes;
    selectedTool       = s.selectedTool;
    selectedShapeIds   = s.selectedShapeIds;
    currentFill        = s.currentFill;
    currentStroke      = s.currentStroke;
    currentStrokeWidth = s.currentStrokeWidth;
    background         = s.background;
    isDrawing          = s.isDrawing;
    tempShape          = s.tempShape;
    polygonPoints      = s.polygonPoints;
    zoom               = s.zoom;
    curveSubTool       = s.curveSubTool;
    textProps          = s.textProps;
    snapEnabled        = s.snapEnabled;
    gridSizeX          = s.gridSizeX;
    gridSizeY          = s.gridSizeY;
    gridEnabled        = s.gridEnabled;
    polygonClosed      = s.polygonClosed;
    canvasWidth        = s.canvasWidth;
    canvasHeight       = s.canvasHeight;
    canvasBgImage      = s.canvasBgImage;
  });

  let svgEl: SVGSVGElement;

  onMount(() => {
    const area = canvasAreaEl;
    if (!area) return;
    const onScroll = () => editorStore.setCanvasScroll(area.scrollLeft, area.scrollTop);
    area.addEventListener('scroll', onScroll, { passive: true });
    editorStore.setCanvasPadding(PADDING);
    return () => area.removeEventListener('scroll', onScroll);
  });

  // ── Coordinate helpers ────────────────────────────────────────────────────
  function svgPt(e: MouseEvent): Point {
    if (!svgEl) return { x: 0, y: 0 };
    const rect = svgEl.getBoundingClientRect();
    let x = (e.clientX - rect.left) / zoom;
    let y = (e.clientY - rect.top)  / zoom;
    if (snapEnabled && selectedTool !== 'freehand') {
      x = Math.round(x / gridSizeX) * gridSizeX;
      y = Math.round(y / gridSizeY) * gridSizeY;
    }
    return { x, y };
  }

  const uid  = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}`;
  const base = () => ({ fill: currentFill, stroke: currentStroke, strokeWidth: currentStrokeWidth, opacity: 1, visible: true, name: '' });

  // ── Interaction mode ──────────────────────────────────────────────────────
  let mode: 'idle'|'drawing'|'freehand'|'area-select'|'moving'|'resizing'|'rotating'|'edit-node'|'pan'|'curve-drag' = 'idle';
  let shiftDown = false;

  // Drawing
  let drawStart: Point = { x:0, y:0 };

  // Area-select
  let selRect: { x1:number; y1:number; x2:number; y2:number } | null = null;

  // Multi-shape move: snapshot every selected shape at drag start
  let moveShapes: Shape[] = [];
  let moveStart:  Point   = { x:0, y:0 };

  // Resize
  let resizeHandle     = '';
  let resizeOrigBounds: BoundingBox | null = null;
  let resizeStart:     Point = { x:0, y:0 };
  let resizeShapeId    = '';

  // Rotation
  interface RotateState {
    shapeId:       string;
    origin:        Point;
    startAngle:    number;   // radians
    startRotation: number;   // degrees
  }
  let rotateState: RotateState | null = null;
  /** True when the cursor is over a rotation zone — drives cursor CSS */
  let isOverRotationZone = false;

  // Edit-node
  let editNodeIdx  = -1;
  let editShapeId  = '';

  // Pan
  let panStart:      Point = { x:0, y:0 };
  let panScrollStart = { left:0, top:0 };

  // Polygon
  let polygonCursor:  Point | null = null;
  let snapToPolyStart = false;

  // Curve state machine
  type CurvePhase = 'idle' | 'has-start' | 'drag-end';
  let curvePhase:      CurvePhase = 'idle';
  let curveStart:      Point = { x:0, y:0 };
  let curveDragOrigin: Point = { x:0, y:0 };
  let curveLiveCursor: Point = { x:0, y:0 };

  // Text editing (foreignObject)
  let textEditingId:   string | null = null;
  let textEditContent: string        = '';
  let textEditorEl:    HTMLTextAreaElement | null = null;

  $: textEditShape = (textEditingId
    ? (shapes.find(s => s.id === textEditingId) ?? null)
    : null) as TextShape | null;

  // foreignObject position: must match <text> rendering exactly.
  // SVG text-anchor shifts the visual text left (middle) or fully left (end)
  // of the x coordinate. The foreignObject must follow the same logic using
  // text-align, and its x must be offset so the text pixels land identically.
  $: foW = textEditShape ? Math.max(300, textEditShape.fontSize * 20) : 300;
  $: foX = (() => {
    if (!textEditShape) return 0;
    if (textEditShape.textAnchor === 'middle') return textEditShape.x - foW / 2;
    if (textEditShape.textAnchor === 'end')    return textEditShape.x - foW;
    return textEditShape.x; // 'start'
  })();
  // y is the SVG baseline. Offset upward ~1em to place top of foreignObject
  // at the visual cap-line of the first text line.
  $: foY = textEditShape ? textEditShape.y - textEditShape.fontSize * 1.0 : 0;

  // ── Handle constants ──────────────────────────────────────────────────────
  const HANDLE_R      = 5;
  const HANDLE_HIT    = 10;
  /** Extra px (in screen-space) beyond the corner handle that triggers rotation */
  const ROTATE_ZONE   = 20;

  // ── Rotation helpers ──────────────────────────────────────────────────────

  /**
   * Returns the pivot point used for both ShapeRenderer's transform attribute
   * and the Canvas handle/rotation rendering. Must stay in sync with ShapeRenderer.
   */
  function getRotationOrigin(shape: Shape): Point {
    switch (shape.type) {
      case 'rectangle': return { x: shape.x + shape.width/2,  y: shape.y + shape.height/2 };
      case 'ellipse':   return { x: shape.cx,                 y: shape.cy                 };
      case 'line':      return { x: (shape.x1 + shape.x2)/2,  y: (shape.y1 + shape.y2)/2 };
      default: {
        const b = getShapeBounds(shape);
        return { x: b.x + b.width/2, y: b.y + b.height/2 };
      }
    }
  }

  /** Rotate point `pt` around `centre` by `deg` degrees (positive = clockwise in SVG). */
  function rotatePoint(pt: Point, centre: Point, deg: number): Point {
    const rad = deg * Math.PI / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const dx = pt.x - centre.x, dy = pt.y - centre.y;
    return { x: centre.x + dx*cos - dy*sin, y: centre.y + dx*sin + dy*cos };
  }

  // ── Group bounds ──────────────────────────────────────────────────────────
  function getGroupBounds(list: Shape[]): BoundingBox | null {
    if (!list.length) return null;
    const boxes = list.map(s => getShapeBounds(s));
    const x  = Math.min(...boxes.map(b => b.x));
    const y  = Math.min(...boxes.map(b => b.y));
    const x2 = Math.max(...boxes.map(b => b.x + b.width));
    const y2 = Math.max(...boxes.map(b => b.y + b.height));
    return { x, y, width: x2 - x || 1, height: y2 - y || 1 };
  }

  // ── Handle / rotation zone detection ─────────────────────────────────────

  function findHandle(pt: Point): { id: string; handle: string } | null {
    if (selectedTool !== 'transform' || selectedShapeIds.length !== 1) return null;
    const shp = shapes.find(s => s.id === selectedShapeIds[0]);
    if (!shp) return null;
    const rot   = (shp as any).rotation ?? 0;
    const orig  = getRotationOrigin(shp);
    // Untransform the cursor into the shape's local (unrotated) frame
    const local = rot ? rotatePoint(pt, orig, -rot) : pt;
    const hs    = getHandlePositions(getShapeBounds(shp));
    const hitR  = HANDLE_HIT / zoom;
    for (const [name, pos] of Object.entries(hs)) {
      if (Math.hypot(local.x - pos.x, local.y - pos.y) < hitR)
        return { id: shp.id, handle: name };
    }
    return null;
  }

  /**
   * Returns the shape id if the cursor is in the rotation zone (a ring of ROTATE_ZONE px
   * just outside the four corner handles), otherwise null.
   * The ring is tested in the shape's local (unrotated) frame.
   */
  function findRotationZone(pt: Point): string | null {
    if (selectedTool !== 'transform' || selectedShapeIds.length !== 1) return null;
    const shp = shapes.find(s => s.id === selectedShapeIds[0]);
    if (!shp) return null;
    const rot   = (shp as any).rotation ?? 0;
    const orig  = getRotationOrigin(shp);
    const local = rot ? rotatePoint(pt, orig, -rot) : pt;
    const b     = getShapeBounds(shp);
    const inner = HANDLE_HIT  / zoom;
    const outer = (HANDLE_HIT + ROTATE_ZONE) / zoom;
    const corners = [
      { x: b.x,          y: b.y           },
      { x: b.x + b.width, y: b.y           },
      { x: b.x,           y: b.y + b.height },
      { x: b.x + b.width, y: b.y + b.height },
    ];
    return corners.some(c => {
      const d = Math.hypot(local.x - c.x, local.y - c.y);
      return d >= inner && d <= outer;
    }) ? shp.id : null;
  }

  function findEditNode(pt: Point): number {
    if (selectedTool !== 'edit' || selectedShapeIds.length !== 1) return -1;
    const shp  = shapes.find(s => s.id === selectedShapeIds[0]);
    if (!shp) return -1;
    const hitR = HANDLE_HIT / zoom;
    return getEditNodes(shp).findIndex(n => Math.hypot(pt.x - n.x, pt.y - n.y) < hitR);
  }

  // ── Curve helpers ─────────────────────────────────────────────────────────
  function buildCurvePreviewShape(start: Point, endFixed: Point, drag: Point, sub: string): Shape {
    let pathData = '', points: Point[] = [];
    if (sub === 'arc') {
      pathData = generateArcPath([start, drag]);
      points   = [start, drag];
    } else if (sub === 'quadratic-bezier') {
      const cp = { x: 2*endFixed.x - drag.x, y: 2*endFixed.y - drag.y };
      pathData = generateQuadraticBezierPath([start, cp, endFixed]);
      points   = [start, cp, endFixed];
    } else {
      const cp2 = { x: 2*endFixed.x - drag.x, y: 2*endFixed.y - drag.y };
      const cp1 = {
        x: start.x + (endFixed.x - start.x)*0.33 + (start.x - cp2.x)*0.1,
        y: start.y + (endFixed.y - start.y)*0.33 + (start.y - cp2.y)*0.1,
      };
      pathData = generateCubicBezierPath([start, cp1, cp2, endFixed]);
      points   = [start, cp1, cp2, endFixed];
    }
    return { id:'temp', type: sub as any, pathData, points, ...base(), fill:'none' };
  }

  function buildCurveGuideShape(start: Point, cursor: Point, sub: string): Shape {
    if (sub === 'arc')
      return { id:'temp', type:'arc', pathData: generateArcPath([start, cursor]),
               points:[start, cursor], ...base(), fill:'none' };
    return { id:'temp', type: sub as any,
             pathData:`M ${start.x},${start.y} L ${cursor.x},${cursor.y}`,
             points:[start, cursor], ...base(), fill:'none' };
  }

  function commitCurveSegment(sub: string, drag: Point): Point {
    let pathData = '', points: Point[] = [], endPt = curveDragOrigin;
    if (sub === 'arc') {
      endPt = drag;
      pathData = generateArcPath([curveStart, endPt]);
      points   = [curveStart, endPt];
    } else if (sub === 'quadratic-bezier') {
      const cp = { x: 2*curveDragOrigin.x - drag.x, y: 2*curveDragOrigin.y - drag.y };
      pathData = generateQuadraticBezierPath([curveStart, cp, curveDragOrigin]);
      points   = [curveStart, cp, curveDragOrigin];
    } else {
      const cp2 = { x: 2*curveDragOrigin.x - drag.x, y: 2*curveDragOrigin.y - drag.y };
      const cp1 = {
        x: curveStart.x + (curveDragOrigin.x - curveStart.x)*0.33 + (curveStart.x - cp2.x)*0.1,
        y: curveStart.y + (curveDragOrigin.y - curveStart.y)*0.33 + (curveStart.y - cp2.y)*0.1,
      };
      pathData = generateCubicBezierPath([curveStart, cp1, cp2, curveDragOrigin]);
      points   = [curveStart, cp1, cp2, curveDragOrigin];
    }
    editorStore.addShape({ id:uid(), type: sub as any, pathData, points, ...base(), fill:'none' });
    return endPt;
  }

  // ── Preview updates ───────────────────────────────────────────────────────
  function updatePreview(pt: Point) {
    // Curve tool
    if (selectedTool === 'curve') {
      curveLiveCursor = pt;
      if (curvePhase === 'has-start')
        editorStore.setTempShape(buildCurveGuideShape(curveStart, pt, curveSubTool));
      else if (curvePhase === 'drag-end')
        editorStore.setTempShape(buildCurvePreviewShape(curveStart, curveDragOrigin, pt, curveSubTool));
      return;
    }

    if (mode === 'idle') {
      // Track rotation zone for cursor
      isOverRotationZone = !!findRotationZone(pt);

      if (selectedTool === 'polygon' && polygonPoints.length > 0) {
        const fp = polygonPoints[0];
        snapToPolyStart = Math.hypot(pt.x - fp.x, pt.y - fp.y) * zoom < 12;
        polygonCursor   = snapToPolyStart ? fp : pt;
        editorStore.setTempShape({
          id:'temp', type:'polygon', closed:false,
          points:[...polygonPoints, polygonCursor], ...base()
        });
      }
      return;
    }

    if (mode === 'drawing') {
      const shp = buildTempShape(drawStart, pt);
      if (shp) editorStore.setTempShape(shp);
      return;
    }
    if (mode === 'freehand') {
      editorStore.addPolygonPoint(pt);
      editorStore.setTempShape({ id:'temp', type:'freehand',
        pathData: generateFreehandPath([...polygonPoints, pt]),
        points: [...polygonPoints, pt], ...base(), fill:'none' });
      return;
    }
    if (mode === 'area-select' && selRect) {
      selRect = { ...selRect, x2: pt.x, y2: pt.y };
      editorStore.setTempShape({ id:'temp', type:'rectangle',
        x: Math.min(selRect.x1,selRect.x2), y: Math.min(selRect.y1,selRect.y2),
        width: Math.abs(selRect.x2-selRect.x1), height: Math.abs(selRect.y2-selRect.y1),
        fill:'rgba(74,144,217,0.08)', stroke:'#4A90D9', strokeWidth:1/zoom,
        opacity:1, visible:true, name:'' } as any);
      return;
    }
    if (mode === 'moving' && moveShapes.length > 0) {
      const dx = pt.x - moveStart.x, dy = pt.y - moveStart.y;
      for (const shp of moveShapes)
        editorStore.previewShape(shp.id, translateShape(shp, dx, dy) as Partial<Shape>);
      return;
    }
    if (mode === 'resizing' && resizeOrigBounds && resizeShapeId) {
      const dp = { x: pt.x - resizeStart.x, y: pt.y - resizeStart.y };
      const nb = resizeBounds(resizeOrigBounds, resizeHandle, dp);
      editorStore.previewShape(resizeShapeId,
        applyBoundsToShape(shapes.find(s => s.id === resizeShapeId)!, nb) as Partial<Shape>);
      return;
    }
    if (mode === 'rotating' && rotateState) {
      const currentAngle = Math.atan2(pt.y - rotateState.origin.y, pt.x - rotateState.origin.x);
      const deltaDeg = (currentAngle - rotateState.startAngle) * (180 / Math.PI);
      const newRot   = ((rotateState.startRotation + deltaDeg) % 360 + 360) % 360;
      editorStore.previewShape(rotateState.shapeId, { rotation: newRot } as any);
      return;
    }
    if (mode === 'edit-node' && editShapeId && editNodeIdx >= 0) {
      const shp = shapes.find(s => s.id === editShapeId);
      if (shp) editorStore.previewShape(editShapeId, applyNodeMove(shp, editNodeIdx, pt) as Partial<Shape>);
      return;
    }
    if (mode === 'pan' && canvasAreaEl) {
      canvasAreaEl.scrollLeft = panScrollStart.left - (pt.x - panStart.x) * zoom;
      canvasAreaEl.scrollTop  = panScrollStart.top  - (pt.y - panStart.y) * zoom;
      return;
    }
  }

  // ── Build temp shape while dragging ──────────────────────────────────────
  function buildTempShape(start: Point, cur: Point): Shape | null {
    switch (selectedTool) {
      case 'line': {
        let x2 = cur.x, y2 = cur.y;
        if (shiftDown) {
          const d = Math.hypot(cur.x-start.x, cur.y-start.y);
          const a = Math.round(Math.atan2(cur.y-start.y, cur.x-start.x)/(Math.PI/4))*(Math.PI/4);
          x2 = start.x + d*Math.cos(a); y2 = start.y + d*Math.sin(a);
        }
        return { id:'temp', type:'line', x1:start.x, y1:start.y, x2, y2, ...base(), fill:'none' };
      }
      case 'rectangle': {
        let w = cur.x-start.x, h = cur.y-start.y;
        if (shiftDown) { const sz=Math.max(Math.abs(w),Math.abs(h)); w=w<0?-sz:sz; h=h<0?-sz:sz; }
        return { id:'temp', type:'rectangle',
          x:w>=0?start.x:start.x+w, y:h>=0?start.y:start.y+h,
          width:Math.abs(w)||1, height:Math.abs(h)||1, ...base() };
      }
      case 'ellipse': {
        let dx = cur.x-start.x, dy = cur.y-start.y;
        if (shiftDown) { const sz=Math.max(Math.abs(dx),Math.abs(dy)); dx=dx<0?-sz:sz; dy=dy<0?-sz:sz; }
        return { id:'temp', type:'ellipse',
          cx:start.x+dx/2, cy:start.y+dy/2,
          rx:Math.abs(dx)/2||1, ry:Math.abs(dy)/2||1, ...base() };
      }
      default: return null;
    }
  }

  // ── SVG mousedown ─────────────────────────────────────────────────────────
  function onSvgMouseDown(e: MouseEvent) {
    if (textEditingId && e.target !== textEditorEl) commitTextEdit();

    if (e.button === 1) {
      e.preventDefault();
      const pt = svgPt(e);
      mode = 'pan'; panStart = pt;
      panScrollStart = { left: canvasAreaEl?.scrollLeft??0, top: canvasAreaEl?.scrollTop??0 };
      return;
    }
    if (e.button === 2 && selectedTool === 'zoom') { editorStore.setZoom(zoom - 0.25); return; }
    if (e.button !== 0) return;

    const pt = svgPt(e);

    // ── Curve ──────────────────────────────────────────────────────────────
    if (selectedTool === 'curve') {
      if (curvePhase === 'idle') {
        curveStart = pt; curvePhase = 'has-start'; curveLiveCursor = pt;
        editorStore.setTempShape(null);
      } else if (curvePhase === 'has-start') {
        curveDragOrigin = pt; curveLiveCursor = pt;
        curvePhase = 'drag-end'; mode = 'curve-drag';
      }
      return;
    }

    // ── Transform ─────────────────────────────────────────────────────────
    if (selectedTool === 'transform') {
      // 1. Resize handle?
      const h = findHandle(pt);
      if (h) {
        const shp = shapes.find(s => s.id === h.id)!;
        editorStore.beginDrag();
        mode = 'resizing'; resizeHandle = h.handle;
        resizeOrigBounds = getShapeBounds(shp); resizeStart = pt; resizeShapeId = h.id;
        return;
      }
      // 2. Rotation zone (outside corner handles)?
      const rotId = findRotationZone(pt);
      if (rotId) {
        const shp  = shapes.find(s => s.id === rotId)!;
        const orig = getRotationOrigin(shp);
        editorStore.beginDrag();
        mode = 'rotating';
        rotateState = {
          shapeId:       rotId,
          origin:        orig,
          startAngle:    Math.atan2(pt.y - orig.y, pt.x - orig.x),
          startRotation: (shp as any).rotation ?? 0,
        };
        return;
      }
      // 3. Shape hit?
      const hit = [...shapes].reverse().find(s => isPointInShape(pt, s));
      if (hit) {
        if (!selectedShapeIds.includes(hit.id)) {
          if (e.shiftKey) editorStore.toggleSelect(hit.id);
          else            editorStore.selectShape(hit.id);
        }
        editorStore.beginDrag();
        mode = 'moving'; moveStart = pt;
        moveShapes = shapes.filter(s => editorStore.getState().selectedShapeIds.includes(s.id));
        return;
      }
      if (!e.shiftKey) editorStore.deselectAll();
      mode = 'area-select'; selRect = { x1:pt.x, y1:pt.y, x2:pt.x, y2:pt.y };
      return;
    }

    // ── Edit ───────────────────────────────────────────────────────────────
    if (selectedTool === 'edit') {
      const ni = findEditNode(pt);
      if (ni >= 0) {
        editorStore.beginDrag();
        mode = 'edit-node'; editNodeIdx = ni; editShapeId = selectedShapeIds[0];
        return;
      }
      editorStore.selectShape([...shapes].reverse().find(s => isPointInShape(pt, s))?.id ?? null);
      return;
    }

    // ── Freehand ───────────────────────────────────────────────────────────
    if (selectedTool === 'freehand') {
      editorStore.clearPolygonPoints(); editorStore.addPolygonPoint(pt);
      editorStore.setDrawing(true); mode = 'freehand'; return;
    }

    // ── Zoom ───────────────────────────────────────────────────────────────
    if (selectedTool === 'zoom') { editorStore.setZoom(zoom + 0.25); return; }

    // ── Basic shapes ───────────────────────────────────────────────────────
    if (['line','rectangle','ellipse'].includes(selectedTool)) {
      drawStart = pt; editorStore.setDrawing(true); mode = 'drawing'; return;
    }
  }

  // ── SVG click ─────────────────────────────────────────────────────────────
  function onSvgClick(e: MouseEvent) {
    if (e.button !== 0) return;
    const pt = svgPt(e);
    if (selectedTool === 'text') {
      const hit = [...shapes].reverse().find(s => s.type === 'text' && isPointInShape(pt, s));
      if (hit) openTextEdit(hit.id, (hit as any).content ?? '');
      else     placeText(pt);
      return;
    }
    if (selectedTool === 'polygon') {
      // In polyline mode, snapping to start doesn't close — only double-click does
      if (snapToPolyStart && polygonPoints.length >= 3 && polygonClosed) { closePolygon(); return; }
      editorStore.addPolygonPoint(pt); return;
    }
  }

  function onSvgDblClick(e: MouseEvent) {
    if (selectedTool === 'polygon' && polygonPoints.length >= 3) {
      e.preventDefault(); closePolygon(); return;
    }
    if (selectedTool === 'transform') {
      const pt  = svgPt(e);
      const hit = [...shapes].reverse().find(s => s.type === 'text' && isPointInShape(pt, s));
      if (hit) openTextEdit(hit.id, (hit as any).content ?? '');
    }
  }

  function closePolygon() {
    // Respects the Polygon/Polyline mode toggle from CommandBar
    editorStore.addShape({ id:uid(), type:'polygon', closed: polygonClosed, points:polygonPoints, ...base() });
    editorStore.clearPolygonPoints();
    polygonCursor = null; snapToPolyStart = false; mode = 'idle';
  }

  // ── Text editing ──────────────────────────────────────────────────────────
  function placeText(pt: Point) {
    const id = uid();
    editorStore.addShape({ id, type:'text', x:pt.x, y:pt.y, content:'',
      ...textProps, ...base(), fill:currentFill, stroke:'none', strokeWidth:0 } as any);
    openTextEdit(id, '');
  }

  function openTextEdit(id: string, content: string) {
    textEditingId   = id;
    textEditContent = content;
    editorStore.selectShape(id);
    editorStore.startTextEdit(id);
    tick().then(() => {
      if (textEditorEl) { textEditorEl.focus(); textEditorEl.select(); _syncEditorHeight(); }
    });
  }

  function _syncEditorHeight() {
    if (!textEditorEl) return;
    textEditorEl.style.height = 'auto';
    textEditorEl.style.height = textEditorEl.scrollHeight + 'px';
  }

  function onTextInput() {
    textEditContent = textEditorEl?.value ?? '';
    _syncEditorHeight();
  }

  function commitTextEdit() {
    if (!textEditingId) return;
    if (textEditContent.trim()) editorStore.updateTextContent(textEditingId, textEditContent);
    else                        editorStore.deleteShape(textEditingId);
    textEditingId = null; textEditContent = '';
    editorStore.endTextEdit();
  }

  function onTextKeyDown(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'Escape')                            { e.preventDefault(); commitTextEdit(); }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commitTextEdit(); }
  }

  // ── Window mousemove / mouseup ─────────────────────────────────────────────
  function onWindowMouseMove(e: MouseEvent) {
    editorStore.updateCursor(e.clientX, e.clientY);
    updatePreview(svgPt(e));
  }

  function onWindowMouseUp(e: MouseEvent) {
    if (e.button === 1) { if (mode === 'pan') mode = 'idle'; return; }
    if (e.button !== 0) return;
    const pt = svgPt(e);

    if (mode === 'curve-drag') {
      const endPt    = commitCurveSegment(curveSubTool, pt);
      const SNAP_R   = 14 / zoom;
      // If the end point is very close to the original start of this segment,
      // treat it as a "close" gesture: reset to idle rather than chaining.
      const snapped  = Math.hypot(endPt.x - curveStart.x, endPt.y - curveStart.y) < SNAP_R;
      curvePhase = snapped ? 'idle' : 'has-start';
      if (!snapped) curveStart = endPt;
      mode = 'idle';
      editorStore.setTempShape(null); return;
    }
    if (mode === 'freehand') {
      if (polygonPoints.length > 1)
        editorStore.addShape({ id:uid(), type:'freehand',
          pathData: generateFreehandPath(polygonPoints), points: polygonPoints, ...base(), fill:'none' });
      editorStore.setDrawing(false); editorStore.clearPolygonPoints(); mode = 'idle'; return;
    }
    if (mode === 'drawing') {
      if (tempShape) editorStore.addShape({ ...tempShape, id:uid() });
      editorStore.setDrawing(false); editorStore.setTempShape(null); mode = 'idle'; return;
    }
    if (mode === 'area-select' && selRect) {
      const box = { x:Math.min(selRect.x1,selRect.x2), y:Math.min(selRect.y1,selRect.y2),
        width:Math.abs(selRect.x2-selRect.x1), height:Math.abs(selRect.y2-selRect.y1) };
      editorStore.selectShapes(shapes.filter(s => {
        const b = getShapeBounds(s);
        return b.x+b.width>=box.x && b.x<=box.x+box.width && b.y+b.height>=box.y && b.y<=box.y+box.height;
      }).map(s => s.id));
      selRect = null; editorStore.setTempShape(null); mode = 'idle'; return;
    }
    if (mode === 'moving')    { editorStore.commitChange(); moveShapes = [];   mode = 'idle'; return; }
    if (mode === 'resizing')  { editorStore.commitChange(); resizeOrigBounds = null; mode = 'idle'; return; }
    if (mode === 'rotating')  { editorStore.commitChange(); rotateState = null; isOverRotationZone = false; mode = 'idle'; return; }
    if (mode === 'edit-node') { editorStore.commitChange(); editNodeIdx = -1; editShapeId = ''; mode = 'idle'; return; }
    if (mode === 'pan')       { mode = 'idle'; return; }
    mode = 'idle';
  }

  // ── Keyboard ──────────────────────────────────────────────────────────────
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Shift') shiftDown = true;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === 'z' && !e.shiftKey) { e.preventDefault(); editorStore.undo(); return; }
    if (mod && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); editorStore.redo(); return; }
    if (mod && e.key === 'c') { editorStore.copySelected(); return; }
    if (mod && e.key === 'x') { editorStore.cutSelected();  return; }
    if (mod && e.key === 'v') { editorStore.paste();        return; }
    if (mod && e.key === 'a') { e.preventDefault(); editorStore.selectAll(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedShapeIds.length && !textEditingId) {
      e.preventDefault(); editorStore.deleteSelectedShapes();
    }
    if (e.key === 'Escape') {
      // Cancel active rotation without saving
      if (mode === 'rotating') {
        editorStore.cancelDrag();
        rotateState = null; isOverRotationZone = false; mode = 'idle'; return;
      }
      if (textEditingId) { commitTextEdit(); return; }
      // ESC always saves an in-progress polygon as an open polyline regardless of mode
      if (selectedTool === 'polygon' && polygonPoints.length >= 2)
        editorStore.addShape({ id:uid(), type:'polygon', closed:false, points:polygonPoints, ...base() });
      curvePhase = 'idle';
      editorStore.clearPolygonPoints(); editorStore.setDrawing(false); editorStore.setTempShape(null);
      polygonCursor = null; snapToPolyStart = false; mode = 'idle';
    }
  }
  function onKeyUp(e: KeyboardEvent) { if (e.key === 'Shift') shiftDown = false; }

  // ── Derived ───────────────────────────────────────────────────────────────
  $: bgClass = background === 'transparent-light' ? 'bg-transparent-light'
             : background === 'transparent-dark'  ? 'bg-transparent-dark'
             : background === 'black'             ? 'bg-black' : 'bg-white';

  $: cursor = selectedTool === 'transform'
    ? (mode === 'moving'   ? 'move'
     : mode === 'rotating' ? 'grabbing'
     : isOverRotationZone  ? 'grab'
     : 'default')
    : selectedTool === 'edit'  ? 'crosshair'
    : selectedTool === 'zoom'  ? 'zoom-in'
    : selectedTool === 'text'  ? 'text'
    : 'crosshair';

  $: primaryShape = selectedShapeIds.length === 1
    ? shapes.find(s => s.id === selectedShapeIds[0]) ?? null
    : null;

  $: groupBounds = selectedShapeIds.length > 1
    ? getGroupBounds(shapes.filter(s => selectedShapeIds.includes(s.id)))
    : null;

  $: curveHandleCP = (() => {
    if (selectedTool !== 'curve' || curvePhase !== 'drag-end' || curveSubTool === 'arc') return null;
    return { x: 2*curveDragOrigin.x - curveLiveCursor.x, y: 2*curveDragOrigin.y - curveLiveCursor.y };
  })();

  $: arcCircle = (() => {
    if (selectedTool !== 'curve' || curveSubTool !== 'arc' || curvePhase === 'idle') return null;
    const ep = curvePhase === 'drag-end' ? curveDragOrigin : curveLiveCursor;
    const cx = (curveStart.x + ep.x)/2, cy = (curveStart.y + ep.y)/2;
    const r  = Math.hypot(ep.x - curveStart.x, ep.y - curveStart.y) / 2;
    return r > 2 ? { cx, cy, r } : null;
  })();
</script>

<svelte:window
  on:mousemove={onWindowMouseMove}
  on:mouseup={onWindowMouseUp}
  on:keydown={onKeyDown}
  on:keyup={onKeyUp}
/>

<svg
  bind:this={svgEl}
  width={canvasWidth}
  height={canvasHeight}
  class="svge-canvas {bgClass}"
  style="cursor:{cursor}; transform:scale({zoom}); transform-origin:0 0; display:block; flex-shrink:0;"
  on:mousedown={onSvgMouseDown}
  on:click={onSvgClick}
  on:dblclick={onSvgDblClick}
  on:contextmenu|preventDefault
>
  <!-- Background image — rendered first, behind everything -->
  {#if canvasBgImage}
    <image
      href={canvasBgImage}
      x="0" y="0"
      width={canvasWidth} height={canvasHeight}
      preserveAspectRatio="xMidYMid slice"
      pointer-events="none"
    />
  {/if}

  <!-- Grid -->
  {#if gridEnabled}
    <defs>
      <pattern id="svge-grid-pat" width={gridSizeX} height={gridSizeY} patternUnits="userSpaceOnUse">
        <path d="M {gridSizeX} 0 L 0 0 0 {gridSizeY}" fill="none"
          style="stroke: var(--border-color)" stroke-width={0.5/zoom} />
      </pattern>
    </defs>
    <rect width={canvasWidth} height={canvasHeight} fill="url(#svge-grid-pat)" pointer-events="none" />
  {/if}

  <!-- Shapes -->
  {#each shapes as shape (shape.id)}
    <ShapeRenderer
      {shape}
      isSelected={selectedShapeIds.includes(shape.id)}
      isTemp={false}
      {selectedTool}
      {zoom}
      isEditing={shape.id === textEditingId}
    />
  {/each}

  <!-- Temp / preview shape -->
  {#if tempShape}
    <ShapeRenderer shape={tempShape} isTemp isSelected={false} {selectedTool} {zoom} />
  {/if}

  <!-- ── In-canvas text editor ──────────────────────────────────────────── -->
  {#if textEditShape}
    {@const fs   = textEditShape.fontSize}
    {@const rot  = (textEditShape as any).rotation ?? 0}
    {@const orig = getRotationOrigin(textEditShape)}
    <foreignObject
      x={foX} y={foY}
      width={foW} height={fs * 10}
      transform={rot ? `rotate(${rot} ${orig.x} ${orig.y})` : undefined}
    >
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <textarea
        bind:this={textEditorEl}
        class="svg-text-editor"
        style="
          font-family:{textEditShape.fontFamily};
          font-size:{fs}px;
          font-weight:{textEditShape.fontWeight};
          font-style:{textEditShape.fontStyle};
          text-decoration:{textEditShape.textDecoration === 'underline' ? 'underline' : 'none'};
          text-align:{textEditShape.textAnchor === 'end' ? 'right' : textEditShape.textAnchor === 'middle' ? 'center' : 'left'};
          color:{textEditShape.fill};
          line-height:1.25;
          padding-top:{fs * 0.1}px;
        "
        value={textEditContent}
        on:input={onTextInput}
        on:keydown={onTextKeyDown}
        on:blur={commitTextEdit}
        placeholder="Type here…"
        spellcheck="false"
      ></textarea>
    </foreignObject>
  {/if}

  <!-- ── Transform handles ──────────────────────────────────────────────── -->
  {#if selectedTool === 'transform' && primaryShape}
    {@const bounds  = getShapeBounds(primaryShape)}
    {@const handles = getHandlePositions(bounds)}
    {@const rot     = (primaryShape as any).rotation ?? 0}
    {@const orig    = getRotationOrigin(primaryShape)}
    {@const ri      = 11/zoom}   <!-- rotation indicator radius -->

    <g transform={rot ? `rotate(${rot} ${orig.x} ${orig.y})` : undefined}>
      <!-- Bounding box outline -->
      <rect
        x={bounds.x - 1/zoom} y={bounds.y - 1/zoom}
        width={bounds.width + 2/zoom} height={bounds.height + 2/zoom}
        fill="none" stroke="#4A90D9" stroke-width={1/zoom}
        stroke-dasharray="{4/zoom},{3/zoom}" pointer-events="none"
      />
      <!--
        Rotation zone indicators: small curved arcs just outside each corner.
        They brighten when the cursor is in the zone to hint at the affordance.
      -->
      <!-- NW -->
      <path d="M {bounds.x}   {bounds.y-ri} A {ri} {ri} 0 0 0 {bounds.x-ri}   {bounds.y}"
        fill="none" stroke="#4A90D9" stroke-width={1.5/zoom}
        stroke-linecap="round"
        opacity={isOverRotationZone ? 0.75 : 0.2} pointer-events="none" />
      <!-- NE -->
      <path d="M {bounds.x+bounds.width+ri} {bounds.y}   A {ri} {ri} 0 0 0 {bounds.x+bounds.width}   {bounds.y-ri}"
        fill="none" stroke="#4A90D9" stroke-width={1.5/zoom}
        stroke-linecap="round"
        opacity={isOverRotationZone ? 0.75 : 0.2} pointer-events="none" />
      <!-- SE -->
      <path d="M {bounds.x+bounds.width}   {bounds.y+bounds.height+ri} A {ri} {ri} 0 0 0 {bounds.x+bounds.width+ri} {bounds.y+bounds.height}"
        fill="none" stroke="#4A90D9" stroke-width={1.5/zoom}
        stroke-linecap="round"
        opacity={isOverRotationZone ? 0.75 : 0.2} pointer-events="none" />
      <!-- SW -->
      <path d="M {bounds.x-ri} {bounds.y+bounds.height}   A {ri} {ri} 0 0 0 {bounds.x}   {bounds.y+bounds.height+ri}"
        fill="none" stroke="#4A90D9" stroke-width={1.5/zoom}
        stroke-linecap="round"
        opacity={isOverRotationZone ? 0.75 : 0.2} pointer-events="none" />

      <!-- Resize handles -->
      {#each Object.entries(handles) as [name, pos]}
        <rect
          x={pos.x - HANDLE_R/zoom} y={pos.y - HANDLE_R/zoom}
          width={HANDLE_R*2/zoom} height={HANDLE_R*2/zoom}
          rx={1/zoom}
          fill="white" stroke="#4A90D9" stroke-width={1.5/zoom}
          style="cursor:{name.includes('n')&&name.includes('e')||name.includes('s')&&name.includes('w')?'nesw-resize':name.includes('n')&&name.includes('w')||name.includes('s')&&name.includes('e')?'nwse-resize':name==='n'||name==='s'?'ns-resize':'ew-resize'}"
          pointer-events="all"
        />
      {/each}
    </g>
  {/if}

  <!-- Group selection box (multi-select) -->
  {#if selectedTool === 'transform' && groupBounds}
    <rect
      x={groupBounds.x - 2/zoom} y={groupBounds.y - 2/zoom}
      width={groupBounds.width + 4/zoom} height={groupBounds.height + 4/zoom}
      fill="none" stroke="#4A90D9" stroke-width={1.5/zoom}
      stroke-dasharray="{4/zoom},{3/zoom}" pointer-events="none"
    />
  {/if}

  <!-- ── Edit nodes ─────────────────────────────────────────────────────── -->
  {#if selectedTool === 'edit' && primaryShape}
    {#each getEditNodes(primaryShape) as pt, i}
      <!--
        Special nodes get an orange diamond handle so they're visually distinct:
          Rectangle node 8  → corner-radius control
          Arc      node 2   → curvature midpoint handle
      -->
      {#if (primaryShape.type === 'rectangle' && i === 8) || (primaryShape.type === 'arc' && i === 2)}
        <rect
          x={pt.x - 4.5/zoom} y={pt.y - 4.5/zoom}
          width={9/zoom} height={9/zoom}
          transform="rotate(45 {pt.x} {pt.y})"
          fill={editNodeIdx === i && mode === 'edit-node' ? '#e67e22' : 'white'}
          stroke="#e67e22" stroke-width={1.5/zoom}
          style="cursor:move" pointer-events="all"
        />
      {:else}
        <circle
          cx={pt.x} cy={pt.y} r={HANDLE_R/zoom}
          fill={editNodeIdx === i && mode === 'edit-node' ? '#4A90D9' : 'white'}
          stroke="#4A90D9" stroke-width={1.5/zoom}
          style="cursor:move" pointer-events="all"
        />
      {/if}
    {/each}
  {/if}

  <!-- Polygon preview -->
  {#if selectedTool === 'polygon' && polygonPoints.length > 0 && polygonCursor}
    <line
      x1={polygonPoints[polygonPoints.length-1].x} y1={polygonPoints[polygonPoints.length-1].y}
      x2={polygonCursor.x} y2={polygonCursor.y}
      stroke={snapToPolyStart && polygonClosed ? '#27ae60' : '#e74c3c'}
      stroke-width={1.5/zoom} stroke-dasharray="{5/zoom},{3/zoom}" />
    {#if snapToPolyStart && polygonClosed}
      <circle cx={polygonPoints[0].x} cy={polygonPoints[0].y}
        r={8/zoom} fill="none" stroke="#27ae60" stroke-width={2/zoom} />
    {/if}
    {#each polygonPoints as p}
      <circle cx={p.x} cy={p.y} r={3.5/zoom} fill="#e74c3c" stroke="white" stroke-width={1/zoom} />
    {/each}
  {/if}

  <!-- Arc ghost circle -->
  {#if arcCircle}
    <circle cx={arcCircle.cx} cy={arcCircle.cy} r={arcCircle.r}
      fill="none" stroke="#9b59b6" stroke-width={1/zoom}
      stroke-dasharray="{4/zoom},{3/zoom}" opacity="0.35" pointer-events="none" />
  {/if}

  <!-- Bezier handle lines + diamond -->
  {#if selectedTool === 'curve' && curvePhase === 'drag-end' && curveSubTool !== 'arc' && curveHandleCP}
    <line x1={curveDragOrigin.x} y1={curveDragOrigin.y}
      x2={curveLiveCursor.x} y2={curveLiveCursor.y}
      stroke="#9b59b6" stroke-width={1/zoom} stroke-dasharray="{3/zoom},{2/zoom}" opacity="0.6"
      pointer-events="none" />
    <line x1={curveDragOrigin.x} y1={curveDragOrigin.y}
      x2={curveHandleCP.x} y2={curveHandleCP.y}
      stroke="#9b59b6" stroke-width={1.5/zoom} pointer-events="none" />
    <rect x={curveHandleCP.x - 4/zoom} y={curveHandleCP.y - 4/zoom}
      width={8/zoom} height={8/zoom}
      transform="rotate(45 {curveHandleCP.x} {curveHandleCP.y})"
      fill="#9b59b6" stroke="white" stroke-width={1/zoom} pointer-events="none" />
    <circle cx={curveLiveCursor.x} cy={curveLiveCursor.y} r={4/zoom}
      fill="white" stroke="#9b59b6" stroke-width={1.5/zoom} pointer-events="none" />
  {/if}

  <!-- Curve start dot -->
  {#if selectedTool === 'curve' && curvePhase !== 'idle'}
    <circle cx={curveStart.x} cy={curveStart.y} r={4.5/zoom}
      fill="#9b59b6" stroke="white" stroke-width={1.5/zoom} pointer-events="none" />
  {/if}
  <!-- Curve end ring -->
  {#if selectedTool === 'curve' && curvePhase === 'drag-end'}
    <circle cx={curveDragOrigin.x} cy={curveDragOrigin.y} r={4.5/zoom}
      fill="white" stroke="#9b59b6" stroke-width={2/zoom} pointer-events="none" />
  {/if}
</svg>

<style>
  .svge-canvas {
    box-shadow: 0 4px 24px rgba(0,0,0,0.18);
    outline: none;
    user-select: none;
  }

  :global(.svg-text-editor) {
    display: block;
    width: 100%;
    min-height: 1.3em;
    background: rgba(74, 144, 217, 0.06);
    border: 1.5px dashed #4A90D9;
    border-radius: 2px;
    outline: none;
    resize: none;
    overflow: hidden;
    padding: 0 2px;
    box-sizing: border-box;
    scrollbar-width: none;
    white-space: pre-wrap;
    word-break: break-word;
    caret-color: currentColor;
  }
  :global(.svg-text-editor::-webkit-scrollbar) { display: none; }
  :global(.svg-text-editor::placeholder) {
    color: #4A90D9;
    opacity: 0.4;
    font-style: italic;
  }
</style>