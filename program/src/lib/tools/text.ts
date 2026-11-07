/**
 * @file Text tool: click empty canvas to start a new text, click a text to edit it.
 */
import { documentStore } from '../stores/document';
import { ui } from '../stores/ui';
import { findShape } from '../utils/tree';
import { makeText } from '../utils/shapes';
import type { Tool, ToolContext } from './types';
import { currentStyle } from './common';
import { shapeIdAt } from './hit';

export function createTextTool(ctx: ToolContext): Tool {
  return {
    down(i) {
      const id = shapeIdAt(i.target);
      const hit = id ? findShape(documentStore.get().shapes, id) : undefined;
      if (hit?.type === 'text') { ctx.openText(hit, false); return; }
      const st = currentStyle();
      ctx.openText(makeText(i.p.x, i.p.y, '', ui.get().textProps, { ...st, fill: ui.get().textFill }), true);
    },
    move() {}, up() {},
    escape: () => false,
    deactivate() {},
    busy: () => false,
  };
}
