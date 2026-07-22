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
feat: 新增中文界面 (add Chinese UI via vscode.l10n)

- 使用 vscode.l10n API 替换所有硬编码英文
- extension 侧菜单和命令已翻译
- webview 侧聊天界面文本已翻译
```

### Commit Rules

- One logical change per commit
- **Title**: English (for Conventional Commits tooling), with optional Chinese prefix
- **Body**: English required + Chinese translation recommended
- Keep title line under 72 characters (total)
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

## 7. Design Principles

These seven principles from software engineering guide all design decisions.

### 1. Single Responsibility (SRP — 单一职责)

A module should have exactly one reason to change.

- **Rule**: no file exceeds 500 lines. If it does, split it.
- **Example**: `pi-service.ts` (2700 lines) → `auth.ts`, `model.ts`, `session.ts`.

### 2. Open/Closed (OCP — 开闭原则)

Open for extension, closed for modification.

- **Rule**: adding a new bridge tool or command should mean adding a new file,
  not editing existing code.
- **Example**: bridge tools are defined in a factory function that returns an
  array — new tools are just new entries in the array.

### 3. Liskov Substitution (LSP — 里氏替换)

A substitute must be indistinguishable from the real thing.

- **Rule**: no fake objects that "pretend" to be something they are not.
- **Example**: the `authStorage` shim wraps `ModelRuntime` to fake the old
  `AuthStorage` API. This must be removed — call `ModelRuntime` directly.

### 4. Interface Segregation (ISP — 接口隔离)

Small, focused interfaces are better than one big one.

- **Rule**: each service module exports only what its callers need.
- **Example**: `auth.ts` exports `login`, `logout`, `setApiKey`, `getAuth`;
  `model.ts` exports `switchModel`, `cycleModel`, `getAvailableModels`.

### 5. Dependency Inversion (DIP — 依赖倒置)

High-level modules should not depend on low-level modules. Both depend on
abstractions.

- **Rule**: services communicate through clear event interfaces or shared
  types, not direct imports of each other.
- **Example**: `PiService` should not import `WebviewPanel`. Events from
  `PiService` flow through a typed event bus that the webview subscribes to.

### 6. Don't Repeat Yourself (DRY — 不要重复)

Every piece of knowledge has a single, unambiguous representation.

- **Rule**: shared logic is extracted; no copy-paste.
- **Example**: `workspaceRelativePath` used in every bridge tool → extract
  to `shared/path-utils.ts`.

### 7. Keep It Simple (KISS — 保持简单)

Simple is better than clever.

- **Rule**: prefer direct calls over abstraction layers. If the SDK provides
  `ModelRuntime`, use `ModelRuntime` — don't wrap it.
- **Example**: the `createAuthStorageShim` is an unnecessary layer of
  indirection. Delete it and call `modelRuntime` directly.

---

## 8. General

- **Files**: use LF line endings, UTF-8 encoding
- **Comments**: English or Chinese, whichever is clearer. Technical terms stay in English.
- **Logs**: use `piLog()` for info, `piWarn()` for warnings, `console.error()` only for fatal
- **PRs**: not required (solo project), push directly to `dev`
- **Before push**: run `pnpm run compile` (check-types + lint + build)
