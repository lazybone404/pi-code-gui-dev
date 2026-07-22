/**
 * Bridge tools: diagnostics, symbols, definitions, references, hover, code actions.
 */

import * as vscode from "vscode";
import { boundedJson, workspaceRelativePath, resolvePath } from "./helpers.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerLspTools(defineTool: Function, Type: any, tools: any[]): void {

  tools.push(
    defineTool({
      name: "vscode_get_diagnostics",
      label: "VS Code Diagnostics",
      description:
        "Get VS Code diagnostics (LSP, lint, or type errors) for a file or the full workspace.",
      parameters: Type.Object({
        filePath: Type.Optional(Type.String({ description: "Optional absolute or workspace-relative file path" })),
      }, { additionalProperties: false }),
      execute: async (_toolCallId: string, params: { filePath?: string }) => {
        const resolved = resolvePath(params.filePath);
        const allDiagnostics = vscode.languages.getDiagnostics();

        let diagnostics: [vscode.Uri, readonly vscode.Diagnostic[]][];
        if (resolved) {
          const uri = vscode.Uri.file(resolved);
          diagnostics = allDiagnostics.filter(([u]) => u.fsPath === uri.fsPath);
        } else {
          diagnostics = allDiagnostics;
        }

        const result = diagnostics.map(([uri, diags]) => ({
          filePath: uri.fsPath,
          relativePath: workspaceRelativePath(uri.fsPath),
          diagnostics: diags.map((d) => ({
            message: d.message,
            severity: ["error", "warning", "info", "hint"][d.severity],
            range: {
              start: { line: d.range.start.line, character: d.range.start.character },
              end: { line: d.range.end.line, character: d.range.end.character },
            },
            source: d.source,
            code: typeof d.code === "object" ? String(d.code?.value ?? "") : String(d.code ?? ""),
          })),
        }));

        const counts = { errors: 0, warnings: 0, infos: 0, hints: 0 };
        for (const [, diags] of diagnostics) {
          for (const d of diags) {
            if (d.severity === vscode.DiagnosticSeverity.Error) { counts.errors++; }
            else if (d.severity === vscode.DiagnosticSeverity.Warning) { counts.warnings++; }
            else if (d.severity === vscode.DiagnosticSeverity.Information) { counts.infos++; }
            else if (d.severity === vscode.DiagnosticSeverity.Hint) { counts.hints++; }
          }
        }

        return {
          content: [{ type: "text", text: boundedJson({ counts, diagnostics: result }) }],
          details: {},
        };
      },
    }),
  );

  tools.push(
    defineTool({
      name: "vscode_get_code_actions",
      label: "VS Code Code Actions",
      description: "Get code actions or quick fixes available for a file range or selection from VS Code providers.",
      parameters: Type.Object({
        filePath: Type.String({ description: "Absolute or workspace-relative file path" }),
        start: Type.Optional(Type.Object({
          line: Type.Number({ description: "Zero-based line number" }),
          character: Type.Number({ description: "Zero-based character offset" }),
        })),
        end: Type.Optional(Type.Object({
          line: Type.Number({ description: "Zero-based line number" }),
          character: Type.Number({ description: "Zero-based character offset" }),
        })),
      }, { additionalProperties: false }),
      execute: async (_toolCallId: string, params: {
        filePath: string; start?: { line: number; character: number }; end?: { line: number; character: number };
      }) => {
        const resolved = resolvePath(params.filePath);
        if (!resolved) {
          return { content: [{ type: "text", text: "Error: no file path provided" }], details: {} };
        }
        const uri = vscode.Uri.file(resolved);
        const range = params.start
          ? new vscode.Range(
              new vscode.Position(params.start.line, params.start.character),
              new vscode.Position(params.end?.line ?? params.start.line, params.end?.character ?? params.start.character),
            )
          : new vscode.Range(0, 0, 0, 0);
        const actions = await vscode.commands.executeCommand("vscode.executeCodeActionProvider", uri, range);
        return {
          content: [{
            type: "text",
            text: boundedJson(
// eslint-disable-next-line @typescript-eslint/no-explicit-any
              (actions as any[] ?? []).map((a, i) => ({
                id: `action-${i}`,
                title: a.title,
                kind: a.kind?.value ?? "",
                isPreferred: a.isPreferred,
                disabled: a.disabled?.reason ?? null,
              })),
            ),
          }],
          details: {},
        };
      },
    }),
  );

  tools.push(
    defineTool({
      name: "vscode_get_document_symbols",
      label: "VS Code Document Symbols",
      description: "Get outline symbols for a file from the active language server.",
      parameters: Type.Object({
        filePath: Type.String({ description: "Absolute or workspace-relative file path" }),
      }, { additionalProperties: false }),
      execute: async (_toolCallId: string, params: { filePath: string }) => {
        const resolved = resolvePath(params.filePath);
        if (!resolved) {
          return { content: [{ type: "text", text: "Error: no file path provided" }], details: {} };
        }
        const uri = vscode.Uri.file(resolved);
        const symbols = await vscode.commands.executeCommand("vscode.executeDocumentSymbolProvider", uri);
        return {
          content: [{
            type: "text",
            text: boundedJson(
// eslint-disable-next-line @typescript-eslint/no-explicit-any
              (symbols as any[] ?? []).map((s) => ({
                name: s.name,
                kind: vscode.SymbolKind[s.kind],
                location: {
                  filePath: s.location.uri.fsPath,
                  range: {
                    start: { line: s.location.range.start.line, character: s.location.range.start.character },
                    end: { line: s.location.range.end.line, character: s.location.range.end.character },
                  },
                },
                containerName: s.containerName,
              })),
            ),
          }],
          details: {},
        };
      },
    }),
  );

  tools.push(
    defineTool({
      name: "vscode_get_definitions",
      label: "VS Code Definitions",
      description: "Get symbol definitions from VS Code at a given file position.",
      parameters: Type.Object({
        filePath: Type.String({ description: "Absolute or workspace-relative file path" }),
        position: Type.Object({
          line: Type.Number({ description: "Zero-based line number" }),
          character: Type.Number({ description: "Zero-based character offset" }),
        }),
      }, { additionalProperties: false }),
      execute: async (_toolCallId: string, params: { filePath: string; position: { line: number; character: number } }) => {
        const resolved = resolvePath(params.filePath);
        if (!resolved) {
          return { content: [{ type: "text", text: "Error: no file path provided" }], details: {} };
        }
        const uri = vscode.Uri.file(resolved);
        const position = new vscode.Position(params.position.line, params.position.character);
        const defs = await vscode.commands.executeCommand("vscode.executeDefinitionProvider", uri, position);
        return {
          content: [{
            type: "text",
            text: boundedJson(
// eslint-disable-next-line @typescript-eslint/no-explicit-any
              (defs as any[] ?? []).map((d) => ({
                filePath: d.uri.fsPath,
                relativePath: workspaceRelativePath(d.uri.fsPath),
                range: {
                  start: { line: d.range.start.line, character: d.range.start.character },
                  end: { line: d.range.end.line, character: d.range.end.character },
                },
              })),
            ),
          }],
          details: {},
        };
      },
    }),
  );

  tools.push(
    defineTool({
      name: "vscode_get_hover",
      label: "VS Code Hover",
      description: "Get hover information like inferred types, signatures, and docs from VS Code at a given file position.",
      parameters: Type.Object({
        filePath: Type.String({ description: "Absolute or workspace-relative file path" }),
        position: Type.Object({
          line: Type.Number({ description: "Zero-based line number" }),
          character: Type.Number({ description: "Zero-based character offset" }),
        }),
      }, { additionalProperties: false }),
      execute: async (_toolCallId: string, params: { filePath: string; position: { line: number; character: number } }) => {
        const resolved = resolvePath(params.filePath);
        if (!resolved) {
          return { content: [{ type: "text", text: "Error: no file path provided" }], details: {} };
        }
        const uri = vscode.Uri.file(resolved);
        const position = new vscode.Position(params.position.line, params.position.character);
        const raw : unknown = await vscode.commands.executeCommand("vscode.executeHoverProvider", uri, position);
        const hovers: vscode.Hover[] = Array.isArray(raw) ? raw as vscode.Hover[] : [];
        return {
          content: [{
            type: "text",
            text: boundedJson(hovers.map((h) => ({
              contents: h.contents.map((c) => {
                if (typeof c === "string") { return c; }
                if (typeof c === "object" && "value" in c) { return c.value; }
                if (typeof c === "object" && "language" in c) {
                  const mc = c as { language: string; value: string };
                  return `\`\`\`${mc.language}\n${mc.value}\n\`\`\``;
                }
                return String(c);
              }),
              range: h.range ? {
                start: { line: h.range.start.line, character: h.range.start.character },
                end: { line: h.range.end.line, character: h.range.end.character },
              } : null,
            }))),
          }],
          details: {},
        };
      },
    }),
  );

  tools.push(
    defineTool({
      name: "vscode_get_references",
      label: "VS Code References",
      description: "Get symbol references from VS Code at a given file position.",
      parameters: Type.Object({
        filePath: Type.String({ description: "Absolute or workspace-relative file path" }),
        position: Type.Object({
          line: Type.Number({ description: "Zero-based line number" }),
          character: Type.Number({ description: "Zero-based character offset" }),
        }),
      }, { additionalProperties: false }),
      execute: async (_toolCallId: string, params: { filePath: string; position: { line: number; character: number } }) => {
        const resolved = resolvePath(params.filePath);
        if (!resolved) {
          return { content: [{ type: "text", text: "Error: no file path provided" }], details: {} };
        }
        const uri = vscode.Uri.file(resolved);
        const position = new vscode.Position(params.position.line, params.position.character);
        const refs = await vscode.commands.executeCommand("vscode.executeReferenceProvider", uri, position);
        return {
          content: [{
            type: "text",
            text: boundedJson(
// eslint-disable-next-line @typescript-eslint/no-explicit-any
              (refs as any[] ?? []).map((r) => ({
                filePath: r.uri.fsPath,
                relativePath: workspaceRelativePath(r.uri.fsPath),
                range: {
                  start: { line: r.range.start.line, character: r.range.start.character },
                  end: { line: r.range.end.line, character: r.range.end.character },
                },
              })),
            ),
          }],
          details: {},
        };
      },
    }),
  );

  tools.push(
    defineTool({
      name: "vscode_get_workspace_symbols",
      label: "VS Code Workspace Symbols",
      description: "Search workspace symbols globally through VS Code language providers.",
      parameters: Type.Object({
        query: Type.String({ description: "Workspace symbol search query" }),
      }, { additionalProperties: false }),
      execute: async (_toolCallId: string, params: { query: string }) => {
        const symbols = await vscode.commands.executeCommand("vscode.executeWorkspaceSymbolProvider", params.query);
        return {
          content: [{
            type: "text",
            text: boundedJson(
// eslint-disable-next-line @typescript-eslint/no-explicit-any
              (symbols as any[] ?? []).map((s) => ({
                name: s.name,
                kind: vscode.SymbolKind[s.kind],
                location: {
                  filePath: s.location.uri.fsPath,
                  relativePath: workspaceRelativePath(s.location.uri.fsPath),
                  range: {
                    start: { line: s.location.range.start.line, character: s.location.range.start.character },
                    end: { line: s.location.range.end.line, character: s.location.range.end.character },
                  },
                },
                containerName: s.containerName,
              })),
            ),
          }],
          details: {},
        };
      },
    }),
  );
}
