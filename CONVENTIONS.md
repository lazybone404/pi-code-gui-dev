# Development & Code Conventions

## 1. Git

### Branch Strategy

```
main          — stable releases
dev           — active development
feat/<name>   — feature branches (optional, merge to dev)
fix/<name>    — hotfix branches (optional, merge to dev)
```

### Commit Format (Conventional Commits)

```
<type>: <short summary>

[optional body with details]
```

Types:

| Type | When |
|------|------|
| `feat` | New feature (user-facing) |
| `fix` | Bug fix |
| `refactor` | Code change, no feature/fix |
| `chore` | Build, deps, tooling |
| `docs` | Documentation only |
| `test` | Add or update tests |
| `style` | Formatting, whitespace (no logic change) |
| `i18n` | Translation / locale changes |

Examples:
```
feat: add Chinese UI support via vscode.l10n
fix: Windows ESM import fails on absolute paths
refactor: replace authStorage shim with direct ModelRuntime calls
```

### Commit Rules

- One logical change per commit
- Write in English
- Keep summary line under 72 characters
- Use imperative mood ("fix", not "fixed" or "fixes")

---

## 2. TypeScript

### Compiler Options

Already enforced via `tsconfig.json` (upstream strict rules):
- `strict: true`
- `noImplicitReturns: true`
- `noFallthroughCasesInSwitch: true`
- `noUncheckedIndexedAccess: true`
- `isolatedModules: true`
- `forceConsistentCasingInFileNames: true`

### Naming

| Thing | Convention | Example |
|-------|-----------|---------|
| Files | kebab-case | `bridge-tools.ts`, `webview-panel.ts` |
| Classes | PascalCase | `PiService`, `SessionWindow` |
| Interfaces | PascalCase | `PiSdk`, `InstallStatus` |
| Types (aliases) | PascalCase | `EventListener`, `PromptOptions` |
| Functions | camelCase | `resolvePiPackagePath()`, `createBridgeTools()` |
| Constants | UPPER_SNAKE_CASE or camelCase (file-local) | `CONFIG_DIR_NAME`, `truncateText` |
| Private members | camelCase, no `_` prefix | `modelRuntime`, `settingsManager` |
| Boolean variables | `is`, `has`, `should` prefix | `isStreaming`, `hasApiKey`, `shouldCompact` |

### Imports

- Group in this order: Node built-ins → npm packages → local modules
- Use `.js` extension for local ESM imports
- No barrel imports from index files unless they are official SDK entry points

```typescript
import * as path from "node:path";
import * as vscode from "vscode";
import { piLog } from "./logger.js";
```

### Types

- Prefer `interface` over `type` for object shapes
- Use `type` for unions, intersections, and function signatures
- Every function must have explicit return type
- Avoid `any` whenever possible; use `unknown` with narrowing
- When `any` is unavoidable (dynamic SDK imports), document with `// eslint-disable-next-line` and explain why

---

## 3. ESLint

Upstream rules are inherited and enforced. Key rules:

- `@typescript-eslint/no-explicit-any`: error
- `@typescript-eslint/no-unused-vars`: error (prefix unused with `_`)
- `@typescript-eslint/explicit-function-return-type`: error
- `curly`: error (always use braces with if/for/while)
- `no-floating-promises`: error

### Adding Exceptions

When `any` is unavoidable, use:
```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK types unavailable at compile time
```

---

## 4. Module Structure (post-refactor target)

```
src/
├── extension.ts            # Extension entry point (thin)
├── services/
│   ├── pi-service.ts       # Agent lifecycle
│   ├── auth.ts             # Login, API keys, credentials
│   ├── model.ts            # Model selection, cycling
│   └── session.ts          # Session create/resume/fork
├── bridge/
│   └── bridge-tools.ts     # VS Code bridge tools
├── ui/
│   ├── webview-panel.ts    # Webview panel manager
│   ├── tree-provider.ts    # Session tree view
│   └── package-tree.ts     # Package tree view
├── webview/
│   ├── main.ts             # Webview entry
│   ├── components/         # UI components
│   ├── render/             # Rendering engine
│   ├── handlers/           # Event handlers
│   └── tools/              # Tool renderers
├── shared/
│   ├── protocol.ts         # Webview protocol
│   └── types.ts            # Shared types
├── logger.ts               # Logging
└── test/                   # Tests mirror src structure
```

The goal: no file exceeds 500 lines. If it does, split it.

---

## 5. Testing

### What to Test

- Bridge tools: every tool gets at least one test that validates inputs and returns correct structure
- Auth flow: mock ModelRuntime, verify login/logout paths
- Edge cases: empty inputs, null returns, error states

### Conventions

- Test files mirror source structure: `src/services/auth.ts` → `src/test/auth.test.ts`
- Use `vscode-test` for extension tests
- Descriptive test names: `"should return editor state with active document"`

---

## 6. i18n

### Extension Side

- Use `vscode.l10n.t()` for all user-facing strings
- Package-level strings in `package.nls.json`
- Key naming: `<scope>.<description>`, e.g. `chat.sendButton`, `tree.openSessions`

### Webview Side

- All strings in a locale object, passed via postMessage
- Current locale determined by `vscode.env.language`

### Adding Strings

1. Add key to `l10n/bundle.l10n.json` (or `package.nls.json` for package metadata)
2. Use `vscode.l10n.t('key')` in code
3. Never concatenate translated strings; use parameterized patterns: `vscode.l10n.t('error.installFailed', errorMessage)`

---

## 7. General

- **Files**: use LF line endings, UTF-8 encoding
- **Comments**: English only
- **Logs**: use `piLog()` for info, `piWarn()` for warnings, `console.error()` only for fatal
- **PRs**: not required (solo project), push directly to `dev`
- **Before push**: run `pnpm run compile` (check-types + lint + build)
