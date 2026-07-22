# Pi Code Gui Dev — 项目约定

## 项目信息

- 项目：pi-code-gui-dev
- 仓库：https://github.com/lazybone404/pi-code-gui-dev
- 定位：给自己用的 pi VS Code 扩展，顺便开源
- 底层：Fork from NimbleTronAI/pi-code-gui（已独立发展，不再跟踪上游）
- 目标：在 VS Code 中以 GUI 方式使用 Pi coding agent

## 开发者

- GitHub: lazybone404
- 环境：Windows 11, Git Bash, PowerShell 5.1
- Node: 24.16.0
- 当前 pi SDK 版本: 0.81.1

## 开发原则

详见 [CONVENTIONS.md](./CONVENTIONS.md)

- 代码注释和 Commit 用英文
- ESLint 沿用原项目规则（严格模式），详见 CONVENTIONS.md §3
- 改动加测试
- 国际化做正经 i18n
- Commit 规范：Conventional Commits（详见 CONVENTIONS.md §1）
- TypeScript 命名和类型规范（详见 CONVENTIONS.md §2）
- 模块拆分目标（详见 CONVENTIONS.md §4）
- 主要给自己用，可以破坏性改动

## 分支说明

- `main` — 稳定版本
- `dev` — 所有改动在此开发

## 开发计划

### 阶段 1 — 能跑
- [x] Windows ESM path 兼容
- [x] SDK 0.81.1 兼容（临时 shim）
- [x] 工作区超时修复
- [x] F5 调试配置修复
- [ ] 确认测试窗口完整跑通

### 阶段 2 — 拆负担
- [ ] 拆掉 authStorage 兼容层
- [ ] 全部改成 ModelRuntime 直接调用
- [ ] 清理弃用 API 引用

### 阶段 3 — 中文界面
- [ ] 搭 i18n 框架（package.nls.json + vscode.l10n）
- [ ] 翻译 extension 侧（菜单、命令、提示）
- [ ] 翻译 webview 侧（聊天界面）
- [ ] 中/英切换

### 阶段 4 — 打磨
- [ ] 完整流程测试
- [ ] 实际使用中的 bug 修复
- [ ] 发布到 VS Code 市场 / Open VSX

## 关键文件

| 文件 | 说明 |
|------|------|
| `src/extension.ts` | VS Code 扩展入口 |
| `src/pi-service.ts` | pi SDK 生命周期管理 |
| `src/bridge-tools.ts` | VS Code 桥接工具（16+ 个） |
| `src/webview/` | 聊天界面 Webview |
| `src/webview-panel.ts` | Webview 面板管理 |

## 技术栈

- VS Code Extension API
- TypeScript（严格模式）
- esbuild（打包）
- ESLint（14 条错误级规则）
- pnpm（包管理）
- pi coding agent SDK（运行时动态加载）
