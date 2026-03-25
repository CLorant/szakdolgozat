export type CurveSubType = 'quadratic-bezier' | 'cubic-bezier' | 'arc';
export type PathType    = 'freehand' | CurveSubType;
export type ShapeType   = 'line' | 'rectangle' | 'ellipse' | 'polygon' | 'text' | PathType;

/** All toolbar tools. Curve sub-type is stored separately as curveSubTool. */
export type ToolType = 'transform' | 'edit' | 'line' | 'rectangle' | 'ellipse'
                     | 'polygon'   | 'freehand' | 'curve' | 'text' | 'zoom';

export type PropertyType = 'fill' | 'stroke' | 'geometry' | 'transform' | 'text-props'
                         | 'layers' | 'defs' | 'history' | 'canvas' | '';

export type BackgroundType = 'white' | 'transparent-light' | 'transparent-dark';

export interface Point       { x: number; y: number; }
export interface BoundingBox { x: number; y: number; width: number; height: number; }

export interface BaseShape {
  id:          string;
  type:        ShapeType;
  fill:        string;
  stroke:      string;
  strokeWidth: number;
  opacity:     number;
  visible:     boolean;
  name:        string;
  rotation?:   number;
}

export interface Line extends BaseShape {
  type: 'line';
  x1: number; y1: number; x2: number; y2: number;
}

export interface Rectangle extends BaseShape {
  type: 'rectangle';
  x: number; y: number; width: number; height: number;
  rx?: number; ry?: number;
}

export interface Ellipse extends BaseShape {
  type: 'ellipse';
  cx: number; cy: number; rx: number; ry: number;
}

export interface Polygon extends BaseShape {
  type:   'polygon';
  points: Point[];
  closed: boolean;
}

export interface Path extends BaseShape {
  type:     PathType;
  pathData: string;
  points:   Point[];
}

export interface TextShape extends BaseShape {
  type:           'text';
  x:              number;
  y:              number;
  content:        string;
  fontFamily:     string;
  fontSize:       number;
  fontWeight:     'normal' | 'bold';
  fontStyle:      'normal' | 'italic';
  textDecoration: 'none'   | 'underline';
  textAnchor:     'start'  | 'middle' | 'end';
  letterSpacing:  number;
}

export type Shape = Line | Rectangle | Ellipse | Polygon | Path | TextShape;

export interface TextProps {
  fontFamily:     string;
  fontSize:       number;
  fontWeight:     'normal' | 'bold';
  fontStyle:      'normal' | 'italic';
  textDecoration: 'none'   | 'underline';
  textAnchor:     'start'  | 'middle' | 'end';
  letterSpacing:  number;
}