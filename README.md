# Pi Code Gui Dev · π 代码助手

> Pi coding agent 的 VS Code GUI 扩展 — 在编辑器里使用 π，支持中文界面。
>
> A native VS Code GUI extension for the Pi coding agent — with Chinese UI support.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Powered by Pi](https://img.shields.io/npm/v/%40earendil-works%2Fpi-coding-agent?label=pi%20SDK&color=7C3AED)](https://pi.dev)

<p align="center">
  <img src="media/pi-code-gui-readme.png" alt="截图 / Screenshot" width="700">
</p>

---

## 这是什么 / What is this?

**中文**：在 VS Code 侧栏中嵌入 Pi coding agent，完整 GUI 体验。支持流式对话、模型切换、16+ 个编辑器桥接工具（诊断、符号、定义跳转等），以及中英文界面自动切换。

**English**: Embed the Pi coding agent in VS Code's sidebar as a native GUI. Streaming chat, model switching, 16+ editor bridge tools (diagnostics, symbols, definitions, etc.), and automatic Chinese/English UI switching.

---

## 功能 / Features

| 功能 Feature | 说明 Description |
|-------------|-----------------|
| 💬 聊天面板 Chat panel | 流式文本、折叠式思考块、工具调用渲染 / Streaming text, collapsible thinking, tool rendering |
| 🧰 编辑器桥接 Editor bridge | 16+ 工具：诊断、符号、定义、引用、格式化 / Diagnostics, symbols, definitions, references, format |
| 🌐 中文界面 Chinese UI | 命令、菜单、设置、提示信息全中文化 / All commands, menus, settings, messages localized |
| 🔄 会话管理 Sessions | 多会话标签、历史恢复、分叉/克隆 / Multi-tab, resume, fork, clone |
| 🔐 认证 Auth | OAuth 登录 + API Key，支持所有提供商 / OAuth + API key, all providers |
| 📦 包管理 Packages | 安装/卸载/搜索 pi 扩展包 / Install, uninstall, search pi packages |

---

## 安装 / Install

**前置依赖 / Prerequisites**：
- VS Code 1.118+
- Pi coding agent SDK（全局安装 / installed globally）

```bash
npm install -g @earendil-works/pi-coding-agent
```

**安装扩展 / Install extension**：

1. 下载 `.vsix` 文件 / Download `.vsix` file
2. VS Code → 扩展面板 → `···` → `Install from VSIX...`

---

## 开发 / Development

```bash
# 克隆 / Clone
git clone https://github.com/lazybone404/pi-code-gui-dev.git
cd pi-code-gui-dev

# 安装 / Install
pnpm install

# 编译 / Build
pnpm run compile    # type-check + lint + build
pnpm run watch      # 开发模式 / dev mode (auto-rebuild)

# 打包 / Package
pnpm run vsix       # 产出 .vsix / produces .vsix
```

按 `F5` 启动 Extension Development Host 测试窗口。

Press `F5` to launch the Extension Development Host.

---

## 项目结构 / Project Structure

```
src/
├── extension.ts          # 入口 / entry
├── pi-service.ts         # Agent 生命周期 / lifecycle
├── webview-panel.ts      # Webview 面板 / panel
├── bridge/               # Bridge 工具 / tools
│   ├── editor.ts         #   编辑器状态 / editor state
│   ├── lsp.ts            #   诊断/符号 / LSP features
│   └── edits.ts          #   编辑/格式化 / edits & format
├── services/             # 子服务 / services
│   ├── auth.ts           #   认证 / authentication
│   ├── model.ts          #   模型 / model management
│   ├── prompts.ts        #   提示词 / prompts
│   └── sdk.ts            #   SDK 加载 / loader
└── webview/              # 聊天 UI / chat UI
```

---

## 开发规范 / Conventions

详见 See [CONVENTIONS.md](./CONVENTIONS.md)：
- SOLID + DRY + KISS 设计原则
- Conventional Commits（标题英文 + 正文中英双写）
- TypeScript 严格模式 + ESLint 14 条规则
- vscode.l10n 国际化

---

## 许可 / License

MIT © lazybone404

Fork from [NimbleTronAI/pi-code-gui](https://github.com/NimbleTronAI/pi-code-gui)
