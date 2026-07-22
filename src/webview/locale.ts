/**
 * Locale strings for the webview chat UI.
 * Key-value map with English defaults and Chinese translations.
 * Language is set by the extension via postMessage on startup.
 */

export interface LocaleStrings {
  [key: string]: string | ((...args: string[]) => string);
}

const en: LocaleStrings = {
  // Status bar
  "status.ready": "Ready",
  "status.streaming": "Streaming...",
  "status.init": "Initializing...",
  "status.error": "Error",
  "status.notInstalled": "Pi SDK not installed",

  // Footer / model info
  "footer.model": "Model",
  "footer.thinking": "Thinking",
  "footer.effort": "Effort",
  "footer.budget": "Budget",
  "footer.tokens": "tokens",
  "footer.cost": "cost",

  // Input area
  "input.placeholder": "Ask Pi to help you code...",
  "input.send": "Send",
  "input.abort": "Abort",
  "input.steer": "Steer",
  "input.followUp": "Follow-up",
  "input.clear": "Clear",

  // Thinking block
  "thinking.collapsed": "Thinking...",
  "thinking.expand": "Show thinking",
  "thinking.collapse": "Hide thinking",

  // Tool blocks
  "tool.running": "Running...",
  "tool.done": "Done",
  "tool.error": "Error",
  "tool.collapsed": "Tool output hidden",
  "tool.expand": "Show output",
  "tool.collapse": "Hide output",
  "tool.readMore": "Continue reading",
  "tool.linesRemaining": "lines remaining",

  // Compaction
  "compaction.title": "Context compacted",
  "compaction.summary": "Summary of earlier conversation:",

  // Dialogs
  "dialog.confirm": "Confirm",
  "dialog.cancel": "Cancel",
  "dialog.ok": "OK",
  "dialog.select": "Select",
  "dialog.input": "Input",

  // Notifications
  "notify.error": "Error",
  "notify.warning": "Warning",
  "notify.info": "Info",
  "notify.dismiss": "Dismiss",

  // Session tree
  "tree.openSessions": "Open Sessions",
  "tree.pastSessions": "Past Sessions",
  "tree.pastSessionsLoading": "Past Sessions (loading...)",
  "tree.pastSessionsNone": "Past Sessions (none)",
  "tree.entries": "Entries",
  "tree.model": "Model",
  "tree.thinking": "Thinking",
  "tree.loading": "Loading Pi SDK...",
  "tree.initializing": "initializing",

  // Slash commands
  "slash.builtin": "Built-in",
  "slash.extension": "Extension",
  "slash.bridge": "VS Code Bridge",
  "slash.promptTemplates": "Prompt Templates",

  // Messages
  "msg.emptySession": "No messages yet. Start by asking Pi to do something.",

  // Auth
  "auth.oauthLogin": "Login with subscription",
  "auth.apiKeyLogin": "Login with API key",
  "auth.enterApiKey": "Enter API key",
  "auth.apiKeyPlaceholder": "sk-...",
  "auth.loggingIn": "Logging in",
  "auth.loggedIn": "Logged in successfully",
  "auth.loginFailed": "Login failed",
  "auth.alreadyConfigured": "Already configured",

  // Model picker
  "model.select": "Select model",
  "model.saveAsDefault": "Save as default",
  "model.useAsDefault": "Use as default?",
  "model.starDefault": " = default",
  "model.noModels": "No models available. Configure an API key first.",

  // Thinking level
  "thinking.select": "Select thinking level",
  "thinking.off": "No thinking",
  "thinking.minimal": "Minimal thinking",
  "thinking.low": "Brief thinking",
  "thinking.medium": "Balanced thinking",
  "thinking.high": "Extended thinking",
  "thinking.xhigh": "Maximum thinking",

  // Quick start / empty state
  "quickstart.title": "Welcome to Pi Code Gui",
  "quickstart.subtitle": "Your AI coding assistant in VS Code",
  "quickstart.noKey": "No API key configured",
  "quickstart.loginPrompt": "Set up an API key or login to get started",
  "quickstart.loginButton": "Set Up API Key / Login",

  // Tool names (display labels)
  "tool.read": "Read",
  "tool.write": "Write",
  "tool.edit": "Edit",
  "tool.bash": "Bash",
  "tool.grep": "Grep",
  "tool.find": "Find",
};

const zhCN: LocaleStrings = {
  "status.ready": "就绪",
  "status.streaming": "生成中...",
  "status.init": "初始化...",
  "status.error": "错误",
  "status.notInstalled": "Pi SDK 未安装",

  "footer.model": "模型",
  "footer.thinking": "思考",
  "footer.effort": "深度",
  "footer.budget": "预算",
  "footer.tokens": "tokens",
  "footer.cost": "成本",

  "input.placeholder": "告诉 Pi 你想做什么...",
  "input.send": "发送",
  "input.abort": "中止",
  "input.steer": "介入",
  "input.followUp": "追问",
  "input.clear": "清空",

  "thinking.collapsed": "思考中...",
  "thinking.expand": "展开思考",
  "thinking.collapse": "收起思考",

  "tool.running": "执行中...",
  "tool.done": "完成",
  "tool.error": "错误",
  "tool.collapsed": "工具输出已隐藏",
  "tool.expand": "展开输出",
  "tool.collapse": "收起输出",
  "tool.readMore": "继续阅读",
  "tool.linesRemaining": "行剩余",

  "compaction.title": "上下文已压缩",
  "compaction.summary": "之前对话摘要:",

  "dialog.confirm": "确认",
  "dialog.cancel": "取消",
  "dialog.ok": "确定",
  "dialog.select": "选择",
  "dialog.input": "输入",

  "notify.error": "错误",
  "notify.warning": "警告",
  "notify.info": "提示",
  "notify.dismiss": "关闭",

  "tree.openSessions": "当前会话",
  "tree.pastSessions": "历史会话",
  "tree.pastSessionsLoading": "历史会话（加载中...）",
  "tree.pastSessionsNone": "历史会话（无）",
  "tree.entries": "条目",
  "tree.model": "模型",
  "tree.thinking": "思考",
  "tree.loading": "正在加载 Pi SDK...",
  "tree.initializing": "初始化中",

  "slash.builtin": "内置",
  "slash.extension": "扩展",
  "slash.bridge": "VS Code 桥接",
  "slash.promptTemplates": "提示模板",

  "msg.emptySession": "暂无消息，告诉 Pi 你想做什么吧。",

  "auth.oauthLogin": "使用订阅登录",
  "auth.apiKeyLogin": "使用 API Key 登录",
  "auth.enterApiKey": "输入 API Key",
  "auth.apiKeyPlaceholder": "sk-...",
  "auth.loggingIn": "正在登录",
  "auth.loggedIn": "登录成功",
  "auth.loginFailed": "登录失败",
  "auth.alreadyConfigured": "已配置",

  "model.select": "选择模型",
  "model.saveAsDefault": "设为默认",
  "model.useAsDefault": "设为默认？",
  "model.starDefault": " = 默认",
  "model.noModels": "没有可用模型，请先配置 API Key。",

  "thinking.select": "选择思考深度",
  "thinking.off": "不思考",
  "thinking.minimal": "最小思考",
  "thinking.low": "简短思考",
  "thinking.medium": "均衡思考",
  "thinking.high": "深入思考",
  "thinking.xhigh": "最大思考",

  "quickstart.title": "欢迎使用 Pi Code Gui",
  "quickstart.subtitle": "你的 VS Code AI 编程助手",
  "quickstart.noKey": "未配置 API Key",
  "quickstart.loginPrompt": "设置 API Key 或登录以开始使用",
  "quickstart.loginButton": "设置 API Key / 登录",

  "tool.read": "读取",
  "tool.write": "写入",
  "tool.edit": "编辑",
  "tool.bash": "命令",
  "tool.grep": "搜索",
  "tool.find": "查找",
};

const locales: Record<string, LocaleStrings> = { en, "zh-cn": zhCN };

let currentLocale = "en";

/** Set current locale (called by extension via postMessage). */
export function setLocale(locale: string): void {
  if (locales[locale]) {
    currentLocale = locale;
  } else if (locale.startsWith("zh")) {
    currentLocale = "zh-cn";
  }
}

/** Get a translated string by key. Falls back to English if missing. */
export function t(key: string): string {
  const strings = locales[currentLocale] || locales["en"];
  const value = strings[key];
  if (typeof value === "function") {
    return (value as (...args: string[]) => string)();
  }
  return typeof value === "string" ? value : ((locales["en"] as LocaleStrings)?.[key] as string ?? key);
}

/** Get current locale code. */
export function getLocale(): string {
  return currentLocale;
}

/** Format a template string with replacements. */
export function tf(key: string, ...args: string[]): string {
  let template = t(key);
  for (let i = 0; i < args.length; i++) {
    template = template.replace(`$${i + 1}`, args[i]);
  }
  return template;
}
