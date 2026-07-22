/**
 * Bridge tool helpers — shared utility functions for all VS Code bridge tools.
 */

import * as vscode from "vscode";
import * as path from "node:path";

/** Truncate text to reasonable limits (lines + bytes). */
export function truncateText(text: string, maxLines = 2000, maxBytes = 50 * 1024): string {
  const lines = text.split("\n");
  let output = lines.length > maxLines ? lines.slice(0, maxLines).join("\n") : text;
  if (Buffer.byteLength(output, "utf8") > maxBytes) {
    output = Buffer.from(output, "utf8").subarray(0, maxBytes).toString("utf8");
  }
  return output;
}

/** JSON.stringify + bounded to avoid sending massive payloads to LLM. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function boundedJson(value: any): string {
  const text = JSON.stringify(value) ?? "null";
  const lineCount = text.split("\n").length;
  const byteCount = Buffer.byteLength(text, "utf8");
  if (lineCount <= 2000 && byteCount <= 50 * 1024) { return text; }
  return JSON.stringify({
    truncated: true,
    message: "Result exceeded output limits.",
    originalBytes: byteCount,
    originalLines: lineCount,
    resultJsonPrefix: truncateText(text),
  });
}

export function getWorkspaceFolders(): Array<{ uri: string; name: string; index: number }> {
  return (vscode.workspace.workspaceFolders ?? []).map((f) => ({
    uri: f.uri.toString(),
    name: f.name,
    index: f.index,
  }));
}

export function workspaceRelativePath(filePath: string): string {
  if (!filePath) { return ""; }
  const folders = vscode.workspace.workspaceFolders ?? [];
  const roots = [...folders.map((f) => f.uri.fsPath), process.cwd()].filter(Boolean);

  let best = filePath;
  for (const root of roots) {
    const relative = path.relative(root, filePath);
    if (!relative || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
      if (!relative) { return path.basename(filePath); }
      if (relative.length < best.length) { best = relative; }
    }
  }
  return best;
}

export function resolvePath(filePath?: string): string | undefined {
  if (!filePath) { return undefined; }
  if (path.isAbsolute(filePath)) { return filePath; }
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) {
    return path.resolve(folders[0].uri.fsPath, filePath);
  }
  return path.resolve(filePath);
}
