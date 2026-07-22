# Session Notes — Pi Code Gui Dev 重构全记录

> 本次对话完整经历：从 Fork 上游项目到独立维护，从单体文件到模块化架构，从全英文到中英双语。
> 记录以备后续开发和新人上手参考。

---

## 一、项目时间线

```
Fork 上游    →  适配 SDK 0.81.1  →  拆模块  →  i18n 中文  →  UX 打磨  →  对话管理  →  文档/CI/打包
   day1            day1              day1       day1          day2          day2          day3
```

**最终状态**：pi-service 从 2700 行拆分到 1900 行 + 4 个子服务 + 3 个 bridge 模块，全部编译零错误零警告，中英文界面自动切换，智能会话命名。

---

## 二、关键决策与教训

### 1. Fork 后的去留

**决定**：与上游彻底分家，不跟踪 upstream。

**原因**：
- 上游已 6 周未更新，连 SDK 0.81.1 兼容都没做
- Windows 用户不在作者考虑范围内
- 我们的需求（中文界面、DeepSeek V4 适配、对话管理）与上游方向不同

**教训**：Fork 一个不活跃的项目时，别浪费时间搞兼容层，直接 fork 独立发展。

### 2. SDK 版本适配（最关键的一步）

**问题**：pi SDK 从旧版升级到 0.81.1 后，多个 API 被移除或改变：

| 旧 API | 新 API | 影响范围 |
|------|------|------|
| `AuthStorage.create()` | `ModelRuntime.create()` | 认证全流程 |
| `ModelRegistry.create(auth)` | `new ModelRegistry(modelRuntime)` | 模型列表 |
| `AI.getModel()` | `modelRuntime.getModel()` | 所有模型查找 |
| `AI.complete()` | `modelRuntime.complete()` | 摘要生成 |
| `pi-ai` 模块 | 已废弃，移除导入 | init 流程 |
| 新增 `agent_settled` 事件 | 需要处理 | 事件循环 |

**正确做法**：
1. 先用兼容层（shim）撑住，让代码能跑
2. 确认功能正常后，逐步拆掉 shim，全部改为新 API 直接调用
3. 旧依赖（pi-ai）完全删掉，别留死代码

**陷阱**：`AuthStorage.setRuntimeApiKey()` 在老代码里是同步的，`ModelRuntime.setRuntimeApiKey()` 是异步的。不改 `await` 会导致 API key 设不进去。

### 3. Windows 路径 Bug

```
Error: Only URLs with a scheme in: file, data, node, and electron are supported.
Received protocol 'c:'
```

**原因**：Node.js ESM `import()` 不认识 Windows 绝对路径 `C:\...\`。

**修复**：在 `importWithRetry()` 开头加判断，Windows 下把路径转成 `file:///C:/...` URL。

**关键代码位置**：`src/services/sdk.ts` → `toFileUrl()` + `importWithRetry()`。

### 4. 架构重构原则

**拆分前的状态**：`pi-service.ts` 2700 行，管了 SDK 加载、认证、模型、会话、事件、UI。

**拆分策略**：
1. 先拆最独立的（SDK 解析、提示模板）→ 风险最小
2. 再拆中等耦合的（认证、模型）→ 需要依赖注入
3. 最后拆大块的（事件处理）→ 紧耦合，暂时保留

**拆出来的模块**：

```
src/services/
  auth.ts     — 登录/登出/API Key（311 行）
  model.ts    — 模型切换/thinking/defaults（280 行）
  prompts.ts  — 系统提示/上下文/模板（160 行）
  sdk.ts      — SDK 路径解析/导入（174 行）

src/bridge/
  helpers.ts  — 共享工具函数（66 行）
  editor.ts   — 编辑器状态 + 文件操作（235 行）
  lsp.ts      — 诊断/符号/定义/引用（319 行）
  edits.ts    — 编辑/格式化（93 行）
```

**依赖注入模式**：每个 Service 通过 `Host` 接口接收依赖，不直接 import PiService：
```typescript
interface ModelServiceHost {
  modelRuntime: any;
  modelRegistry: any;
  get model(): ...;
  set model(m): ...;
  // ...
}
```

### 5. i18n 实现

**VS Code 标准做法**：
- `package.nls.json` ← 英文默认
- `package.nls.zh-cn.json` ← 中文
- `package.json` 中用 `%key%` 引用
- Extension 代码用 `vscode.l10n.t("key")`

**Webview 侧做法**：
- 创建 `src/webview/locale.ts` — 中英文对照表 + `t()` 函数
- 扩展启动时通过 postMessage 发送 VS Code 语言设置
- Webview 接收后调用 `setLocale()` + 更新 UI

**踩坑**：`setLocale` 消息需要在 `shared/protocol.ts` 的 Zod schema 里注册，否则被协议验证拦截成非法消息。

### 6. 会话管理设计

**核心约束**：pi 的会话是 JSONL 文件，我们绝不能建私有数据库。

| 功能 | 实现 | 兼容性 |
|------|------|------|
| 智能命名 | 第一条 user 消息前 30 字 → `session_info` entry | ✅ pi 的 /name 等价 |
| 元数据 | 读 JSONL 提取 model + token | ✅ 只读不写 |
| 模糊搜索 | VS Code QuickPick + 实时过滤 | ✅ 不建索引 |
| 快速切换 | 同上，搜到即切 | ✅ 等价 /resume |

---

## 三、开发技巧备忘录

### VS Code 扩展调试

```
pnpm run watch    → 终端里跑，自动编译
F5                → 弹测试窗口
测试窗口 Ctrl+Shift+P → Developer: Reload Window → 看改动
```

**坑**：`preLaunchTask: "watch"` 卡住不弹窗口 → 因为 watch 是 background 任务但没标记 `isBackground: true`。

**坑**：`--disable-extensions` 在新版 VS Code 可能把开发扩展也禁了 → 去掉这个参数。

### ESLint 防身术

这个项目有 14 条 error 级规则，改代码时最常踩的：

```typescript
// any 类型 → 必须加 eslint-disable
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const x: any = dynamicImport();

// if 必须有大括号
if (x) { return; }  // ✅
if (x) return;      // ❌ curly error

// 未使用的变量 → 用 _ 前缀
const _unused = something;

// 函数必须显式返回类型
function foo(): string { return "bar"; }
```

### pnpm 注意事项

- 项目用 pnpm@10，`pnpm.onlyBuiltDependencies` 字段已废弃 → 警告可忽略
- `pnpm install` 可能卡住（bin 链接失败）→ 开发不影响
- `pnpm run vsix` 会触发 `vscode:prepublish` → 对 `*` activation event 有警告，加 `--allow-star-activation` 即可

### Webview 协议验证

所有 extension → webview 的消息都要在 `shared/protocol.ts` 的 Zod discriminated union 里注册。新增消息类型时：
1. 加 `z.object({ type: z.literal("xxx"), data: ... })`
2. 编译两边（extension + webview）
3. 不注册会报 `Message validation error`

---

## 四、文件索引

新开对话时，agent 需先读：

| 顺序 | 文件 | 说明 |
|------|------|------|
| 1 | `AGENTS.md` | 项目总纲、开发原则、技术债清单 |
| 2 | `CONVENTIONS.md` | 代码规范（Git、TS、设计原则、Pi 哲学） |
| 3 | `DEVELOPMENT.md` | 开发参考（脚本、文件结构、架构） |
| 4 | `SESSION_NOTES.md` | 本文件 — 本次对话完整记录 |

---

## 五、未完成事项（留给下次）

- [ ] Webview 聊天界面剩余文本中文化（tool blocks、compaction details 等）
- [ ] PiSdk 接口类型补全（当前多为 any/Function）
- [ ] 手动会话改名（右键 → Rename）
- [ ] 聊天面板内快速切换最近 5 个会话
- [ ] 发布到 VS Code 市场 / Open VSX

---

## 六、Git 提交规范

### 必须提交
- `src/**` — 所有源码
- `package.json`、`pnpm-lock.yaml` — 依赖管理
- `tsconfig*.json`、`esbuild*.js`、`eslint.config.mjs` — 构建和检查配置
- `media/style.css`、`media/*.svg` — 静态资源
- `*.md` — 文档
- `.github/workflows/` — CI
- `.vscode/launch.json`、`.vscode/tasks.json`、`.vscode/extensions.json` — 团队共享的编辑器配置
- `.vscodeignore`、`.npmrc` — 打包和 npm 配置

### 不能提交
- `dist/` — 编译产物，但是打包时会带（`.vscodeignore` 里有例外）
- `*.vsix` — 安装包
- `node_modules/` — 依赖
- `.DS_Store`、`Thumbs.db` — 操作系统文件
- `.vscode/settings.json` — 个人编辑器设置
- `.env` — 密钥

### 提交前检查
```bash
pnpm run compile    # check-types + lint + build
npx tsc --noEmit    # 再次确认

