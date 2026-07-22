# Development Guide

## Quick Start

```bash
pnpm install
pnpm run compile      # Type-check + lint + build
pnpm run watch        # Watch mode (extension + webview)
```

Press `F5` in VS Code to launch Extension Development Host.

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm run check-types` | TypeScript type check (extension + webview) |
| `pnpm run lint` | ESLint |
| `pnpm run compile` | check-types + lint + build |
| `pnpm run watch` | Watch mode for development |
| `pnpm run package` | Production build |
| `pnpm run vsix` | Package `.vsix` file |
| `pnpm run test` | Run VS Code tests |
| `pnpm run publish` | Publish to marketplace |

## Project Structure

```
pi-code-gui-dev/
├── src/
│   ├── extension.ts           # VS Code extension entry
│   ├── pi-service.ts          # Pi SDK lifecycle
│   ├── bridge-tools.ts        # VS Code bridge tools
│   ├── pi-package-service.ts  # Package manager
│   ├── pi-packages-tree-provider.ts
│   ├── phase3-commands.ts     # SDK-dependent commands
│   ├── phase4-commands.ts     # SDK-dependent commands
│   ├── logger.ts
│   ├── types.ts
│   ├── test-fixture.ts
│   ├── test/extension.test.ts
│   ├── shared/protocol.ts     # Webview <-> extension protocol
│   └── webview/
│       ├── main.ts            # Webview entry
│       ├── panel.ts           # Webview panel
│       ├── components/        # UI components
│       ├── handlers/          # Event handlers
│       ├── render/            # Rendering engine
│       ├── tools/             # Tool renderers
│       ├── state.ts
│       ├── highlight.ts
│       └── debug.ts
├── media/                     # Static assets
├── dist/
│   └── extension.js           # Bundled output
├── agent-wiki/                # Architecture docs (maintained by upstream)
└── package.json
```

## Architecture Overview

```
VS Code Extension Host                    Webview
┌─────────────────────┐         ┌──────────────────┐
│  extension.ts       │ postMessage            │
│    ↓                │ ◄──────► │  main.ts         │
│  PiService          │         │  components/*    │
│    ↓                │         │  render/*        │
│  pi SDK (runtime)   │         │  tools/*         │
│    ↓                │         └──────────────────┘
│  Bridge Tools       │
│  (vscode_*)         │
└─────────────────────┘
```

Pi SDK is loaded dynamically at runtime from the global npm install (`@earendil-works/pi-coding-agent`).

## Bridge Tools

The extension registers 16+ tools prefixed with `vscode_` that call VS Code APIs directly:

- `vscode_get_editor_state` — Active editor, selection, workspace folders
- `vscode_get_selection` — Current selection text and coordinates
- `vscode_get_diagnostics` — LSP diagnostics for file or workspace
- `vscode_get_open_editors` — Open editors and tabs
- `vscode_get_workspace_folders` — Workspace folders
- `vscode_open_file` — Open file in editor
- `vscode_check_document_dirty` — Check unsaved changes
- `vscode_save_document` — Save document
- `vscode_get_document_symbols` — Outline symbols
- `vscode_get_definitions` — Symbol definitions
- `vscode_get_hover` — Hover info (types, signatures)
- `vscode_get_references` — Symbol references
- `vscode_get_workspace_symbols` — Workspace symbol search
- `vscode_get_code_actions` — Code actions/quick fixes
- `vscode_apply_workspace_edit` — Apply text edits
- `vscode_format_document` — Format document

## Versioning

Current version: 0.0.55
Published on VS Code Marketplace: `NimbleTron.pi-code-gui`

## SDK Resolution

The extension finds the pi SDK by scanning:
1. Project-local `.pi/npm/`
2. PATH-derived npm global prefixes
3. Windows AppData (`%APPDATA%/npm`)
4. Legacy fallbacks (`~/.npm-global`, `~/.local`, nvm)

See `resolvePiPackagePath()` in `src/pi-service.ts`.
