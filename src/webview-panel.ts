import * as vscode from "vscode";
import { PiService } from "./pi-service.js";
import type { PiServiceEvent } from "./types.js";
import { validateExtensionToWebview, type WebviewToExtension, type ExtensionToWebview } from "./shared/protocol.js";
import { renderTemplate } from "./webview/template.js";

export type PanelDisposeCallback = (piService: PiService) => void;

export class PiWebviewPanel {
  private panel: vscode.WebviewPanel | null = null;
  private piService: PiService;
  private disposables: vscode.Disposable[] = [];
  /** Cleanup function returned by piService.onEvent() */
  private piCleanup: (() => void) | null = null;

  // Tab indicator state
  private _tabInitialized = false;
  private _tabStreaming = false;
  private _tabSummary: string | null = null;

  /** Callback invoked when the panel is disposed (VS Code tab closed) */
  private _onDispose: PanelDisposeCallback | null = null;

  constructor(
    private context: vscode.ExtensionContext,
    piService: PiService
  ) {
    this.piService = piService;
  }

  /** Register a callback that fires when the panel/webview is closed. */
  set onDispose(cb: PanelDisposeCallback | null) { this._onDispose = cb; }

  /** Register a callback that fires when this panel/view becomes active. */
  set onActivate(cb: (() => void) | null) { this._onActivateCb = cb; }
  private _onActivateCb: (() => void) | null = null;

  async show(): Promise<void> {
    if (this.panel) {
      this.panel.reveal();
      return;
    }

    // Use a unique viewType per webview to prevent VS Code from restoring
    // stale webviews that reference old extension versions. The randomId is
    // regenerated on every createWebviewPanel call.
    var randomId = Math.random().toString(36).slice(2, 8);
    this.panel = vscode.window.createWebviewPanel(
      "pi-chat-" + randomId,
      "Pi Code Gui",
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, "media"),
        ],
      }
    );

    this.panel.iconPath = {
      light: vscode.Uri.joinPath(this.context.extensionUri, "media", "pi-icon-light.svg"),
      dark: vscode.Uri.joinPath(this.context.extensionUri, "media", "pi-icon-dark.svg"),
    };

    this.panel.webview.html = this.getWebviewContent(this.panel.webview);
    this.setupWebviewHandlers();
    this.setupServiceHandlers();

    // Send locale to webview so it can render in the correct language
    this.panel.webview.postMessage({
      type: "setLocale",
      data: { locale: vscode.env.language },
    });

    this.panel.onDidChangeViewState((e) => {
      if (e.webviewPanel.active && this._onActivateCb) {
        this._onActivateCb();
      }
    });

    this.panel.onDidDispose(() => {
      // Notify the owner (extension.ts) so it can save and remove from open sessions
      if (this._onDispose) {
        this._onDispose(this.piService);
      }
      this.panel = null;
      this.disposables.forEach((d) => d.dispose());
      this.disposables = [];
      this.cleanupPiListener();
    });
  }

  private setupWebviewHandlers(): void {
    if (!this.panel) {
      console.error("[pi-gui] setupWebviewHandlers called with no panel — webview messages will be lost");
      return;
    }

    // Proactively send status every 500ms until pi is ready
    // This avoids the webview-to-extension 'ready' handshake entirely
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    let statusInterval: any = null;
    const startPolling = (): void => {
      if (statusInterval) {return;}
      statusInterval = setInterval(() => {
        const model = this.piService.model;
        this.postMessage({
          type: "status",
          data: {
            model: model?.id ?? "loading...",
            thinkingLevel: this.piService.thinkingLevel,
            effort: this.piService.effort,
            ready: model !== null,
          },
        });
        if (model !== null && statusInterval) {
          clearInterval(statusInterval);
          statusInterval = null;
          this._tabInitialized = true;
          this.updateTabIndicator();
        }
      }, 500);
    };
    startPolling();
    this.disposables.push({ dispose: () => { if (statusInterval) {clearInterval(statusInterval);} } });

    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.type) {
          case "prompt": {
 
              const msg = message;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
              this.piService.sendPrompt(msg.text, msg.images, msg.mode).catch((error: any) => {
                let errMsg = error.message ?? String(error);
                if (/api.?key|login|authenticate|provider/i.test(errMsg)) {
                  errMsg += "\n\n[Set up an API key →](https://pi.dev/docs/latest/quickstart)";
                }
                this.postMessage({ type: "error", data: { message: errMsg } });
              });
            }
            break;

          case "abort":
            await this.piService.abort();
            break;

          case "cycleModel":
            await this.piService.cycleModel();
            break;

          case "setThinkingLevel":
            await this.piService.setThinkingLevel(message.level);
            break;

          case "setEffort":
            await this.piService.setEffort(message.effort);
            break;

          case "pickModel":
            void this.triggerModelPicker();
            break;

          case "pickThinkingLevel":
            void this.triggerThinkingPicker();
            break;

          case "pickEffort":
            void this.triggerEffortPicker();
            break;

          case "loginTrigger":
            await vscode.commands.executeCommand("pi-code-gui.login");
            await this._sendAuthStatus();
            break;

          case "webviewReady":
            await this._sendAuthStatus();
            await this._sendOptions();
            break;

          case "searchSessions":
            void vscode.commands.executeCommand("pi-code-gui.filterPastSessions");
            break;

          case "selectModel": {
            const sel = message as { data: { provider: string; id: string } };
            const { provider, id } = sel.data || {};
            if (provider && id) {
              await this.piService.setModel(provider, id);
            }
            break;
          }

          case "selectThinkingLevel": {
            const sel = message as { data: { level: string } };
            const level = sel.data?.level;
            if (level) {
              await this.piService.setThinkingLevel(level);
            }
            break;
          }

          case "selectEffort": {
            const sel = message as { data: { effort: string } };
            const effort = sel.data?.effort;
            if (effort) {
              await this.piService.setEffort(effort);
            }
            break;
          }

          case "selectBudget": {
            const sel = message as { data: { value: number } };
            if (typeof sel.data?.value === "number") {
              await this.piService.setContextBudget(sel.data.value);
            }
            break;
          }

          case "toggleSettings":
            // Settings panel is toggled in-webview
            break;

          case "openUrl":
            vscode.env.openExternal(vscode.Uri.parse(message.url));
            break;

          case "openFile":
            vscode.window.showTextDocument(vscode.Uri.file(message.path));
            break;

          // Slash commands intercepted locally (not sent to LLM)
          case "slashCommand":
            void this.handleSlashCommand(message.command);
            break;

          // Settings toggle messages from webview (#3)
          case "toggleAutoCompaction":
            await this.piService.toggleAutoCompaction();
            break;

          case "toggleAutoRetry":
            await this.piService.toggleAutoRetry();
            break;

          case "toggleShowImages":
            await this.piService.toggleShowImages();
            break;

          // Request user messages list (#2)
          case "getUserMessages":
            this.postMessage({
              type: "user-messages-list",
              data: { messages: this.piService.userMessages.slice(-20) },
            });
            break;

          // Request settings state (#3)
          case "getSettings":
            this.piService.emitSettings();
            this.piService.emitScopedModels();
            break;

          // Context budget picker
          case "pickContextBudget":
            void this.triggerContextBudgetPicker();
            break;

          // Request settings state (#2, #8)
          case "resendUserMessage":
            if (message.text) {
              await this.piService.sendPrompt(message.text);
            }
            break;

          case "promoteToSteer":
            if (message.text) {
              await this.piService.promoteToSteer(message.text);
            }
            break;

          case "extension_ui_response":
            this.piService.resolveDialog(message.id, message.value);
            break;

          case "clearQueue":
            await this.piService.clearQueue();
            break;
        }
      },
      undefined,
      this.disposables
    );
  }

  private setupServiceHandlers(): void {
    // Remove any stale listener before adding a new one (prevents duplicates on panel reopen)
    this.cleanupPiListener();
    this.piCleanup = this.piService.onEvent((event: PiServiceEvent) => {
      this.postMessage(event);

      // Capture first user input for tab title summary.
      // Only generate if the session does NOT already have a stored name
      // (avoids overwriting a prior AI name or manual rename on reopen).
      if (event.type === "chat-message" && event.data?.role === "user" && !this._tabSummary && !this.piService.sessionName) {
        const text: string = event.data?.content ?? "";
        if (text.trim()) {
          // Persist a fallback name immediately so the session survives even
          // if the AI call times out or the tab closes before the model responds.
          const fallback = text.replace(/\s+/g, " ").trim().slice(0, 50);
          this._tabSummary = fallback;
          this.updateTabIndicator();
          this.piService.setSessionName(fallback);

          // Then try to upgrade to a concise AI-generated summary
          this.piService.generateTabSummary(text).then((summary) => {
            if (summary && summary !== fallback) {
              this._tabSummary = summary;
              this.updateTabIndicator();
              this.piService.setSessionName(summary);
            }
          }).catch(() => {});
        }
      }

      // When the SDK updates the session name/label, update the tab title
      if (event.type === "status-update" && event.data) {
        const sessionName = this.piService.sessionName;
        if (sessionName && sessionName !== this._tabSummary) {
          this._tabSummary = sessionName;
          this._tabInitialized = true;
          this.updateTabIndicator();
        }
      }

      // Track streaming state for the tab indicator
      if (event.type === "agent-start") {
        this._tabStreaming = true;
        this.updateTabIndicator();
      } else if (event.type === "agent-end") {
        this._tabStreaming = false;
        this.updateTabIndicator();
      } else if (event.type === "status-update" && event.data) {
        const wasStreaming = this._tabStreaming;
        this._tabStreaming = !!event.data.isStreaming;
        if (!event.data.ready && event.data.ready !== undefined) {
          this._tabInitialized = false;
        }
        if (this._tabStreaming !== wasStreaming) {
          this.updateTabIndicator();
        }
      }
    });
  }

  /** Check if the user is already authenticated (e.g., via CLI setup) and
   *  tell the webview to skip the welcome page if so. */
  private async _sendAuthStatus(): Promise<void> {
    try {
      const status = await PiService.checkStatus();
      const loggedIn = status.hasApiKey;
      this.postMessage({ type: "authStatus", data: { loggedIn } });
    } catch {
      // If check fails, default to showing welcome — user can still log in manually
      this.postMessage({ type: "authStatus", data: { loggedIn: false } });
    }
  }

  /** Send available models and thinking levels for in-webview dropdowns. */
  private async _sendOptions(): Promise<void> {
    try {
      const models = await this.piService.getAvailableModels();
      const currentModel = this.piService.model;
      const thinkingLevels = [
        { label: "off", description: "No thinking" },
        { label: "minimal", description: "Minimal thinking" },
        { label: "low", description: "Brief thinking" },
        { label: "medium", description: "Balanced thinking" },
        { label: "high", description: "Extended thinking" },
        { label: "xhigh", description: "Maximum thinking" },
      ];
      const currentThinking = this.piService.thinkingLevel ?? "off";
      const defaultThinking = this.piService.getDefaultThinking();

      this.postMessage({
        type: "setOptions",
        data: {
          models: models.map((m) => ({
            provider: m.provider,
            id: m.id,
            name: m.name,
            current: m.provider === currentModel?.provider && m.id === currentModel?.id,
          })),
          thinkingLevels: thinkingLevels.map((l) => ({
            label: l.label,
            description: l.description,
            current: l.label === currentThinking,
            isDefault: l.label === defaultThinking,
          })),
        },
      });
    } catch {
      // Non-critical: dropdowns will just be empty
    }
  }

  /** Update the tab title to indicate streaming / idle / init state.
   *  The in-webview status bar handles the visual color indicator;
   *  the tab uses a text suffix for streaming so it stays theme-consistent. */
  private updateTabIndicator(): void {
    if (!this.panel) { return; }

    // Static icon — no colour coding (SVGs can't adapt to theme variables)
    const piIcon = (name: string): vscode.Uri =>
      vscode.Uri.joinPath(this.context.extensionUri, "media", name);
    this.panel.iconPath = {
      light: piIcon("pi-icon-light.svg"),
      dark: piIcon("pi-icon-dark.svg"),
    };

    if (!this._tabInitialized) {
      this.panel.title = "Pi Code Gui";
      return;
    }

    const label = this._tabSummary ?? "Pi";
    // Bullet prefix: ● busy, ○ idle — consistent with status bar
    this.panel.title = (this._tabStreaming ? "\u25CF " : "\u25CB ") + label;
  }

  private cleanupPiListener(): void {
    if (this.piCleanup) {
      this.piCleanup();
      this.piCleanup = null;
    }
  }

  get summary(): string | null { return this._tabSummary; }

  postMessage(message: ExtensionToWebview | WebviewToExtension): void {
    // ── Layer 1: Validate extension→webview messages before posting ──
    // Webview-to-extension messages are validated on receipt by the extension host.
    // For extension→webview, we validate here to catch malformed events early.
    // We check if "type" is an extension→webview type (has data or is command).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msgType = (message as any).type;
    if (msgType && msgType !== "prompt" && msgType !== "abort" && msgType !== "slashCommand" &&
        msgType !== "pickModel" && msgType !== "pickThinkingLevel" && msgType !== "pickEffort" &&
        msgType !== "pickContextBudget" && msgType !== "getSettings" && msgType !== "toggleAutoCompaction" &&
        msgType !== "toggleAutoRetry" && msgType !== "toggleShowImages" && msgType !== "openUrl" &&
        msgType !== "openFile" && msgType !== "promoteToSteer" && msgType !== "clearQueue" &&
        msgType !== "resendUserMessage") {
      const result = validateExtensionToWebview(message);
      if (!result.success) {
        console.error(`[pi-gui] postMessage validation failed for type "${msgType}": ${result.error}`);
      }
    }
    this.panel?.webview.postMessage(message);
  }

  /** Insert a command or file reference into the chat input */
  postCommand(command: string): void {
    this.panel?.webview.postMessage({ type: "insertCommand", command });
  }

  /** Handle a locally-intercepted slash command (not sent to LLM) */
  private async handleSlashCommand(command: string): Promise<void> {
    switch (command) {
      case "login":
        await this.piService.login();
        break;
      case "logout":
        await this.piService.logout();
        break;
      case "model":
        await this.triggerModelPicker();
        break;
      case "thinking":
        await this.triggerThinkingPicker();
        break;
      case "sessions":
        await vscode.commands.executeCommand("pi-code-gui.sessions.focus");
        break;
      case "settings":
        await this.triggerSettingsPicker();
        break;
      default:
        // Forward to pi session so extension command handlers (e.g. /tldr) can respond
        try {
          await this.piService.sendPrompt(`/${command}`);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
          this.postMessage({
            type: "error",
            data: { message: e.message ?? String(e) },
          });
        }
        break;
    }
  }

  private getNonce(): string {
    let text = "";
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }

  private getWebviewContent(webview: vscode.Webview): string {
    const nonce = this.getNonce();
    const bundleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "bundle.js"),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "style.css"),
    );

    return renderTemplate({
      nonce,
      bundleUri: bundleUri.toString(),
      styleUri: styleUri.toString(),
      cspSource: webview.cspSource,
    });
  }

  /** Open VS Code quick pick to pick a model for the current session */
  private async triggerModelPicker(): Promise<void> {
    await this.piService.pickModel();
  }

  /** Open VS Code quick pick to pick thinking level */
  private async triggerThinkingPicker(): Promise<void> {
    await this.piService.pickThinkingLevel();
  }

  /** Open VS Code quick pick to set context budget */
  async triggerContextBudgetPicker(): Promise<void> {
    const ps = this.piService;
    const current = ps.getContextBudget();
    const budgets = [
      { label: "Model default", value: 0, description: "Use the model's built-in context window" },
      { label: "100K tokens", value: 100000, description: "Compact at ~0.1M" },
      { label: "200K tokens", value: 200000, description: "Compact at ~0.2M" },
      { label: "500K tokens", value: 500000, description: "Compact at ~0.5M" },
      { label: "1M tokens", value: 1000000, description: "Compact at ~1M" },
    ];
    const items = budgets.map((b) => ({
      label: `${b.label}${b.value === current ? " $(check)" : ""}`,
      description: b.description,
      value: b.value,
    }));
    const picked = await vscode.window.showQuickPick(items,
      { placeHolder: "Select per-session token budget. Takes effect on next session." },
    );
    if (!picked) { return; }
    await ps.setContextBudget(picked.value);
    vscode.window.showInformationMessage(
      picked.value === 0
        ? "Context budget: model default. Restart session to apply."
        : `Context budget set to ${formatBudget(picked.value)}. Restart session to apply.`,
    );
  }

  /** Open VS Code quick pick to pick effort */
  async triggerEffortPicker(): Promise<void> {
    const ps = this.piService;
    const levels = [
      { label: "auto", description: "Let the model decide" },
      { label: "none", description: "No effort" },
      { label: "low", description: "Low effort" },
      { label: "medium", description: "Medium effort" },
      { label: "high", description: "High effort" },
    ];
    const currentEffort = ps.effort || "auto";
    const items = levels.map((l) => ({
      label: `${l.label === currentEffort ? "$(check) " : ""}${l.label}`,
      description: l.description,
    }));
    const picked = await vscode.window.showQuickPick(items, { placeHolder: "Select effort level" });
    if (!picked) { return; }
    await ps.setEffort(picked.label);
  }

  /** Open VS Code quick pick for settings */
  private async triggerSettingsPicker(): Promise<void> {
    const ps = this.piService;
    const makeToggleLabel = (name: string, on: boolean): string =>
      `${on ? "$(check)" : "$(circle-outline)"} ${name}`;

    const items: vscode.QuickPickItem[] = [
      {
        label: makeToggleLabel("Auto-compaction", ps.autoCompactionEnabled),
        description: "Automatically compact context when limit is hit",
      },
      {
        label: makeToggleLabel("Auto-retry", ps.autoRetryEnabled),
        description: "Automatically retry on recoverable errors",
      },
      {
        label: makeToggleLabel("Show images", ps.showImages),
        description: "Display image attachments in chat",
      },
      {
        label: "$(graph) Context budget",
        description: `Current: ${ps.getContextBudget() === 0 ? "model default" : formatBudget(ps.getContextBudget())}`,
      },
    ];

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: "Pi settings — select to toggle or change",
    });
    if (!picked) { return; }

    if (picked.label.includes("Auto-compaction")) {
      await ps.toggleAutoCompaction();
    } else if (picked.label.includes("Auto-retry")) {
      await ps.toggleAutoRetry();
    } else if (picked.label.includes("Show images")) {
      await ps.toggleShowImages();
    } else if (picked.label.includes("Context budget")) {
      await this.triggerContextBudgetPicker();
    }
  }

  dispose(): void {
    this.cleanupPiListener();
    this.disposables.forEach((d) => d.dispose());
    this.panel?.dispose();
  }
}

function formatBudget(tokens: number): string {
  if (tokens < 1000) { return tokens.toString(); }
  if (tokens < 1000000) { return (tokens / 1000).toFixed(0) + "K"; }
  return (tokens / 1000000).toFixed(1) + "M";
}
