# Pi Code Gui Dev — 项目约定

## 项目信息

- 项目：pi-code-gui-dev（NimbleTronAI/pi-code-gui 的 Fork）
- 仓库：https://github.com/lazybone404/pi-code-gui-dev
- 上游：https://github.com/NimbleTronAI/pi-code-gui
- 目标：在 VS Code 中运行 Pi coding agent 的 GUI 扩展

## 开发者

- GitHub: lazybone404
- 环境：Windows 11, Git Bash, PowerShell 5.1
- Node: 24.16.0

## 开发原则

- 代码注释和 Commit 用英文
- 沿用上游 ESLint 规则
- 改动必须加测试
- 国际化做正经 i18n（不硬改中文）
- 尽量与上游保持兼容，方便合并更新
- 公开 Fork，接受 PR
- Commit 规范：Conventional Commits
- 分支策略：`main` 跟踪上游 → `dev` 开发分支

## 分支说明

- `main` — 与 `upstream/main` 保持一致，只合并上游代码
- `dev` — 所有改动在此分支开发

## 关键文件

| 文件 | 说明 |
|------|------|
| `src/extension.ts` | VS Code 扩展入口 |
| `src/pi-service.ts` | pi SDK 生命周期管理 |
| `src/bridge-tools.ts` | VS Code 桥接工具（16+ 个） |
| `src/webview/` | 聊天界面 Webview |
| `src/webview-panel.ts` | Webview 面板管理 |
| `dist/extension.js` | 编译产物（打包文件） |

## 已知问题

### Windows 路径 Bug（关键）
- **位置**：`src/pi-service.ts` 中的 `importWithRetry()` 函数
- **原因**：`import(modulePath)` 在 Windows ESM 下不认识 `C:\...` 路径，需转成 `file:///C:/...`
- **修复方案**：在 `importWithRetry()` 开头判断 `process.platform === "win32"` 且路径以盘符开头时，用 `pathToFileURL()` 或字符串拼接转为 `file:///` URL
- **状态**：待修复（已完成手动 patch，需正式提交代码）

## 技术栈

- VS Code Extension API
- TypeScript（严格模式）
- esbuild（打包）
- ESLint（14 条错误级规则）
- pnpm（包管理）
- pi coding agent SDK（运行时动态加载）
