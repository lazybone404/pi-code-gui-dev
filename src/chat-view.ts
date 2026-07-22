// ChatViewProvider — webview-based chat in the sidebar.
// Replaces the old WebviewPanel approach. The chat is always visible
// in the pi-code-gui activity bar container.

/* eslint-disable @typescript-eslint/no-explicit-any */
import * as vscode from "vscode";
import { renderTemplate } from "./webview/template.js";
import type { PiServiceEvent } from "./types.js";

/** A single open session (tab in the nav bar). */
export interface SessionTab {
  id: string;
  name: string;
  piService: unknown; // PiService — avoid circular import
  sessionPath?: string | null;
}

/** External dependencies the view provider needs. */
export interface ChatViewDeps {
  getActiveSession(): SessionTab | null;
  getAllSessions(): SessionTab[];
  switchSession(id: string): Promise<void>;
  newSession(): Promise<SessionTab>;
  renameSession(id: string, name: string): Promise<void>;
  closeSession(id: string): Promise<void>;
  login(): Promise<void>;
  onSessionChange: vscode.EventEmitter<void>;
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
  private _view: vscode.WebviewView | null = null;
  private _disposables: vscode.Disposable[] = [];
  private readonly _deps: ChatViewDeps;
  private readonly _context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext, deps: ChatViewDeps) {
    this._context = context;
    this._deps = deps;
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._context.extensionUri],
    };

    const nonce = getNonce();
    const bundleUri = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(this._context.extensionUri, "media", "bundle.js"),
    );
    const styleUri = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(this._context.extensionUri, "media", "style.css"),
    );

    webviewView.webview.html = renderTemplate({
      nonce,
      bundleUri: bundleUri.toString(),
      styleUri: styleUri.toString(),
      cspSource: webviewView.webview.cspSource,
    });

    // ── Message handler ──
    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case "webviewReady": {
          this.post({ type: "setLocale", data: { locale: vscode.env.language } });
          await this.sendAuthStatus();
          await this.sendOptions();
          break;
        }
        case "loginTrigger":
          await this._deps.login();
          await this.sendAuthStatus();
          break;
        case "searchSessions":
          vscode.commands.executeCommand("pi-code-gui.filterPastSessions");
          break;
        case "prompt": {
          const session = this._deps.getActiveSession();
          if (session) {
            (session.piService as any).sendPrompt(message.text, message.images, message.mode)
              .catch((error: any) => {
                let errMsg = error.message ?? String(error);
                if (/api.?key|login|authenticate|provider/i.test(errMsg)) {
                  errMsg += "\n\n[Set up an API key →](https://pi.dev/docs/latest/quickstart)";
                }
                this.post({ type: "error", data: { message: errMsg } });
              });
          }
          break;
        }
        case "abort": {
          const session = this._deps.getActiveSession();
          if (session) { await (session.piService as any).abort(); }
          break;
        }
        case "selectModel": {
          const { provider, id } = message.data || {};
          const session = this._deps.getActiveSession();
          if (session && provider && id) {
            await (session.piService as any).setModel(provider, id);
          }
          break;
        }
        case "selectThinkingLevel": {
          const level = message.data?.level;
          const session = this._deps.getActiveSession();
          if (session && level) {
            await (session.piService as any).setThinkingLevel(level);
          }
          break;
        }
        case "selectEffort": {
          const effort = message.data?.effort;
          const session = this._deps.getActiveSession();
          if (session && effort) {
            await (session.piService as any).setEffort(effort);
          }
          break;
        }
        case "selectBudget": {
          const value = message.data?.value;
          const session = this._deps.getActiveSession();
          if (session && typeof value === "number") {
            await (session.piService as any).setContextBudget(value);
          }
          break;
        }
        case "tabSwitch":
          await this._deps.switchSession(message.data?.id);
          break;
        case "tabNew":
          await this._deps.newSession();
          break;
        case "tabClose":
          await this._deps.closeSession(message.data?.id);
          break;
        case "tabRename":
          await this._deps.renameSession(message.data?.id, message.data?.name);
          break;
      }
    });

    // ── Session change listener ──
    this._deps.onSessionChange.event(() => this.pushTabs());

    // ── Listen to active session events ──
    this.wireActiveSession();

    // ── Cleanup ──
    webviewView.onDidDispose(() => {
      this._disposables.forEach((d) => d.dispose());
      this._disposables = [];
      this._view = null;
    });
  }

  /** Send a message to the webview. */
  post(message: any): void {
    if (!this._view) { return; }
    try { this._view.webview.postMessage(message); } catch { /* channel closed */ }
  }

  /** Show the chat view. */
  show(): void {
    if (this._view) { this._view.show(true); }
  }

  // ── Private helpers ──

  private wireActiveSession(): void {
    this._disposables.forEach((d) => d.dispose());
    this._disposables = [];

    const session = this._deps.getActiveSession();
    if (!session) { return; }

    const cleanup = (session.piService as any).onEvent((event: PiServiceEvent) => {
      this.post(event);
    });

    this._disposables.push({ dispose: cleanup });
  }

  private async sendAuthStatus(): Promise<void> {
    try {
      // Check env var
      if (process.env.DEEPSEEK_API_KEY) {
        this.post({ type: "authStatus", data: { loggedIn: true } });
        return;
      }
      // Check SDK credentials
      const { PiService } = await import("./pi-service.js");
      const status = await PiService.checkStatus();
      this.post({ type: "authStatus", data: { loggedIn: status.hasApiKey } });
    } catch {
      this.post({ type: "authStatus", data: { loggedIn: false } });
    }
  }

  private async sendOptions(): Promise<void> {
    const session = this._deps.getActiveSession();
    if (!session) { return; }
    try {
      const ps = session.piService as any;
      const models = await ps.getAvailableModels();
      const currentModel = ps.model;
      const thinkingLevels = [
        { label: "off", description: "No thinking" },
        { label: "minimal", description: "Minimal" },
        { label: "low", description: "Brief" },
        { label: "medium", description: "Balanced" },
        { label: "high", description: "Extended" },
        { label: "xhigh", description: "Maximum" },
      ];
      const currentThinking = ps.thinkingLevel ?? "off";
      const defaultThinking = ps.getDefaultThinking();

      this.post({
        type: "setOptions",
        data: {
          models: models.map((m: any) => ({
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
    } catch { /* non-critical */ }
  }

  private pushTabs(): void {
    const sessions = this._deps.getAllSessions();
    const active = this._deps.getActiveSession();
    this.post({
      type: "sessionTabs",
      data: {
        tabs: sessions.map((s) => ({
          id: s.id,
          name: s.name,
          active: s.id === active?.id,
        })),
      },
    });
  }
}

function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
