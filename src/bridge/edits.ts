/**
 * Bridge tools: workspace edits and formatting.
 */

import * as vscode from "vscode";
import { boundedJson, resolvePath } from "./helpers.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerEditTools(defineTool: Function, Type: any, tools: any[]): void {

  tools.push(
    defineTool({
      name: "vscode_apply_workspace_edit",
      label: "VS Code Apply Workspace Edit",
      executionMode: "sequential",
      description:
        "Apply explicit range-based text replacements through VS Code so open editor buffers stay in sync.",
      parameters: Type.Object({
        edits: Type.Array(Type.Object({
          filePath: Type.String({ description: "Absolute or workspace-relative file path" }),
          range: Type.Object({
            start: Type.Object({ line: Type.Number(), character: Type.Number() }),
            end: Type.Object({ line: Type.Number(), character: Type.Number() }),
          }),
          newText: Type.String({ description: "Replacement text" }),
        }), { description: "List of text replacements to apply through VS Code" }),
      }, { additionalProperties: false }),
      execute: async (_toolCallId: string, params: {
        edits: Array<{
          filePath: string;
          range: { start: { line: number; character: number }; end: { line: number; character: number } };
          newText: string;
        }>;
      }) => {
        const wsEdit = new vscode.WorkspaceEdit();
        for (const edit of params.edits) {
          const resolved = resolvePath(edit.filePath);
          if (!resolved) { continue; }
          const uri = vscode.Uri.file(resolved);
          const range = new vscode.Range(
            new vscode.Position(edit.range.start.line, edit.range.start.character),
            new vscode.Position(edit.range.end.line, edit.range.end.character),
          );
          wsEdit.replace(uri, range, edit.newText);
        }
        const applied = await vscode.workspace.applyEdit(wsEdit);
        const savedPaths = new Set<string>();
        for (const edit of params.edits) {
          const resolved = resolvePath(edit.filePath);
          if (!resolved || savedPaths.has(resolved)) { continue; }
          savedPaths.add(resolved);
          const doc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === resolved);
          if (doc?.isDirty) { await doc.save(); }
        }
        return {
          content: [{ type: "text", text: boundedJson({ applied, editCount: params.edits.length, saved: savedPaths.size }) }],
          details: {},
        };
      },
    }),
  );

  tools.push(
    defineTool({
      name: "vscode_format_document",
      label: "VS Code Format Document",
      executionMode: "sequential",
      description: "Run the active VS Code document formatter for a file.",
      parameters: Type.Object({
        filePath: Type.String({ description: "Absolute or workspace-relative file path" }),
      }, { additionalProperties: false }),
      execute: async (_toolCallId: string, params: { filePath: string }) => {
        const resolved = resolvePath(params.filePath);
        if (!resolved) {
          return { content: [{ type: "text", text: "Error: no file path provided" }], details: {} };
        }
        const uri = vscode.Uri.file(resolved);
        const edits = await vscode.commands.executeCommand("vscode.executeFormatDocumentProvider", uri, {});
        if (edits && (edits as vscode.TextEdit[]).length > 0) {
          const wsEdit = new vscode.WorkspaceEdit();
          for (const e of edits as vscode.TextEdit[]) {
            wsEdit.replace(uri, e.range, e.newText);
          }
          await vscode.workspace.applyEdit(wsEdit);
        }
        return {
          content: [{ type: "text", text: boundedJson({ formatted: resolved, editsApplied: (edits as vscode.TextEdit[])?.length ?? 0 }) }],
          details: {},
        };
      },
    }),
  );
}
