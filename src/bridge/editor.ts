/**
 * Bridge tools: editor state and file operations.
 */

import * as vscode from "vscode";
import { boundedJson, getWorkspaceFolders, workspaceRelativePath, resolvePath } from "./helpers.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerEditorTools(defineTool: Function, Type: any, tools: any[]): void {

  tools.push(
    defineTool({
      name: "vscode_get_editor_state",
      label: "VS Code Editor State",
      description:
        "Get the active editor, current selection, workspace folders, and open editors from VS Code.",
      parameters: Type.Object({}, { additionalProperties: false }),
      execute: async () => {
        const editor = vscode.window.activeTextEditor;
        const selection = editor?.selection;
        const doc = editor?.document;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
        const state: any = {
          workspaceFolders: getWorkspaceFolders(),
          openEditors: vscode.window.visibleTextEditors.map((e) => ({
            filePath: e.document.uri.fsPath,
            languageId: e.document.languageId,
            isDirty: e.document.isDirty,
            isUntitled: e.document.isUntitled,
          })),
          activeEditor: doc
            ? {
                filePath: doc.uri.fsPath,
                languageId: doc.languageId,
                isDirty: doc.isDirty,
                isUntitled: doc.isUntitled,
                lineCount: doc.lineCount,
              }
            : null,
          selection: selection
            ? {
                start: { line: selection.start.line, character: selection.start.character },
                end: { line: selection.end.line, character: selection.end.character },
                isEmpty: selection.isEmpty,
                text: doc?.getText(selection) ?? "",
              }
            : null,
        };

        return { content: [{ type: "text", text: boundedJson(state) }], details: {} };
      },
    }),
  );

  tools.push(
    defineTool({
      name: "vscode_get_selection",
      label: "VS Code Current Selection",
      description:
        "Get the current VS Code editor selection, including text, file path, and coordinates.",
      parameters: Type.Object({}, { additionalProperties: false }),
      execute: async () => {
        const editor = vscode.window.activeTextEditor;
        const doc = editor?.document;
        const selection = editor?.selection;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result: any = {
          filePath: doc?.uri.fsPath ?? null,
          languageId: doc?.languageId ?? null,
          selection: selection
            ? {
                start: { line: selection.start.line, character: selection.start.character },
                end: { line: selection.end.line, character: selection.end.character },
                isEmpty: selection.isEmpty,
                text: doc?.getText(selection) ?? "",
              }
            : null,
        };

        return { content: [{ type: "text", text: boundedJson(result) }], details: {} };
      },
    }),
  );

  tools.push(
    defineTool({
      name: "vscode_get_open_editors",
      label: "VS Code Open Editors",
      description: "List open editors and tabs in VS Code.",
      parameters: Type.Object({}, { additionalProperties: false }),
      execute: async () => {
        const activeEditor = vscode.window.activeTextEditor;
        const result = {
          activeFilePath: activeEditor?.document.uri.fsPath ?? null,
          editors: vscode.window.visibleTextEditors.map((e) => ({
            filePath: e.document.uri.fsPath,
            relativePath: workspaceRelativePath(e.document.uri.fsPath),
            languageId: e.document.languageId,
            isDirty: e.document.isDirty,
            isUntitled: e.document.isUntitled,
          })),
        };
        return { content: [{ type: "text", text: boundedJson(result) }], details: {} };
      },
    }),
  );

  tools.push(
    defineTool({
      name: "vscode_get_workspace_folders",
      label: "VS Code Workspace Folders",
      description: "List VS Code workspace folders and metadata for the current window.",
      parameters: Type.Object({}, { additionalProperties: false }),
      execute: async () => ({
        content: [{ type: "text", text: boundedJson({ folders: getWorkspaceFolders(), cwd: process.cwd() }) }],
        details: {},
      }),
    }),
  );

  tools.push(
    defineTool({
      name: "vscode_open_file",
      label: "VS Code Open File",
      description: "Open a file in VS Code and optionally reveal a selection range.",
      executionMode: "sequential",
      parameters: Type.Object({
        filePath: Type.String({ description: "Absolute or workspace-relative file path" }),
        preview: Type.Optional(Type.Boolean({ description: "Open in preview mode" })),
        preserveFocus: Type.Optional(Type.Boolean({ description: "Keep focus in the current editor" })),
        selection: Type.Optional(Type.Object({
          start: Type.Object({
            line: Type.Number({ description: "Zero-based line number" }),
            character: Type.Number({ description: "Zero-based character offset" }),
          }),
          end: Type.Object({
            line: Type.Number({ description: "Zero-based line number" }),
            character: Type.Number({ description: "Zero-based character offset" }),
          }),
        })),
      }, { additionalProperties: false }),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      execute: async (_toolCallId: string, params: any) => {
        const resolved = resolvePath(params.filePath);
        if (!resolved) {
          return { content: [{ type: "text", text: "Error: no file path provided" }], details: {} };
        }
        const uri = vscode.Uri.file(resolved);
        const doc = await vscode.workspace.openTextDocument(uri);
        const sel = params.selection;
        const selection = sel
          ? new vscode.Selection(
              new vscode.Position(sel.start.line, sel.start.character),
              new vscode.Position(sel.end.line, sel.end.character),
            )
          : undefined;
        await vscode.window.showTextDocument(doc, {
          preview: params.preview ?? true,
          preserveFocus: params.preserveFocus ?? false,
          ...(selection ? { selection } : {}),
        });
        return {
          content: [{
            type: "text",
            text: boundedJson({
              opened: resolved,
              relativePath: workspaceRelativePath(resolved),
              languageId: doc.languageId,
              lineCount: doc.lineCount,
            }),
          }],
          details: {},
        };
      },
    }),
  );

  tools.push(
    defineTool({
      name: "vscode_check_document_dirty",
      label: "VS Code Dirty State",
      description: "Check whether a file is open in VS Code and whether it has unsaved changes.",
      parameters: Type.Object({
        filePath: Type.String({ description: "Absolute or workspace-relative file path" }),
      }, { additionalProperties: false }),
      execute: async (_toolCallId: string, params: { filePath: string }) => {
        const resolved = resolvePath(params.filePath);
        if (!resolved) {
          return { content: [{ type: "text", text: boundedJson({ error: "No file path provided" }) }], details: {} };
        }
        const uri = vscode.Uri.file(resolved);
        const editor = vscode.window.visibleTextEditors.find((e) => e.document.uri.fsPath === uri.fsPath);
        return {
          content: [{
            type: "text",
            text: boundedJson({
              filePath: resolved,
              isOpen: !!editor,
              isDirty: editor?.document.isDirty ?? false,
              languageId: editor?.document.languageId ?? null,
            }),
          }],
          details: {},
        };
      },
    }),
  );

  tools.push(
    defineTool({
      name: "vscode_save_document",
      label: "VS Code Save Document",
      executionMode: "sequential",
      description: "Save a document through VS Code so editor buffers and disk stay synchronized.",
      parameters: Type.Object({
        filePath: Type.String({ description: "Absolute or workspace-relative file path" }),
      }, { additionalProperties: false }),
      execute: async (_toolCallId: string, params: { filePath: string }) => {
        const resolved = resolvePath(params.filePath);
        if (!resolved) {
          return { content: [{ type: "text", text: "Error: no file path provided" }], details: {} };
        }
        const uri = vscode.Uri.file(resolved);
        const doc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === uri.fsPath);
        if (doc && doc.isDirty) { await doc.save(); }
        return {
          content: [{ type: "text", text: boundedJson({ saved: resolved, wasDirty: doc?.isDirty ?? false }) }],
          details: {},
        };
      },
    }),
  );
}
