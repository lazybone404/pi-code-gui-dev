/**
 * Prompt and context file builders for the VS Code extension.
 * Standalone functions — no dependencies on PiService state.
 */

import * as path from "node:path";
import * as fs from "node:fs";
import { piWarn } from "../logger.js";

// ── System Prompt ────────────────────────────────────────

/** Build the VS Code-aware system prompt */
export function buildSystemPrompt(): string {
  return `You are a coding assistant running inside VS Code through the Pi Code Gui extension.
You have access to VS Code editor state through bridge tools (prefixed with vscode_)
when they are enabled.

Key information about your environment:
- You are embedded in VS Code as an extension with a webview chat UI.
- When bridge tools are active, you can inspect editor state, diagnostics, symbols,
  hover info, definitions, references, and apply edits through VS Code.
- For reading files, use the read tool (supports offset/limit for large files).
- For editing files, use the edit or write tool.

When the user asks you to fix something:
1. Check diagnostics first if the diagnostics bridge tool is available.
2. Look at the relevant code.
3. Make edits.

Be concise and helpful. Prefer editing existing files over creating new ones.`;
}

// ── Context Files ────────────────────────────────────────

/** Build virtual context files (project guidelines for VS Code context) */
export function buildContextFiles(cwd: string): Array<{ path: string; content: string }> {
  const files: Array<{ path: string; content: string }> = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pkgJson: any = null;
  try {
    const pkgPath = path.join(cwd, "package.json");
    if (fs.existsSync(pkgPath)) {
      pkgJson = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    }
  } catch (e: unknown) { piWarn(`Non-critical failure: ${e instanceof Error ? e.message : String(e)}`); }

  const hasTypeScript = fs.existsSync(path.join(cwd, "tsconfig.json"));
  const hasVite = fs.existsSync(path.join(cwd, "vite.config.ts")) || fs.existsSync(path.join(cwd, "vite.config.js"));
  const hasNextJS = pkgJson?.dependencies?.next || pkgJson?.devDependencies?.next;
  const hasReact = pkgJson?.dependencies?.react || pkgJson?.devDependencies?.react;
  const hasNodeBackend = pkgJson?.dependencies?.express || pkgJson?.dependencies?.fastify || pkgJson?.dependencies?.hono;

  files.push({
    path: "/virtual/vscode-guidelines.md",
    content: `# VS Code Extension Guidelines

## Running in Pi Code Gui
- You are an AI coding assistant inside VS Code.
- The user interacts with you through a chat webview.
- You have access to VS Code editor state through bridge tools when they are enabled.
- Bridge tools (prefixed vscode_) let you inspect open editors, diagnostics, symbols, and more.

## Interaction Tips
- Before making changes, check for diagnostics if the diagnostics tool is available.
- If the user mentions a file, verify it exists and check its content.
- When editing, use the edit or write tool.`,
  });

  if (hasTypeScript) {
    files.push({
      path: "/virtual/project-stack-typescript.md",
      content: `# Project Stack

This project uses TypeScript. Follow these conventions:
- Use strict typing, avoid 'any'.
- Import using ES module syntax.
- Use const over let where possible.
- Prefer async/await over raw promises.`,
    });
  }

  if (hasReact || hasNextJS || hasVite) {
    files.push({
      path: "/virtual/project-stack-frontend.md",
      content: `# Frontend Project Guidelines

This is a ${hasNextJS ? "Next.js" : hasVite ? "Vite-based" : "React"} project.
- Use functional components with hooks.
- Keep components focused and single-responsibility.
- Use proper TypeScript types for props.`,
    });
  }

  if (hasNodeBackend) {
    files.push({
      path: "/virtual/project-stack-backend.md",
      content: `# Backend Project Guidelines

This is a Node.js backend project.
- Handle errors gracefully with proper status codes.
- Validate inputs.
- Use async/await for async operations.`,
    });
  }

  return files;
}

// ── Prompt Templates ─────────────────────────────────────

/** Build custom slash commands for the VS Code extension */
export function buildPromptTemplates(
  createSyntheticSourceInfo: Function,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Array<{ name: string; description: string; filePath: string; sourceInfo: any; content: string }> {
  const syn = (p: string): unknown => createSyntheticSourceInfo(p, { source: "vscode-gui" });

  return [
    {
      name: "fix-diagnostics",
      description: "Fix all diagnostics in open file",
      filePath: "/virtual/prompts/fix-diagnostics.md",
      sourceInfo: syn("/virtual/prompts/fix-diagnostics.md"),
      content: `# Fix Diagnostics

Check the currently open file for diagnostics using vscode_get_diagnostics.
For each diagnostic, analyze the root cause and apply a fix.
Explain what you're fixing and why.`,
    },
    {
      name: "explain-code",
      description: "Explain the code at current cursor position",
      filePath: "/virtual/prompts/explain-code.md",
      sourceInfo: syn("/virtual/prompts/explain-code.md"),
      content: `# Explain Code

Use vscode_get_editor_state to find what file and selection the user has open.
Read the relevant code section and explain what it does, its purpose, and how it works.
If the selection is empty, explain the function/module at the cursor position (use vscode_get_hover for additional context).`,
    },
    {
      name: "refactor",
      description: "Refactor the selected code",
      filePath: "/virtual/prompts/refactor.md",
      sourceInfo: syn("/virtual/prompts/refactor.md"),
      content: `# Refactor

Get the current selection with vscode_get_selection.
Analyze the code and suggest/apply refactoring improvements:
- Extract repeated logic into functions
- Simplify complex expressions
- Improve variable naming
- Add missing type annotations
- Reduce nesting

Apply your changes using edit tools.`,
    },
  ];
}
