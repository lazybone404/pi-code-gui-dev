/**
 * Bridge tools — give the AI agent visibility into VS Code editor state.
 * Aggregates tools from separate category modules.
 */

import { registerEditorTools } from "./bridge/editor.js";
import { registerLspTools } from "./bridge/lsp.js";
import { registerEditTools } from "./bridge/edits.js";

/**
 * Creates the VS Code bridge tools using the pi SDK defineTool + Typebox.
 * Returns the full list for passing to craftAgent's customTools option.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createBridgeTools(defineTool: Function, Type: any): any[] {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: any[] = [];

  registerEditorTools(defineTool, Type, tools);
  registerLspTools(defineTool, Type, tools);
  registerEditTools(defineTool, Type, tools);

  return tools;
}
