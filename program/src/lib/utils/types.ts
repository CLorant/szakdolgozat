/**
 * @file The document model: shapes, nodes, styles and the document itself.
 */

export type ShapeType = 'line' | 'rectangle' | 'ellipse' | 'path' | 'text' | 'image' | 'group';

/** The tools (see tools/catalog.ts for their names and keys). 'transform' is the Select tool. */
export type ToolType =
  | 'transform' | 'edit' | 'line' | 'rectangle' | 'ellipse'
  | 'polygon' | 'freehand' | 'pen' | 'arc' | 'text' | 'pan' | 'scissors' | 'blob';

export type PropertyType =
  | 'fill' | 'stroke' | 'geometry' | 'text-props' | 'layers' | 'history' | 'canvas' | '';

export type BackgroundType = 'white' | 'black' | 'transparent-light' | 'transparent-dark' | 'custom';
/** How the background image fills the canvas: cover = crop to fill, contain = fit inside, stretch = distort to fill. */
export type BgFit = 'cover' | 'contain' | 'stretch';

export type LineCap  = 'butt' | 'round' | 'square';
export type LineJoin = 'miter' | 'round' | 'bevel';

export interface Point       { x: number; y: number; }
export interface BoundingBox { x: number; y: number; width: number; height: number; }

/**
 * One node of a path. Handles are ABSOLUTE coordinates (not offsets), which makes
 * translate / scale / mirror a plain point-mapping. `null` = no handle (straight side).
 * `smooth` = moving one handle keeps the opposite one collinear.
 */
export interface PathNode {
  x: number;
  y: number;
  hin:  Point | null;
  hout: Point | null;
  smooth: boolean;
  /**
   * Compound paths: `true` on the FIRST node of every contour except the first one.
   * A path with more than one contour is always closed (glyph outlines, donuts).
   */
  sub?: true;
}

export interface BaseShape {
  id:              string;
  type:            ShapeType;
  name:            string;
  visible:         boolean;
  /** Locked: drawn, but cannot be selected, cut or merged on the canvas (Objects panel: the padlock). Missing = unlocked. */
  locked?:         true;
  fill:            string;   // '#rrggbb' | '#rrggbbaa' | 'none'
  stroke:          string;
  strokeWidth:     number;
  opacity:         number;   // 0..1
  /** Degrees, clockwise, around the centre of the shape's local bounds. */
  rotation:        number;
  /**
   * Rotation origin (Geometry → Origin, the crosshair of the Select tool): the point the shape turns about when it
   * is rotated in the editor, as fractions of its local box (0.5, 0.5 = the centre; missing = the centre). It is an
   * editing aid like Inkscape's rotation centre: the stored `rotation` is always about the box centre, so the SVG
   * output is the same whatever the origin.
   */
  origin?:         { x: number; y: number };
  strokeLinecap:   LineCap;
  strokeLinejoin:  LineJoin;
  strokeDasharray: string;   // '' = solid
  /** Where the dash pattern starts, in user units (SVG stroke-dashoffset). Missing = 0. */
  strokeDashoffset?: number;
}
/** Everything in BaseShape except the discriminant. */
export type BaseProps = Omit<BaseShape, 'type'>;

export interface LineShape extends BaseShape {
  type: 'line';
  x1: number; y1: number; x2: number; y2: number;
}
export interface RectShape extends BaseShape {
  type: 'rectangle';
  x: number; y: number; width: number; height: number;
  rx: number; ry: number;
}
export interface EllipseShape extends BaseShape {
  type: 'ellipse';
  cx: number; cy: number; rx: number; ry: number;
}
/** Polygon, polyline, freehand, Bézier and imported paths — one model. */
export interface PathShape extends BaseShape {
  type:   'path';
  nodes:  PathNode[];
  closed: boolean;
  /** How overlapping / nested contours are filled. Absent = 'nonzero' (SVG default). */
  fillRule?: 'nonzero' | 'evenodd';
}
export interface TextProps {
  fontFamily:     string;
  fontSize:       number;
  /** CSS numeric weight, 1–1000 (400 regular, 700 bold). */
  fontWeight:     number;
  fontStyle:      'normal' | 'italic';
  /** Decoration lines, space separated: any of underline, overline, line-through ('' = none). */
  textDecoration: string;
  textAnchor:     'start' | 'middle' | 'end';
  letterSpacing:  number;
  /** Extra space added to every space character, px. */
  wordSpacing:    number;
  /** Distance between baselines, as a multiple of the font size. */
  lineHeight:     number;
}
export interface TextShape extends BaseShape, TextProps {
  type:    'text';
  x:       number;   // anchor x
  y:       number;   // baseline of the first line
  content: string;
  /** Mirrored about the centre of the text box (drawn with a transform; text cannot be mirrored any other way). */
  flipX?:  boolean;
  flipY?:  boolean;
}

/**
 * A group (<g>). Its children keep their own coordinates (document space, as if the group were
 * not rotated). `rotation` rotates the whole group around the centre of its children's bounds;
 * `opacity` and `visible` apply to the group as a whole. fill / stroke / … are unused on the group
 * itself (the style panel applies them to every descendant).
 */
export interface GroupShape extends BaseShape {
  type: 'group';
  children: Shape[];
}

/**
 * A bitmap (<image>), stretched to its box. `href` is a data: URL, so the drawing stays one self-contained file.
 * fill / stroke are unused. Mirroring is a transform, as for text.
 */
export interface ImageShape extends BaseShape {
  type:   'image';
  x: number; y: number; width: number; height: number;
  href:   string;
  /** How the bitmap fits its box (SVG preserveAspectRatio). Missing = 'none': stretched to the box. */
  preserveAspectRatio?: string;
  flipX?: boolean;
  flipY?: boolean;
}

export type Shape = LineShape | RectShape | EllipseShape | PathShape | TextShape | ImageShape | GroupShape;

/** Partial update accepted by editor.updateShape(s). */
type Body<S> = Omit<S, 'id' | 'type'>;
export type ShapePatch = Partial<
  Body<RectShape> & Body<LineShape> & Body<EllipseShape> & Body<PathShape> & Body<TextShape> & Body<ImageShape> & Body<GroupShape>
>;

export interface Style {
  fill: string; stroke: string; strokeWidth: number;
  strokeLinecap?: LineCap; strokeLinejoin?: LineJoin; strokeDasharray?: string; strokeDashoffset?: number;
}

/** A draggable overlay node produced by getEditNodes(), in the shape's LOCAL (unrotated) frame. */
export interface EditNode {
  id:    string;   // stable id, interpreted by moveEditNode()
  kind:  'anchor' | 'hin' | 'hout' | 'radius';
  x:     number;
  y:     number;
  node?: number;   // owning path node index (handles only)
}

/** A guide line dragged out of a ruler: axis 'x' = vertical line at x = pos, 'y' = horizontal line at y = pos. */
export interface RulerGuide { axis: 'x' | 'y'; pos: number; }

export interface DocumentState {
  shapes:     Shape[];
  width:      number;
  height:     number;
  background: BackgroundType;
  /** data: URL, '' = none */
  bgImage:    string;
  /** Color of background 'custom' ('#rrggbb'). Absent = white. */
  bgColor?:   string;
  /** Placement of bgImage. Absent = 'cover'. */
  bgFit?:     BgFit;
  /** Ruler guides (editor only: never exported). */
  guides?:    RulerGuide[];
}
