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
│   ├── extension.ts              # VS Code extension entry
│   ├── chat-view.ts              # Sidebar ChatViewProvider (replaces WebviewPanel)
│   ├── webview-panel.ts          # Legacy Editor Panel (deprecated, kept for compat)
│   ├── pi-service.ts             # Pi SDK lifecycle (1952→now ~1900 lines)
│   ├── bridge-tools.ts           # VS Code bridge tools (24 lines, aggregation)
│   ├── services/                 # Service layer
│   │   ├── auth.ts               # AuthService (login/logout/API key)
│   │   ├── model.ts              # ModelService (switch/thinking/defaults)
│   │   ├── prompts.ts            # Prompt templates
│   │   └── sdk.ts                # SDK path resolution
│   ├── bridge/                   # Bridge tool implementations
│   │   ├── editor.ts             # Editor/file tools
│   │   ├── lsp.ts                # LSP/diagnostics tools
│   │   ├── edits.ts              # Edit/format tools
│   │   └── helpers.ts            # Shared utilities
│   ├── shared/protocol.ts        # Zod-validated webview↔extension messages
│   ├── types.ts                  # Type definitions
│   ├── logger.ts                 # Logging
│   └── webview/
│       ├── main.ts               # Webview entry, event wiring
│       ├── template.ts           # HTML template (extracted from webview-panel.ts)
│       ├── state.ts              # Global state
│       ├── locale.ts             # i18n (Chinese/English)
│       ├── highlight.ts          # Code highlighting
│       ├── handlers/             # Message handlers (14 sections)
│       │   ├── index.ts          # Main handler + message router
│       │   └── dom.ts            # DOM element references (centralized)
│       ├── components/           # UI components
│       │   ├── code-block.ts
│       │   ├── dialog.ts
│       │   ├── thinking-block.ts
│       │   └── ...
│       ├── render/               # Rendering engine
│       │   ├── engine.ts         # Core render logic
│       │   └── html.ts           # HTML utilities
│       └── tools/                # Tool renderers
│           └── index.ts
├── media/
│   ├── style.css                 # CSS (design token system, ~650 lines)
│   └── ...                       # Icons, images
├── dist/
│   └── extension.js              # Bundled output
├── SESSION_NOTES.md              # Development session log
├── AGENTS.md                     # Project overview for agents
├── CONVENTIONS.md                # Coding conventions
├── DEVELOPMENT.md                # This file
└── package.json
```

## Architecture Overview

```
VS Code Extension Host                  Sidebar Webview
┌─────────────────────────┐      ┌──────────────────────────┐
│  extension.ts           │      │  main.ts                  │
│    ├─ ChatViewProvider  │ msg  │    ├─ handlers/index.ts   │
│    ├─ PiService (×N)    │◄───► │    ├─ render/engine.ts    │
│    ├─ ModelService      │      │    ├─ components/*        │
│    ├─ AuthService       │      │    └─ tools/*             │
│    └─ Bridge Tools      │      ├──────────────────────────┤
│         (16+ vscode_*)  │      │  nav-bar (tabs + pills)   │
│                         │      │  chat-container (scroll)  │
│  pi SDK (runtime)       │      │  input-area (card)        │
│  SessionManager         │      │  status-bar (metrics)     │
└─────────────────────────┘      └──────────────────────────┘

Sidebar webview uses WebviewViewProvider (always visible).
Pi SDK dynamically loaded from global npm install.
Session tabs managed in extension host, rendered in webview.
```

## Design Tokens (CSS)

All styles use semantic CSS custom properties:
- Spacing: `--pi-space-xs/sm/md/lg/xl/2xl`
- Radius: `--pi-radius-sm/md/lg/pill`
- Font: `--pi-font-xs/sm/md/base` (base from `--vscode-chat-font-size`)
- Colors: `--pi-bg-*`, `--pi-fg-*`, `--pi-border*` → VS Code theme vars
- Animation: `--pi-tran` (0.12s ease)

## Session Tab Model

```
ChatViewDeps
├── getActiveSession() → SessionTab
├── getAllSessions() → SessionTab[]
├── switchSession(id)
├── newSession()
├── closeSession(id)
└── onSessionChange → EventEmitter

SessionTab { id, name, piService, sessionPath? }
```

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
