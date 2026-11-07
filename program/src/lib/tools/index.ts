/**
 * @file Creates one instance of every tool.
 */
import type { ToolType } from '../utils/types';
import type { Tool, ToolContext } from './types';
import { createSelectTool } from './select';
import { createEditTool } from './edit';
import { createShapeTool } from './shapeTool';
import { createPolygonTool } from './polygon';
import { createPenTool } from './pen';
import { createArcTool } from './arc';
import { createFreehandTool } from './freehand';
import { createTextTool } from './text';
import { createPanTool } from './pan';
import { createScissorsTool } from './scissors';
import { createBlobTool } from './blob';

export type { Tool, ToolContext, PointerInfo } from './types';

/** One instance per tool; each keeps its own private state. */
export function createTools(ctx: ToolContext): Record<ToolType, Tool> {
  return {
    transform: createSelectTool(ctx),
    edit:      createEditTool(ctx),
    line:      createShapeTool('line'),
    rectangle: createShapeTool('rectangle'),
    ellipse:   createShapeTool('ellipse'),
    polygon:   createPolygonTool(ctx),
    pen:       createPenTool(ctx),
    arc:       createArcTool(ctx),
    freehand:  createFreehandTool(ctx),
    text:      createTextTool(ctx),
    pan:       createPanTool(),
    scissors:  createScissorsTool(ctx),
    blob:      createBlobTool(ctx),
  };
}
