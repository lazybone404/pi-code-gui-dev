# Pi Code Gui Dev — 项目约定

## 项目信息

- 项目：pi-code-gui-dev
- 仓库：https://github.com/lazybone404/pi-code-gui-dev
- 定位：给自己用的 pi VS Code 扩展，顺便开源
- 目标：在 VS Code 中以 GUI 方式使用 Pi coding agent

## 开发者

- GitHub: lazybone404
- 环境：Windows 11, Git Bash, PowerShell 5.1
- Node: 24.16.0
- pi SDK: 0.81.1（最新）
- DeepSeek 模型已更至 V4（v4-pro / v4-flash）

## 开发原则

[CONVENTIONS.md](./CONVENTIONS.md) 覆盖全部：Git、TS、ESLint、模块、测试、i18n、SOLID+DRY+KISS。

## 分支

- `main` — 稳定版本
- `dev` — 开发分支

## 技术债 + 待办

### 🔴 必须做
- [x] SDK 0.81.1 适配（authStorage→ModelRuntime，pi-ai 废弃）
- [x] Windows 路径（toFileUrl）
- [x] F5 调试配置
- [x] 确认测试窗口正常运行

### 🟡 提升质量
- [x] 架构重构（pi-service 从 2700→~1900 行，拆 7 个模块）
- [x] bridge-tools 拆分（725→24 行，4 个子模块）
- [x] i18n 框架 + 扩展侧中文化（36 命令/2 视图/13 配置）
- [x] Webview 状态栏 + 输入框中文化
- [ ] Webview 聊天界面其余文本中文化
- [ ] PiSdk 类型补全（当前多为 any/Function）
- [ ] vscode.l10n 类型声明

### 🟢 锦上添花
- [ ] README 重写
- [ ] 单元测试
- [ ] 发布 .vsix → VS Code 市场 / Open VSX
- [ ] GitHub Actions CI

## 文件索引

新对话时 agent 按顺序读：
1. `AGENTS.md` → `CONVENTIONS.md` → `DEVELOPMENT.md` → `SESSION_NOTES.md`

| 文件 | 说明 |
|------|------|
| `src/extension.ts` | VS Code 扩展入口 |
| `src/pi-service.ts` | pi SDK 生命周期管理（1900行） |
| `src/bridge/` | Bridge 工具（editor/lsp/edits/helpers） |
| `src/services/` | 子服务（auth/model/prompts/sdk） |
| `src/webview/` | 聊天界面 Webview |
| `src/webview-panel.ts` | Webview 面板管理 |
