import * as path from "node:path";
import * as fs from "node:fs";
import * as vscode from "vscode";
import { createBridgeTools } from "./bridge-tools.js";
import { type PiServiceEvent, validateExtensionToWebview } from "./types.js";
import type { SessionSummary } from "./types.js";
import { piLog, piWarn } from "./logger.js";
import { AuthService } from "./services/auth.js";
import { ModelService } from "./services/model.js";
import { buildSystemPrompt, buildContextFiles, buildPromptTemplates } from "./services/prompts.js";

import {
  type PiSdk,
  type InstallStatus,
  reverseFind,
  importWithRetry,
  resolvePiPackagePath,
} from "./services/sdk.js";

// Re-export for other modules that depend on this
const PiEventListener: unique symbol = Symbol('PiEventListener');
type PiEventListener = (event: PiServiceEvent) => void;

export { resolvePiPackagePath };

// ── PiService ────────────────────────────────────────────

export class PiService {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  private session: any = null;
  private unsubscribe: (() => void) | null = null;
  private listeners: PiEventListener[] = [];
  private _model: { id?: string; name?: string; provider?: string } | null = null;
  private _thinkingLevel = "off";
  private _effort = "auto";
  private _isStreaming = false;
  private _sessionNamed = false;
  private sessionId: string | null = null;

  // SDK root path (for re-importing individual modules)
  private _piRoot: string | null = null;

  // SDK instances (loaded at init time)
  /* eslint-disable @typescript-eslint/no-explicit-any -- SDK objects are dynamically typed */
  private SDK: PiSdk | null = null;
  private modelRuntime: any = null;
  private modelRegistry: any = null;
  private authService: AuthService | null = null;
  private modelService: ModelService | null = null;
  private settingsManager: any = null;
  private sessionManager: any = null;
  private resourceLoader: any = null;

  // Model cycling state (populated dynamically from registry)
  private cycleModels: Array<{ provider: string; id: string }> = [];
  private cycleIndex = 0;

  // Track current assistant message content (for toolCall stubs during message_update)
  private currentAssistantToolCalls: Map<string, { toolName: string; toolCallId: string; args: any }> = new Map();

  // Widget activity timer (cleared on dispose to prevent leaks)
  private _widgetTimer: ReturnType<typeof setInterval> | null = null;

  /* eslint-enable @typescript-eslint/no-explicit-any */

  // Pending interactive dialogs (select/confirm/input).  Maps dialog ID → Promise resolve.
  private _pendingDialogs = new Map<string, { resolve: (v: unknown) => void }>();

  // Turn tracking (like AgentSession._turnIndex in the SDK)
  private turnIndex = 0;

  // User message history for the resend/reuse feature (#2)
  private _userMessages: Array<{ id: string; text: string; timestamp?: number }> = [];

  // Settings state (#3)
  private _autoCompactionEnabled = true;
  private _autoRetryEnabled = true;
  private _showImages = true;

  constructor() {}

  // ── Public API ─────────────────────────────────────────

  onEvent(listener: PiEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private emit(event: PiServiceEvent): void {
    // ── Layer 1: Runtime protocol validation ───────────────
    // Validates every outgoing message against the Zod schema.
    // If validation fails, we STILL emit to avoid breaking existing
    // functionality, but log the error and show a diagnostic notification.
    const result = validateExtensionToWebview(event);
    if (!result.success) {
      piWarn(`[protocol] emit validation failed for type "${(event as Record<string, unknown>).type}": ${result.error}`);
      // Emit a visible diagnostic so the user (and us) can see the issue
      this.emitSafe({
        type: "custom-message",
        data: {
          customType: "pi-gui-diagnostic",
          content: `Protocol validation error (type: ${(event as Record<string, unknown>).type}): ${result.error.substring(0, 200)}`,
          display: false,
        },
      });
    }
    // Dispatch to listeners (always, even on validation failures for backward compat)
    for (const l of this.listeners) {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      try { l(event); } catch (e: any) {
        piWarn(`emit listener threw for type "${(event as Record<string, unknown>).type}": ${e?.message ?? e}`);
      }
    }
  }

  /** Emit without validation (used internally to avoid recursive validation on diagnostics). */
  private emitSafe(event: PiServiceEvent): void {
    for (const l of this.listeners) {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      try { l(event); } catch (e: any) {
        piWarn(`emitSafe listener threw for type "${(event as Record<string, unknown>).type}": ${e?.message ?? e}`);
      }
    }
  }

  static async checkInstall(): Promise<InstallStatus> {
    try {
      const p = resolvePiPackagePath();

      // Verify critical transitive dependencies are actually present (not just
      // package.json stubs — npm global install hoisting can leave hollow dirs).
      const missing: string[] = [];
      const criticalDeps: Array<[string, string]> = [
        ["openai", "index.js"],
        ["@anthropic-ai/sdk", "index.mjs"],
      ];
      for (const [dep, entry] of criticalDeps) {
        const candidate = path.join(p, "node_modules", dep, entry);
        if (!fs.existsSync(candidate)) {
          // Also check top-level hoist (npm global installs sometimes hoist to
          // the global node_modules directly).
          const globalCandidate = path.join(p, "..", "..", dep, entry);
          if (!fs.existsSync(globalCandidate)) {
            missing.push(dep);
          }
        }
      }

      if (missing.length > 0) {
        return {
          installed: false,
          hasApiKey: false,
          error:
            `Pi SDK found but dependencies are missing: ${missing.join(", ")}. ` +
            `Reinstall with: npm uninstall -g @earendil-works/pi-coding-agent && npm install -g @earendil-works/pi-coding-agent`,
        };
      }

      return { installed: true, hasApiKey: true, path: p };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      return { installed: false, hasApiKey: false, error: e.message ?? String(e) };
    }
  }

  /** List past (saved-on-disk) sessions for the given cwd. */
  static async listSessions(cwd: string): Promise<SessionSummary[]> {
    try {
      const piRoot = resolvePiPackagePath();
      // Match initialize()'s retry parameters — fewer retries here
      // caused past-session lists to come up empty on slow first loads.
      const SDK = await importWithRetry(path.join(piRoot, "dist/index.js"), 5, 500);
      const cfg = vscode.workspace.getConfiguration("pi-code-gui");
      const sessionDir = cfg.get<string>("sessionDir")?.trim() || undefined;
      const sessions: SessionSummary[] = await SDK.SessionManager.list(cwd, sessionDir);
      // Enrich with model info from session entries (lightweight: reads only entries)
      for (const s of sessions) {
        try {
          const sm = SDK.SessionManager.open(s.path);
          const entries = sm.getEntries?.() ?? [];
          // Find last model_change entry
          for (let i = entries.length - 1; i >= 0; i--) {
            const e = entries[i] as Record<string, unknown>;
            if (e.type === "model_change" && e.modelId) {
              s.model = String(e.modelId);
              break;
            }
          }
          // Count token usage
          let tokens = 0;
          for (const e of entries) {
            const entry = e as Record<string, unknown>;
            if (entry.usage && typeof (entry.usage as Record<string, unknown>).totalTokens === "number") {
              tokens += (entry.usage as Record<string, unknown>).totalTokens as number;
            }
          }
          if (tokens > 0) { s.tokenCount = tokens; }
        } catch { /* skip session read errors */ }
      }
      piLog(`listSessions: found ${sessions.length} past sessions in ${cwd}`);
      return sessions;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      piWarn(`listSessions failed: ${e.message ?? e}`);
      return [];
    }
  }

  /** Quick check: is pi installed and are credentials present?
   *  Tries SDK credentials first, then environment variable as fallback. */
  static async checkStatus(): Promise<{ installed: boolean; hasApiKey: boolean; error?: string }> {
    try {
      // Check env var first (fast path — no SDK import needed)
      if (process.env.DEEPSEEK_API_KEY) {
        return { installed: true, hasApiKey: true };
      }

      const piRoot = resolvePiPackagePath();
      if (!piRoot) { return { installed: false, hasApiKey: false, error: "pi not installed" }; }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const SDK: any = await importWithRetry(path.join(piRoot, "dist/index.js"), 3, 300);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const creds: any[] = await SDK.ModelRuntime.listCredentials();
      return { installed: true, hasApiKey: creds.length > 0 };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      return { installed: false, hasApiKey: false, error: e.message ?? String(e) };
    }
  }

  /** Delete a session file from disk. */
  static async deleteSessionFile(filePath: string): Promise<void> {
    if (typeof filePath !== "string") {
      throw new Error("deleteSessionFile: filePath must be a string");
    }
    await fs.promises.unlink(filePath);
  }

  async initialize(opts?: { fresh?: boolean; openPath?: string }): Promise<{ success: boolean; error?: string }> {
    const fresh = opts?.fresh ?? false;
    const openPath = opts?.openPath ?? null;
    // ── Step 1: Resolve SDK ────────────────────────────
    try {
      this._piRoot = resolvePiPackagePath();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      return { success: false, error: `SDK not found: ${e.message ?? e}` };
    }

    // ── Step 2: Load SDK modules ───────────────────────
    try {
      this.SDK = (await importWithRetry(
        path.join(this._piRoot, "dist/index.js"), 5, 500
      )) as PiSdk;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      return { success: false, error: `Failed to load pi-coding-agent: ${e.message ?? e}` };
    }

    // Load typebox for defineTool usage (with retry — npm install may still
    // be populating node_modules when the extension host first activates).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    let Type: any;
    try {
      const Typebox = await importWithRetry(
        path.join(this._piRoot, "node_modules/typebox/build/index.mjs"),
        5,  // max attempts
        500 // delay ms between attempts
      );
      Type = Typebox.Type ?? Typebox;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      return { success: false, error: `Failed to load typebox: ${e.message ?? e}` };
    }

    const SDK = this.SDK;
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

    // ── Step 3: Auth & model registry ──────────────────
    try {
      this.modelRuntime = await SDK.ModelRuntime.create();

      // Runtime API key override from VS Code settings
      const config = vscode.workspace.getConfiguration("pi-code-gui");
      const anthropicKey = config.get<string>("anthropicApiKey");
      if (anthropicKey) {
        await this.modelRuntime.setRuntimeApiKey("anthropic", anthropicKey);
      }
      const openaiKey = config.get<string>("openaiApiKey");
      if (openaiKey) {
        await this.modelRuntime.setRuntimeApiKey("openai", openaiKey);
      }

      // Use ModelRuntime directly for all auth operations
      this.modelRegistry = new SDK.ModelRegistry(this.modelRuntime);
      this.authService = new AuthService({
        modelRuntime: this.modelRuntime,
        modelRegistry: this.modelRegistry,
        get model() { return this._model; },
        setModel: (provider: string, modelId: string) => this.setModel(provider, modelId),
      });
      // ModelService needs PiService's internal state — capture via closure
      const pi = this;
      this.modelService = new ModelService({
        modelRuntime: this.modelRuntime,
        modelRegistry: this.modelRegistry,
        get session() { return pi.session; },
        get model() { return pi._model; },
        set model(m: { id?: string; provider?: string } | null) { pi._model = m; },
        get thinkingLevel() { return pi._thinkingLevel; },
        set thinkingLevel(l: string) { pi._thinkingLevel = l; },
        cycleModels: pi.cycleModels,
        cycleIndex: pi.cycleIndex,
        forcePersistEntry: (entry: Record<string, unknown>) => pi._forcePersistEntry(entry),
        reportStatus: () => pi.reportStatus(),
      });
      this.settingsManager = SDK.SettingsManager.create(cwd);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      return { success: false, error: `Auth/registry setup failed: ${e.message ?? e}` };
    }

    // ── Step 4: Pick a model (dynamic from registry) ──
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    let model: any = null;
    try {
      // Try registry first (respects API keys)
      const available = await this.modelRegistry.getAvailable();
      if (available.length > 0) {
        model = available[0];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.cycleModels = available.map((m: any) => ({ provider: m.provider, id: m.id }));
      } else {
        // Fallback: try built-in models via modelRegistry.find() and getModel()
        this.cycleModels = [];
        for (const candidate of [
          ["anthropic", "claude-sonnet-4-5"],
          ["anthropic", "claude-haiku-4-5"],
          ["openai", "gpt-4o"],
        ]) {
          const found = this.modelRegistry.find(candidate[0], candidate[1]);
          if (found) {
            this.cycleModels.push({ provider: candidate[0], id: candidate[1] });
            if (!model) { model = found; }
          }
        }
        // Try getModel for models not in registry but built-in
        if (!model) {
          for (const candidate of [
            ["anthropic", "claude-sonnet-4-5"],
            ["anthropic", "claude-haiku-4-5"],
            ["openai", "gpt-4o"],
          ]) {
            const m = this.modelRuntime.getModel(candidate[0], candidate[1]);
            if (m) { model = m; break; }
          }
        }
      }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      return { success: false, error: `Model lookup failed: ${e.message ?? e}` };
    }

    if (!model) {
      return {
        success: false,
        error: "No model available. Set an API key (e.g. ANTHROPIC_API_KEY) and restart.",
      };
    }

    // ── Override with user's default model from VS Code settings ──
    const cfg = vscode.workspace.getConfiguration("pi-code-gui");
    const defProvider = cfg.get<string>("defaultModelProvider");
    const defModelId = cfg.get<string>("defaultModelId");
    if (defProvider && defModelId) {
      const defModel = this.modelRegistry.find(defProvider, defModelId) ?? this.modelRuntime.getModel(defProvider, defModelId);
      if (defModel) { model = defModel; }
    }

    // ── Override context budget from VS Code settings ──
    const contextBudget = cfg.get<number>("contextBudget") ?? 0;
    if (contextBudget > 0) {
      model = { ...model, contextWindow: contextBudget };
    }

    this._model = { id: model.id, name: model.name, provider: model.provider };

    // ── Step 5: ResourceLoader ─────────────────────────
    // Builds custom system prompt, skills, context files, and prompt templates
    try {
      const DefaultResourceLoader = SDK.DefaultResourceLoader;
      const getAgentDir = SDK.getAgentDir;

      const contextFiles = buildContextFiles(cwd);
      const templates = buildPromptTemplates(SDK.createSyntheticSourceInfo);

      this.resourceLoader = new DefaultResourceLoader({
        cwd,
        agentDir: getAgentDir ? getAgentDir() : undefined,
        // Custom system prompt with VS Code context
        systemPromptOverride: () => buildSystemPrompt(),
        // Prevent DefaultResourceLoader from appending default append files
        appendSystemPromptOverride: () => [],
        // Inject virtual context files with project-specific guidelines
// eslint-disable-next-line @typescript-eslint/no-explicit-any
        agentsFilesOverride: (current: any) => ({
          agentsFiles: [...current.agentsFiles, ...contextFiles],
        }),
        // Inject custom slash commands
// eslint-disable-next-line @typescript-eslint/no-explicit-any
        promptsOverride: (current: any) => ({
          prompts: [...current.prompts, ...templates],
          diagnostics: current.diagnostics,
        }),
      });
      await this.resourceLoader.reload();

      // Report discovered resources
      const { skills: discoveredSkills } = this.resourceLoader.getSkills();
      piLog(`Extensions: ${discoveredSkills.map((s: Record<string, unknown>) => s.name).join(", ") || "none"}`);
    } catch (e: unknown) {
      piWarn(`ResourceLoader setup warning: ${e instanceof Error ? e.message : String(e)}`);
      // Non-fatal: ResourceLoader is optional, session can work without it
    }

    // ── Step 6: Session tools ──────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    let tools: any[];
    try {
      tools = [
        ...SDK.createCodingTools(cwd),
        ...createBridgeTools(SDK.defineTool, Type),
      ];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      return { success: false, error: `Tool setup failed: ${e.message ?? e}` };
    }

    // ── Step 7: Session manager ─────────────────────
    try {
      const cfg = vscode.workspace.getConfiguration("pi-code-gui");
      const sessionDir = cfg.get<string>("sessionDir")?.trim() || undefined;
      if (openPath) {
        this.sessionManager = SDK.SessionManager.open(openPath, sessionDir);
      } else if (fresh) {
        this.sessionManager = SDK.SessionManager.create(cwd, sessionDir);
      } else {
        try {
          this.sessionManager = await SDK.SessionManager.continueRecent(cwd);
        } catch {
          this.sessionManager = SDK.SessionManager.create(cwd, sessionDir);
        }
      }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      return { success: false, error: `Session manager failed: ${e.message ?? e}` };
    }

    // ── Step 8: Restore model & thinking from session file (if resuming) ──
    //        Applies to both openPath (resume from Past Sessions) and
    //        continueRecent (restoring after VS Code restart).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    let resumeModel: any = model;
    let resumeThinkingLevel = cfg.get<string>("defaultThinkingLevel") ?? "off";
    let foundSessionModel = false;
    let foundSessionThinking = false;
    const isResuming = !fresh && this.sessionManager;
    if (isResuming) {
      const entries = this.sessionManager.getEntries?.();
      if (Array.isArray(entries)) {
        piLog(`Restoring model/thinking from session: ${entries.length} entries`);
        // Walk entries in reverse to find the last model_change and thinking_level_change
        for (let i = entries.length - 1; i >= 0; i--) {
          const e = entries[i];
          if (!foundSessionModel && e.type === "model_change" && e.provider && e.modelId) {
            // Try to resolve the model from the registry
            const found = this.modelRegistry.find(e.provider, e.modelId);
            if (found) {
              resumeModel = found;
              foundSessionModel = true;
              piLog(`Restored model from session: ${e.provider}/${e.modelId}`);
            } else {
              // Fallback: try getModel
              const m = this.modelRuntime.getModel(e.provider, e.modelId);
              if (m) {
                resumeModel = m;
                foundSessionModel = true;
                piLog(`Restored model from session (fallback): ${e.provider}/${e.modelId}`);
              } else {
                piWarn(`Could not resolve session model: ${e.provider}/${e.modelId}`);
              }
            }
          }
          if (!foundSessionThinking && e.type === "thinking_level_change" && e.thinkingLevel) {
            resumeThinkingLevel = e.thinkingLevel;
            foundSessionThinking = true;
            piLog(`Restored thinking from session: ${e.thinkingLevel}`);
          }
          // Stop early once both are resolved
          if (foundSessionModel && foundSessionThinking) { break; }
        }
        if (!foundSessionModel) { piLog("No model_change entry found in session"); }
        if (!foundSessionThinking) { piLog("No thinking_level_change entry found in session"); }
      }
    } else {
      piLog(`Skipping session restore (fresh=${fresh}, hasSessionManager=${!!this.sessionManager})`);
    }

    // ── Step 9: Create agent session ───────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    let result: any;
    try {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      const opts: any = {
        model: resumeModel,
        thinkingLevel: resumeThinkingLevel,
        modelRuntime: this.modelRuntime,
        settingsManager: this.settingsManager,
        sessionManager: this.sessionManager,
        customTools: tools,
        cwd,
      };

      // Scoped models from registry (dynamic)
      if (this.cycleModels.length > 0) {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
        opts.scopedModels = this.cycleModels.map((m: any) => ({
          model: this.modelRuntime.getModel(m.provider, m.id),
          thinkingLevel: "off",
        }));
      }

      // ResourceLoader with custom system prompt, context files, templates
      if (this.resourceLoader) {
        opts.resourceLoader = this.resourceLoader;
      }

      // Inject before extensions load (SDK may load them during createAgentSession)
      (globalThis as Record<string, unknown>).__piRegisterMessageRenderer = (customType: string, sourceCode: string) => {
        this.emit({ type: "registerMessageRenderer", data: { customType, sourceCode } });
      };

      result = await SDK.createAgentSession(opts);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      return { success: false, error: `createAgentSession failed: ${e.message ?? e}` };
    }

    this.session = result.session;
    this._thinkingLevel = resumeThinkingLevel;
    this.sessionId = this.session.sessionId;
    this._sessionNamed = false;

    // Restore active tools from session file (if resuming)
    if (isResuming) {
      this._restoreActiveToolsFromSession();
    }

    // Update cached model if resume overrode it
    if (resumeModel !== model) {
      this._model = { id: resumeModel.id, name: resumeModel.name, provider: resumeModel.provider };
    }

    // ── Step 10: Subscribe to events ───────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.unsubscribe = this.session.subscribe((event: any) => {
      this.handleAgentEvent(event);
    });

    // ── Step 11: Bind extensions with webview-bridged UIContext ─
    await this.bindExtensionUI();

    // ── Step 12: Send initial message history (like TUI renderInitialMessages) ──
    const hasEntries = (this.sessionManager?.getEntries?.()?.length ?? 0) > 0;
    this.emit({ type: "batch-start", data: { hasEntries } });
    await this.sendInitialMessages();
    this.emit({ type: "batch-end", data: { hasEntries } });

    this.reportStatus();
    try {
      this.emitScopedModels();
      this.emitSettings();
      this.emitSlashCommands();
    } catch (e: unknown) {
      piWarn(`Post-init emissions failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    return { success: true };
  }

  // ── Extension UI Bridge ────────────────────────────

  /**
   * Bind extensions with a UIContext that bridges to the VS Code webview.
   * Without this, extensions like pi-tldr have hasUI=false and their
   * notify/setWidget calls silently do nothing.
   */
  private async bindExtensionUI(): Promise<void> {
    if (!this.session || typeof this.session.bindExtensions !== "function") {
      return;
    }

    const emit = (event: PiServiceEvent): void => this.emit(event);

    // Active widgets keyed by widget key (rendered text per widget)
    const widgetTexts = new Map<string, string>();
    const widgetLastUpdate = new Map<string, number>();
    // Periodically check for stale widgets (not updated in 30s) and clear them.
    // This prevents orphaned animations from running forever when extensions
    // forget to call stopWidgetAnimation (e.g. pi-subagents async jobs).
    const MAX_WIDGET_IDLE_MS = 30_000;
    this._widgetTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, lastUpdate] of widgetLastUpdate) {
        if (now - lastUpdate > MAX_WIDGET_IDLE_MS) {
          widgetTexts.delete(key);
          widgetLastUpdate.delete(key);
          emit({ type: "widget-update", data: { key, content: null } });
        }
      }
    }, 10_000);
    if (this._widgetTimer.unref) { this._widgetTimer.unref(); }

    // Base uiContext with the methods we explicitly support.
    // Wrapped in a Proxy so any unknown method calls (e.g. from TUI-only
    // extensions) silently no-op instead of throwing "is not a function".
    const baseUIContext = {
      notify: (message: string, level: "info" | "error") => {
        if (level === "error") {
          piWarn(`ui.notify(error): ${message.substring(0, 120)}`);
        }
        emit({
          type: "custom-message",
          data: {
            customType: level === "error" ? "error" : "extension-notify",
            content: message,
            timestamp: Date.now(),
          },
        });
      },
      setWidget: (key: string, factory: unknown) => {
        if (factory === undefined || factory === null) {
          // Clear widget
          widgetTexts.delete(key);
          widgetLastUpdate.delete(key);
          emit({
            type: "widget-update",
            data: { key, content: null },
          });
          return;
        }

        if (typeof factory !== "function") {
          piWarn(`setWidget("${key}"): factory is not a function (got ${typeof factory})`);
          return;
        }

        try {
          // Minimal Theme stub: fg returns text without ANSI codes.
          // Widgets render in an HTML webview so ANSI colors are unnecessary.
          const theme = {
            fg: (_role: string, text: string) => text,
          };
          // Minimal TUI stub — extensions that need tui methods won't work,
          // but pi-tldr and similar widgets only use theme.
          const tui = {};

          const component = (factory)(tui, theme) as {
            render?: (width: number) => string[];
          };
          if (!component || typeof component.render !== "function") {
            piWarn(`setWidget("${key}"): component.render is not a function`);
            return;
          }

          const lines = component.render(80);
          if (!Array.isArray(lines)) {
            piWarn(`setWidget("${key}"): render() did not return an array`);
            return;
          }

          // Strip any remaining ANSI escape codes (just in case)
          const ansiRegex = /\x1b\[[0-9;]*m|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[_][^\x07\x1b]*(?:\x07|\x1b\\)/g;
          const cleanLines = lines.map((l: string) => l.replace(ansiRegex, ""));
          const content = cleanLines.join("\n");

          // Skip if unchanged
          if (widgetTexts.get(key) === content) { return; }
          widgetTexts.set(key, content);
          widgetLastUpdate.set(key, Date.now());

          emit({
            type: "widget-update",
            data: { key, content },
          });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
          // Widget rendering is best-effort; don't crash the session.
          piWarn(`setWidget("${key}"): render error: ${e?.message ?? e}`);
        }
      },
      // Interactive methods — return Promises that resolve when the user
      // dismisses the dialog in the webview.  Falls back to undefined if
      // no webview panel is active (e.g. during tests).
      select: (prompt: string, options: string[]) => {
        return this._showDialog("select", prompt, { options });
      },
      confirm: (prompt: string) => {
        return this._showDialog("confirm", prompt, {});
      },
      input: (prompt: string, defaultValue?: string) => {
        return this._showDialog("input", prompt, { defaultValue });
      },
      custom: () => undefined,

      // TUI compatibility stubs discovered via the Proxy at runtime
      setToolsExpanded: (_expanded: boolean) => { /* stub — TUI widget expand/collapse */ },
      getToolsExpanded: () => false,
      requestRender: () => { /* stub — TUI repaint, not needed in webview */ },
      onTerminalInput: (_handler: unknown) => { /* stub */ },
      setStatus: (key: string, status: string | null) => {
        // Show as a widget card so status is visible in VS Code
        if (status === null || status === undefined) {
          widgetTexts.delete(`status-${key}`);
          emit({ type: "widget-update", data: { key: `status-${key}`, content: null } });
        } else {
          const content = `**${key}** ${status}`;
          widgetTexts.set(`status-${key}`, content);
          emit({ type: "widget-update", data: { key: `status-${key}`, content } });
        }
      },
    };

    // Proxy: log unknown method calls so we can see what TUI methods
    // extensions expect, then no-op gracefully instead of crashing.
    const uiContext = new Proxy(baseUIContext, {
      get(target, prop) {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (prop in target) { return (target as any)[prop]; }
        if (typeof prop === "string" && !prop.startsWith("_")) {
          return (...args: unknown[]) => {
            piWarn(`ui.${prop}() called by extension but not implemented — args: ${JSON.stringify(args).substring(0, 200)}`);
          };
        }
        return undefined;
      },
    });

    try {
      await this.session.bindExtensions({
        uiContext,
        onError: (error: Error, extensionPath: string) => {
          piWarn(`Extension error [${extensionPath}]: ${error?.message ?? error}`);
        },
      });
      piLog("Extension UI context bound");
      // Log which extensions have handlers registered
      if (this.session?._extensionRunner) {
        const paths = this.session._extensionRunner.getExtensionPaths?.() ?? [];
        piLog(`Loaded extensions: ${paths.length > 0 ? paths.join(", ") : "none"}`);
      }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      piWarn(`bindExtensions failed: ${e.message ?? e}`);
    }

    // Push updated slash-command list after extensions register commands
    this.emitSlashCommands();
  }

  /** Get all slash commands available to the user.
   *  Includes extension-registered commands, builtin SDK commands,
   *  and builtin prompt templates.  Each entry carries a `source`
   *  field so the UI can group or label them. */
  getAllSlashCommands(): Array<{ cmd: string; desc: string; source: string }> {
    const result: Array<{ cmd: string; desc: string; source: string }> = [];

    // ── Extension commands ──────────────────────────
    try {
 
      const rawSession = (this.session);
      const runner = rawSession?._extensionRunner;
      if (runner && typeof runner.getRegisteredCommands === "function") {
        const commands = runner.getRegisteredCommands();
        if (commands && commands.length > 0) {
          for (const c of commands) {
            const source = c?.sourceInfo?.source
              ? `extension (${c.sourceInfo.source})`
              : "extension";
            result.push({
              cmd: `/${c.invocationName}`,
              desc: c.description ?? "",
              source,
            });
          }
        }
      }
    } catch (e: unknown) { piWarn(`Best-effort failure: ${e instanceof Error ? e.message : String(e)}`); }

    // ── Builtin prompt templates ────────────────────
    result.push(
      { cmd: "/fix-diagnostics", desc: "Fix all diagnostics in open file", source: "builtin" },
      { cmd: "/explain-code", desc: "Explain the code at current cursor position", source: "builtin" },
      { cmd: "/refactor", desc: "Refactor the selected code", source: "builtin" },
    );

    // ── Builtin SDK commands ────────────────────────
    result.push(
      { cmd: "/model", desc: "Switch model", source: "builtin" },
      { cmd: "/new", desc: "Start new session", source: "builtin" },
      { cmd: "/resume", desc: "Resume a previous session", source: "builtin" },
      { cmd: "/fork", desc: "Fork session from message", source: "builtin" },
      { cmd: "/compact", desc: "Compact context", source: "builtin" },
      { cmd: "/export", desc: "Export session to HTML", source: "builtin" },
      { cmd: "/settings", desc: "Open settings", source: "builtin" },
      { cmd: "/login", desc: "Configure provider authentication", source: "builtin" },
      { cmd: "/logout", desc: "Remove provider authentication", source: "builtin" },
      { cmd: "/debug", desc: "Dump webview state for troubleshooting", source: "builtin" },
      { cmd: "/tools", desc: "Select which tools are active", source: "builtin" },
    );

    return result;
  }

  /** Emit all registered slash commands to the webview for autocomplete. */
  emitSlashCommands(): void {
    const all = this.getAllSlashCommands();
    this.emit({
      type: "slash-commands-update",
      data: { commands: all },
    });
  }

  /** Send existing session messages to the webview on initial load (or after reload). */
  async sendInitialMessages(): Promise<void> {
    // Build session context from the session manager
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    let entries: any[];
    try {
      entries = this.sessionManager.getEntries();
      piLog(`sendInitialMessages: ${entries?.length ?? 0} entries`);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      piWarn(`sendInitialMessages: getEntries failed: ${e.message}`);
      return;
    }
    if (!entries || entries.length === 0) { return; }

    // Pre-index tool results by call ID (O(n) instead of O(n²) .find() per entry)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolResultsById = new Map<string, any>();
    for (const e of entries) {
      if (e.type === "message" && e.message?.role === "toolResult") {
        toolResultsById.set(e.message.toolCallId, e);
      }
    }

    // Replay entries top-down (oldest first), yielding to the event loop
    // between each entry.  This guarantees correct visual order (oldest at
    // top, newest at bottom) and prevents the synchronous DOM flood that
    // would crash the extension host on large sessions.
    const yieldTick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry.type === "message" && entry.message) {
        const msg = entry.message;
        if (msg.role === "user") {
          const text = this.extractTextFromContent(msg.content);
          if (text) {
            this._userMessages.push({ id: msg.id ?? `user-${Date.now()}`, text, timestamp: msg.timestamp });
            if (this._userMessages.length > 50) { this._userMessages.shift(); }
            this.emit({ type: "chat-message", data: { role: "user", content: text, entryId: entry.id } });
          }
        } else if (msg.role === "assistant") {
          const text = this.extractTextFromContent(msg.content);
          const thinking = this.extractThinkingFromContent(msg.content);
          const toolCalls = this.extractToolCallsFromContent(msg.content);
          

          // Always emit assistant messages — even tool-only ones with no text.
          // Skipping them makes tool executions invisible on reload/resume.
          this.emit({ type: "assistant-start", data: { messageId: msg.id, entryId: entry.id } });
          // Emit thinking content first, then text
          if (thinking) {
            this.emit({ type: "thinking-delta", data: { delta: thinking } });
            this.emit({ type: "thinking-delta", data: { delta: "", done: true } });
          }
          if (text) {
            this.emit({ type: "stream-delta", data: { delta: text } });
          }
          this.emit({
            type: "assistant-end",
            data: {
              stopReason: msg.stopReason,
              errorMessage: msg.errorMessage,
              toolCalls: toolCalls.map((tc) => tc.id),
            },
          });

          for (const tc of toolCalls) {
            const toolResultEntry = toolResultsById.get(tc.id);
            if (tc.name === "bash" || tc.name === "exec") {
              this.emit({ type: "bash-start", data: { toolCallId: tc.id, command: tc.arguments?.command ?? "", entryId: toolResultEntry?.id } });
              const outputText = toolResultEntry?.message
                ? this.extractTextFromContent(toolResultEntry.message.content)
                : "";
              this.emit({
                type: "bash-end",
                data: { toolCallId: tc.id, command: tc.arguments?.command ?? "", exitCode: 0, cancelled: false, output: outputText, isError: false, entryId: toolResultEntry?.id },
              });
            } else {
              this.emit({ type: "tool-start", data: { toolCallId: tc.id, toolName: tc.name, args: tc.arguments, fromMessage: true, entryId: toolResultEntry?.id } });
              if (toolResultEntry?.message) {
                this.emit({ type: "tool-end", data: { toolCallId: tc.id, toolName: tc.name, result: toolResultEntry.message, isError: false, entryId: toolResultEntry?.id } });
              } else {
                this.emit({ type: "tool-end", data: { toolCallId: tc.id, toolName: tc.name, result: { content: [{ type: "text", text: "(completed)" }] }, isError: false, entryId: toolResultEntry?.id } });
              }
            }
          }
        } else if (msg.role === "custom") {
          this.emit({ type: "custom-message", data: { customType: msg.customType, content: msg.content, display: msg.display, details: msg.details, timestamp: msg.timestamp, entryId: entry.id } });
        } else if (msg.role === "bashExecution") {
          const bashEntryId = entry.id ?? `bash-${Date.now()}`;
          this.emit({ type: "bash-start", data: { toolCallId: bashEntryId, command: msg.command ?? "", entryId: entry.id } });
          this.emit({ type: "bash-end", data: { toolCallId: bashEntryId, command: msg.command ?? "", exitCode: msg.exitCode, cancelled: msg.cancelled, output: msg.output ?? "", isError: msg.exitCode !== 0 && msg.exitCode !== null, entryId: entry.id } });
        }
      } else if (entry.type === "compaction") {
        this.emit({
          type: "compaction-summary-message",
          data: { summary: entry.summary ?? "", tokensBefore: entry.tokensBefore ?? 0, timestamp: this._toTimestamp(entry.timestamp), entryId: entry.id },
        });
      }

      // Yield after every entry so the webview paints incrementally.
      await yieldTick();
    }
  }

  // ── Agent event → PiServiceEvent translation ────────────

  /** SDK entries store timestamps as ISO strings; protocol expects numbers. */
  private _toTimestamp(ts: unknown): number {
    if (typeof ts === "number") { return ts; }
    if (ts) { return Date.parse(String(ts)); }
    return Date.now();
  }

  /** Extract plain text from a message content (string or array) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractTextFromContent(content: any): string {
    if (!content) { return ""; }
    if (typeof content === "string") { return content; }
    if (Array.isArray(content)) {
      return content
// eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((c: any) => c.type === "text")
// eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((c: any) => c.text)
        .join("\n");
    }
    return "";
  }

  /** Extract thinking content blocks from an assistant message content array */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractThinkingFromContent(content: any): string {
    if (!content) { return ""; }
    if (Array.isArray(content)) {
      return content
// eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((c: any) => c.type === "thinking")
// eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((c: any) => c.thinking)
        .join("\n");
    }
    return "";
  }

  /** Extract tool call content blocks from an assistant message */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractToolCallsFromContent(content: any[]): Array<{ name: string; id: string; arguments: any }> {
    if (!content) { return []; }
    return content
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((c: any) => c.type === "toolCall")
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((c: any) => ({ name: c.name, id: c.id, arguments: c.arguments }));
  }

  /** Get entries once per event, plus pre-built lookups to avoid O(n²) scans. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getEntriesWithLookups(): { entries: any[]; byMessageId: Map<string, any>; byToolCallId: Map<string, any> } {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const entries: any[] = this.sessionManager?.getEntries?.() ?? [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const byMessageId = new Map<string, any>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const byToolCallId = new Map<string, any>();
    for (const e of entries) {
      if (e.type === "message") {
        if (e.message?.id) { byMessageId.set(e.message.id, e); }
        if (e.message?.role === "toolResult" && e.message?.toolCallId) {
          byToolCallId.set(e.message.toolCallId, e);
        }
      }
    }
    return { entries, byMessageId, byToolCallId };
  }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleAgentEvent(event: any): void {
    switch (event.type) {
      case "agent_start":
        this._isStreaming = true;
        this.currentAssistantToolCalls.clear();
        this.turnIndex = 0;
        this.emit({ type: "agent-start" });
        // Auto-name session from first user message if unnamed
        if (!this._sessionNamed) {
          this._autoNameSession();
        }
        break;

      case "agent_end":
      case "agent_settled":
        // agent_settled: new in SDK 0.81.1 — fires after retries & follow-ups complete
        this._isStreaming = false;
        this.currentAssistantToolCalls.clear();
        this.turnIndex = 0;
        this.emit({ type: "agent-end", data: { messages: event.messages } });
        this.reportStatus();
        break;

      case "turn_start":
        this.emit({ type: "turn-start" });
        break;

      case "turn_end":
        this.emit({ type: "turn-end", data: { message: event.message, toolResults: event.toolResults } });
        this.turnIndex++;
        break;

      case "message_start": {
        const { byMessageId } = this.getEntriesWithLookups();
        if (event.message?.role === "user") {
          const text = this.extractTextFromContent(event.message.content);
          if (text) {
            this._userMessages.push({ id: event.message.id ?? `user-${Date.now()}`, text, timestamp: event.message.timestamp ?? Date.now() });
            if (this._userMessages.length > 50) { this._userMessages.shift(); }
            const entry = byMessageId.get(event.message.id);
            this.emit({ type: "chat-message", data: { role: "user", content: text, entryId: entry?.id ?? event.message.id } });
          }
        } else if (event.message?.role === "assistant") {
          this.currentAssistantToolCalls.clear();
          const entry = byMessageId.get(event.message.id);
          this.emit({ type: "assistant-start", data: { messageId: event.message.id, entryId: entry?.id ?? event.message.id } });
        }
        break;
      }

      case "message_update": {
        const d = event.assistantMessageEvent;
        switch (d?.type) {
          case "text_delta":
            this.emit({ type: "stream-delta", data: { delta: d.delta } });
            break;
          case "thinking_delta":
            this.emit({ type: "thinking-delta", data: { delta: d.delta } });
            break;
          case "thinking_end":
            this.emit({ type: "thinking-delta", data: { delta: "", done: true } });
            break;
          case "error":
            this.emit({ type: "error", data: { message: d.error ?? "Unknown error" } });
            break;
        }

        if (event.message?.role === "assistant" && event.message?.content) {
          const toolCalls = this.extractToolCallsFromContent(event.message.content);
          for (const tc of toolCalls) {
            // Skip bash/exec tools — they have their own rendering path
            // (bash-start/bash-output/bash-end) and don't need generic
            // tool-start/tool-update events that would leak JSON args into
            // the bash output div as {}{}{}{} artifacts.
            if (tc.name === "bash" || tc.name === "exec") { continue; }
            if (!this.currentAssistantToolCalls.has(tc.id)) {
              this.currentAssistantToolCalls.set(tc.id, { toolName: tc.name, toolCallId: tc.id, args: tc.arguments });
              this.emit({ type: "tool-start", data: { toolCallId: tc.id, toolName: tc.name, args: tc.arguments, fromMessage: true } });
            } else {
              const existing = this.currentAssistantToolCalls.get(tc.id);
              if (existing) {
                existing.args = tc.arguments;
                this.emit({ type: "tool-update", data: { toolCallId: tc.id, toolName: tc.name, partialResult: { content: [{ type: "text", text: JSON.stringify(tc.arguments, null, 2) }] } } });
              }
            }
          }
        }
        break;
      }

      case "message_end":
        if (event.message?.role === "user") { break; }
        if (event.message?.role === "assistant") {
          const toolCalls = this.extractToolCallsFromContent(event.message.content);
          this.emit({ type: "assistant-end", data: { stopReason: event.message.stopReason, errorMessage: event.message.errorMessage, toolCalls: toolCalls.map((tc) => tc.id) } });
          this.reportStatus();
        } else if (event.message?.role === "custom") {
          const { entries } = this.getEntriesWithLookups();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
          const custEntry = reverseFind(entries, (e: any) => e.type === "message" && e.message?.role === "custom");
          this.emit({ type: "custom-message", data: { customType: event.message.customType, content: event.message.content, display: event.message.display, details: event.message.details, timestamp: event.message.timestamp, entryId: custEntry?.id ?? event.message.id } });
        }
        break;

      case "tool_execution_start": {
        const { byToolCallId } = this.getEntriesWithLookups();
        const tcEntry = byToolCallId.get(event.toolCallId);
        const tcEntryId = tcEntry?.id ?? event.toolCallId;

        // Apply the tool's prepareArguments hook so the webview receives
        // validated/transformed args (e.g. legacy oldText/newText → edits[]
        // for the edit tool).  The SDK runs prepareArguments internally but
        // only after emitting this event, so raw LLM args leak through.
        let args = event.args;
        try {
          const tools = this.session?.agent?.state?.tools;
          if (tools) {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
            const toolDef = (tools as any[]).find((t: any) => t.name === event.toolName);
            if (toolDef?.prepareArguments) {
              args = toolDef.prepareArguments(args);
            }
          }
        } catch (_e: unknown) { piWarn(`Tool param decode skipped: ${_e instanceof Error ? _e.message : String(_e)}`); }

        if (event.toolName === "bash" || event.toolName === "exec") {
          this.emit({ type: "bash-start", data: { toolCallId: event.toolCallId, command: args?.command ?? "", entryId: tcEntryId } });
        } else {
          this.emit({ type: "tool-start", data: { toolCallId: event.toolCallId, toolName: event.toolName, args: args, fromMessage: false, entryId: tcEntryId } });
        }
        break;
      }

      case "tool_execution_update":
        if (event.toolName === "bash" || event.toolName === "exec") {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
          const text = event.partialResult?.content?.filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
          this.emit({ type: "bash-output", data: { toolCallId: event.toolCallId, output: text ?? "" } });
        } else {
          this.emit({ type: "tool-update", data: { toolCallId: event.toolCallId, toolName: event.toolName, partialResult: event.partialResult } });
        }
        break;

      case "tool_execution_end": {
        const { byToolCallId } = this.getEntriesWithLookups();
        const tcEntry = byToolCallId.get(event.toolCallId);
        const tcEntryId = tcEntry?.id ?? event.toolCallId;

        if (event.toolName === "bash" || event.toolName === "exec") {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
          const text = event.result?.content?.filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
          this.emit({ type: "bash-end", data: { toolCallId: event.toolCallId, command: event.args?.command ?? "", exitCode: event.isError ? 1 : 0, cancelled: false, output: text ?? "", isError: event.isError, entryId: tcEntryId } });
        } else {
          this.emit({ type: "tool-end", data: { toolCallId: event.toolCallId, toolName: event.toolName, result: event.result, isError: event.isError, entryId: tcEntryId } });
        }
        break;
      }

      case "session_info_changed":
        this.reportStatus();
        break;

      case "thinking_level_changed":
        this._thinkingLevel = event.level;
        this.emit({ type: "thinking-level-changed", data: { level: event.level } });
        this.reportStatus();
        break;

      case "queue_update":
        piLog(`queue_update: steering=${event.steering?.length ?? 0}, followUp=${event.followUp?.length ?? 0}`);
        this.emit({ type: "queue-update", data: { steering: Array.from(event.steering ?? []), followUp: Array.from(event.followUp ?? []) } });
        break;

      case "compaction_start":
        this.emit({ type: "compaction-start", data: { reason: event.reason } });
        break;

      case "compaction_end":
        this.emit({ type: "compaction-end", data: { reason: event.reason, aborted: event.aborted, willRetry: event.willRetry, result: event.result, errorMessage: event.errorMessage } });
        if (event.result) {
          const { entries } = this.getEntriesWithLookups();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
          const compactEntry = reverseFind(entries, (e: any) => e.type === "compaction");
          this.emit({ type: "compaction-summary-message", data: { summary: event.result.summary, tokensBefore: event.result.tokensBefore, timestamp: Date.now(), entryId: compactEntry?.id } });
        }
        break;

      case "auto_retry_start":
        this.emit({ type: "auto-retry-start", data: { attempt: event.attempt, maxAttempts: event.maxAttempts, delayMs: event.delayMs, errorMessage: event.errorMessage } });
        break;

      case "auto_retry_end":
        this.emit({ type: "auto-retry-end", data: { success: event.success, attempt: event.attempt, finalError: event.finalError } });
        break;

      default:
        // Surface unknown SDK events as visible notifications so they
        // aren't silently lost.  Add a case above once handled.
        this.emit({
          type: "custom-message",
          data: {
            customType: "pi-gui-diagnostic",
            display: false,
            content: `Unhandled agent event: ${event.type}`,
            timestamp: Date.now(),
          },
        });
        piWarn(`Unhandled agent event type: ${event.type}`);
        break;
    }
  }

  private reportStatus(): void {
    const stats = this.getUsageStats();
    const cfg = vscode.workspace.getConfiguration("pi-code-gui");
    const budget = cfg.get<number>("contextBudget") ?? 0;
    this.emit({
      type: "status-update",
      data: {
        model: this._model?.id ?? this._model?.name ?? "pi",
        thinkingLevel: this._thinkingLevel,
        effort: this._effort,
        isStreaming: this._isStreaming,
        sessionId: this.sessionId ?? undefined,
        usage: stats,
        contextBudget: budget,
      },
    });
  }

  // ── User actions ───────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
  async sendPrompt(text: string, images?: any[], mode?: string): Promise<void> {
    if (!this.session) { throw new Error("Pi session not initialized"); }

    // Handle slash commands at the PiService level before forwarding to
    // session.prompt(). Builtin commands (from the SDK's BUILTIN_SLASH_COMMANDS
    // list) map to PiService methods.
    //
    // IMPORTANT: unhandled slash commands (extension commands like /tldr,
    // and unknown commands) MUST go through session.prompt() even during
    // streaming.  The SDK executes extension commands immediately regardless
    // of agent state, while steer()/followUp() explicitly reject them
    // ("extension commands cannot be queued").
    if (text.startsWith("/")) {
      const handled = await this.tryHandleCommand(text);
      if (handled) { return; }
      // Extension command or unknown slash — execute immediately via prompt(),
      // bypassing the steer/queue path below.
      await this.session.prompt(text);
      return;
    }

    if (mode === "steer" || mode === "queue") {
      if (images && images.length > 0) {
        throw new Error("Cannot attach images while agent is streaming");
      }
      try {
        if (mode === "queue") {
          await this.session.followUp(text);
        } else {
          await this.session.steer(text);
        }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (e: any) {
        // steer/followUp reject extension commands and prompt templates
        // during streaming — surface the error rather than swallowing it.
        const msg = e?.message ?? String(e);
        piWarn(`sendPrompt ${mode} failed: ${msg}`);
        this.emit({
          type: "custom-message",
          data: {
            customType: "error",
            content: `${mode === "steer" ? "Steer" : "Queue"} failed: ${msg}`,
            timestamp: Date.now(),
          },
        });
      }
    } else {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      const opts: any = {};
      if (images && images.length > 0) {
        // Check if current model supports images; if not, try to auto-switch
        if (!this.activeModelSupportsImages()) {
          const visionModel = this.findVisionModel();
          if (visionModel) {
            // Auto-switch to a vision-capable model
            await this.setModel(visionModel.provider, visionModel.id);
            this.emit({
              type: "custom-message",
              data: {
                customType: "info",
                content: `Auto-switched to ${visionModel.id} (vision-capable) for image support.`,
                timestamp: Date.now(),
              },
            });
          } else {
            throw new Error(
              `Cannot send images: no vision-capable model available. ` +
              "Add an API key for Claude, GPT-4o, or Gemini to use images."
            );
          }
        }
        opts.images = images;
      }
      await this.session.prompt(text, opts);
    }
  }

  /** Check whether the active model's input capabilities include images. */
  private activeModelSupportsImages(): boolean {
 
    const rawModel = (this.session)?.model;
    if (!rawModel) { return true; }
    const input = rawModel.input as string[] | undefined;
    return input?.includes("image") ?? true;
  }

  /** Find a vision-capable model from the available scoped models. */
  private findVisionModel(): { provider: string; id: string } | null {
    if (!this.modelRuntime) { return null; }
    for (const cm of this.cycleModels) {
      const m = this.modelRuntime.getModel(cm.provider, cm.id);
      if (m?.input?.includes("image")) {
        return { provider: cm.provider, id: cm.id };
      }
    }
    return null;
  }

  /** Try to handle a slash command locally. Returns true if handled,
   *  false if the caller should forward to session.prompt(). */
  private async tryHandleCommand(text: string): Promise<boolean> {
    const spaceIndex = text.indexOf(" ");
    const cmdName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);

    switch (cmdName) {
      // Builtin commands with PiService handlers
      case "model":  await this.cycleModel(); return true;
      case "new":    await this.newSession(); return true;
      case "login":  await this.login(); return true;
      case "logout": await this.logout(); return true;

      // Builtin commands intercepted before session.prompt (like the CLI does).
      // NOTE: /settings, /sessions, /model, /thinking are intercepted by
      // the webview's localSlashCommands and handled via handleSlashCommand.

      case "name": {
        const name = text.slice(6).trim();
        if (name) { this.session.setSessionName(name); }
        return true;
      }

      case "tree":
        await vscode.commands.executeCommand("pi-code-gui.sessions.focus");
        return true;

      case "compact": {
        const compactArgs = text.startsWith("/compact ") ? text.slice(9).trim() : undefined;
        await this.session.compact(compactArgs);
        return true;
      }

      case "export": {
        // Parse optional output path from text
        const exportArgs = text.startsWith("/export ") ? text.slice(8).trim() : undefined;
        const outputPath = exportArgs || vscode.Uri.joinPath(
          vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file(process.cwd()),
          `pi-session-${this.sessionId?.slice(0, 8) ?? "export"}.html`
        ).fsPath;
        const result = await this.session.exportToHtml(outputPath);
        vscode.window.showInformationMessage(`Session exported to: ${result}`);
        return true;
      }

      case "reload": {
        await this.session.reload();
        // Re-send initial messages so the webview reflects updated extensions/skills
        await this.sendInitialMessages();
        this.emitSlashCommands();
        return true;
      }

      // Commands that delegate to VS Code commands:
      case "clone":
        await vscode.commands.executeCommand("pi-code-gui.cloneSession");
        return true;

      case "tools": {
        await this.pickActiveTools();
        return true;
      }

      case "fork":
      case "resume":
        // These are no-ops via text since they require interactive selection.
        // The UX is available via the Sessions tree context menus.
        return true;

      default:
        // Unknown command — let the caller send to session.prompt (handles
        // extension commands like /tldr, or falls through to the LLM)
        return false;
    }
  }

  async abort(): Promise<void> {
    if (!this.session) {
      piWarn("abort() called but session not initialized — nothing to abort");
      return;
    }
    // Kill running bash processes first — agent.abort() only stops the LLM call,
    // not child processes.  Without this, long-running commands (npm install,
    // test suites, etc.) become orphaned/zombie processes on the system.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    try { this.session.abortBash?.(); } catch (e: any) { piWarn(`abortBash() failed: ${e?.message ?? e}`); }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    try { this.session.agent.abort(); } catch (e: any) { piWarn(`abort() failed: ${e?.message ?? e}`); }
  }

  /** Resolve a pending interactive dialog (called from webview-panel.ts). */
  resolveDialog(id: string, value: unknown): void {
    const entry = this._pendingDialogs.get(id);
    if (entry) {
      this._pendingDialogs.delete(id);
      entry.resolve(value);
    }
  }

  /**
   * Show an interactive dialog in the webview and return a Promise.
   * Falls back to synchronous undefined if no listeners are attached
   * (the SDK then uses text-based fallback prompts).
   */
  private _showDialog(
    dialogType: "select" | "confirm" | "input",
    prompt: string,
    extras: { options?: string[]; defaultValue?: string },
  ): Promise<unknown> | undefined {
    if (this.listeners.length === 0) {
      // No webview attached — SDK will fall back to text prompts
      return undefined;
    }
    const id = "dlg_" + Math.random().toString(36).slice(2, 10);
    return new Promise((resolve) => {
      this._pendingDialogs.set(id, { resolve });
      this.emit({
        type: "show_dialog",
        data: {
          dialogType,
          id,
          prompt,
          options: extras.options || [],
          defaultValue: extras.defaultValue || "",
        },
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    });
  }

  async newSession(): Promise<void> {
    if (!this.session) {
      piWarn("newSession() called but session not initialized — creating fresh");
      this.dispose();
      await this.initialize({ fresh: true });
      return;
    }
    // Kill running bash before waiting for idle (otherwise waitForIdle hangs).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    try { this.session.abortBash?.(); } catch (e: any) { piWarn(`abortBash() failed: ${e?.message ?? e}`); }
    await this.session.agent.waitForIdle();
    this.dispose();
    await this.initialize({ fresh: true });
  }

  /** Resume a past session from a .jsonl file path. Disposes current and re-initializes. */
  async resumeSession(filePath: string): Promise<{ success: boolean; error?: string }> {
    // Kill running bash before waiting for idle.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    try { this.session?.abortBash?.(); } catch (e: any) { piWarn(`abortBash() failed: ${e?.message ?? e}`); }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    try { await this.session?.agent.waitForIdle(); } catch (e: any) { piWarn(`waitForIdle() failed: ${e?.message ?? e}`); }
    this.dispose();
    return this.initialize({ openPath: filePath });
  }

  /** After a branch/fork operation, re-emit the branched entries to the webview */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  replayBranchEntries(path: any[]): void {
    this._userMessages = [];

    // Pre-index tool results by call ID
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolResultsById = new Map<string, any>();
    for (const e of path) {
      if (e.type === "message" && e.message?.role === "toolResult") {
        toolResultsById.set(e.message.toolCallId, e);
      }
    }

    for (const entry of path) {
      if (entry.type === "message" && entry.message) {
        const msg = entry.message;
        if (msg.role === "user") {
          const text = this.extractTextFromContent(msg.content);
          if (text) {
            this._userMessages.push({ id: msg.id ?? `user-${Date.now()}`, text, timestamp: msg.timestamp });
            if (this._userMessages.length > 50) { this._userMessages.shift(); }
            this.emit({ type: "chat-message", data: { role: "user", content: text, entryId: entry.id } });
          }
        } else if (msg.role === "assistant") {
          const text = this.extractTextFromContent(msg.content);
          const thinking = this.extractThinkingFromContent(msg.content);
          const toolCalls = this.extractToolCallsFromContent(msg.content);

          // Always emit assistant messages — even tool-only ones with no text.
          // Skipping them makes tool executions invisible on reload/resume.
          this.emit({ type: "assistant-start", data: { messageId: msg.id, entryId: entry.id } });
          // Emit thinking content first, then text
          if (thinking) {
            this.emit({ type: "thinking-delta", data: { delta: thinking } });
            this.emit({ type: "thinking-delta", data: { delta: "", done: true } });
          }
          if (text) {
            this.emit({ type: "stream-delta", data: { delta: text } });
          }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
          this.emit({ type: "assistant-end", data: { stopReason: msg.stopReason, errorMessage: msg.errorMessage, toolCalls: toolCalls.map((tc: any) => tc.id) } });

          for (const tc of toolCalls) {
            const toolResultEntry = toolResultsById.get(tc.id);
            if (tc.name === "bash" || tc.name === "exec") {
              this.emit({ type: "bash-start", data: { toolCallId: tc.id, command: tc.arguments?.command ?? "", entryId: toolResultEntry?.id } });
              const outputText = toolResultEntry?.message ? this.extractTextFromContent(toolResultEntry.message.content) : "";
              this.emit({ type: "bash-end", data: { toolCallId: tc.id, command: tc.arguments?.command ?? "", exitCode: 0, cancelled: false, output: outputText, isError: false, entryId: toolResultEntry?.id } });
            } else {
              this.emit({ type: "tool-start", data: { toolCallId: tc.id, toolName: tc.name, args: tc.arguments, fromMessage: true, entryId: toolResultEntry?.id } });
              if (toolResultEntry?.message) {
                this.emit({ type: "tool-end", data: { toolCallId: tc.id, toolName: tc.name, result: toolResultEntry.message, isError: false, entryId: toolResultEntry?.id } });
              } else {
                this.emit({ type: "tool-end", data: { toolCallId: tc.id, toolName: tc.name, result: { content: [{ type: "text", text: "(forked)" }] }, isError: false, entryId: toolResultEntry?.id } });
              }
            }
          }
        } else if (msg.role === "custom") {
          this.emit({ type: "custom-message", data: { customType: msg.customType, content: msg.content, display: msg.display, details: msg.details, timestamp: msg.timestamp, entryId: entry.id } });
        } else if (msg.role === "bashExecution") {
          const bashEntryId = entry.id ?? `bash-${Date.now()}`;
          this.emit({ type: "bash-start", data: { toolCallId: bashEntryId, command: msg.command ?? "", entryId: entry.id } });
          this.emit({ type: "bash-end", data: { toolCallId: bashEntryId, command: msg.command ?? "", exitCode: msg.exitCode, cancelled: msg.cancelled, output: msg.output ?? "", isError: msg.exitCode !== 0 && msg.exitCode !== null, entryId: entry.id } });
        }
      } else if (entry.type === "compaction") {
        this.emit({ type: "compaction-summary-message", data: { summary: entry.summary ?? "", tokensBefore: entry.tokensBefore ?? 0, timestamp: this._toTimestamp(entry.timestamp), entryId: entry.id } });
      }
    }

    this.reportStatus();
  }

  /** Write a session entry directly to the session file, bypassing SDK _persist quirks. */
  private _forcePersistEntry(entry: Record<string, unknown>): void {
    const sf = this.sessionManager?.getSessionFile?.();
    if (!sf) {
      piWarn("_forcePersistEntry: no session file");
      return;
    }
    try {
      fs.appendFileSync(sf, JSON.stringify(entry) + "\n");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      piWarn(`_forcePersistEntry failed: ${e.message}`);
    }
  }

  async setModel(provider: string, modelId: string): Promise<void> {
    await this.modelService?.setModel(provider, modelId);
  }

  async cycleModel(): Promise<void> {
    await this.modelService?.cycleModel();
  }

  async setThinkingLevel(level: string): Promise<void> {
    await this.modelService?.setThinkingLevel(level);
  }

  // ── Default model / thinking persistence (delegates) ─

  saveDefaultModel(): void { this.modelService?.saveDefaultModel(); }
  saveDefaultThinking(): void { this.modelService?.saveDefaultThinking(); }
  getDefaultModel(): { provider: string; id: string } | null { return this.modelService?.getDefaultModel() ?? null; }
  getDefaultThinking(): string { return this.modelService?.getDefaultThinking() ?? "off"; }
  getContextBudget(): number { return this.modelService?.getContextBudget() ?? 0; }
  async setContextBudget(budget: number): Promise<void> { await this.modelService?.setContextBudget(budget); }

  // ── Settings, models, scoped models ──────────────────

  get autoCompactionEnabled(): boolean { return this._autoCompactionEnabled; }
  get autoRetryEnabled(): boolean { return this._autoRetryEnabled; }
  get showImages(): boolean { return this._showImages; }
  get userMessages(): Array<{ id: string; text: string; timestamp?: number }> { return this._userMessages; }

  async getAvailableModels(): Promise<Array<{ provider: string; id: string; name?: string; cost?: { input: number; output: number }; contextWindow?: number }>> {
    return this.modelService?.getAvailableModels() ?? [];
  }

  static formatModelDetail(cost?: { input: number; output: number }, contextWindow?: number): string {
    return ModelService.formatModelDetail(cost, contextWindow);
  }

  async pickModel(): Promise<boolean> {
    return this.modelService?.pickModel() ?? false;
  }

  async pickThinkingLevel(): Promise<boolean> {
    return this.modelService?.pickThinkingLevel() ?? false;
  }

  getScopedModels(): Array<{ provider: string; id: string; thinkingLevel: string }> {
    return this.modelService?.getScopedModels() ?? [];
  }

  emitScopedModels(): void {
    this.emit({ type: "scoped-models-update", data: { models: this.getScopedModels() } });
  }

  emitSettings(): void {
    this.emit({
      type: "settings-update",
      data: { autoCompaction: this._autoCompactionEnabled, autoRetry: this._autoRetryEnabled, showImages: this._showImages },
    });
  }

  async toggleAutoCompaction(): Promise<boolean> {
    if (!this.session) { return this._autoCompactionEnabled; }
    this._autoCompactionEnabled = !this._autoCompactionEnabled;
    if (typeof this.session.setAutoCompactionEnabled === "function") {
      await this.session.setAutoCompactionEnabled(this._autoCompactionEnabled);
    }
    this.emitSettings();
    return this._autoCompactionEnabled;
  }

  async toggleAutoRetry(): Promise<boolean> {
    if (!this.session) { return this._autoRetryEnabled; }
    this._autoRetryEnabled = !this._autoRetryEnabled;
    this.emitSettings();
    return this._autoRetryEnabled;
  }

  async toggleShowImages(): Promise<boolean> {
    this._showImages = !this._showImages;
    this.emitSettings();
    return this._showImages;
  }

  async setEffort(effort: string): Promise<void> {
    this._effort = effort;
    if (this.session && typeof this.session.setEffort === "function") {
      await this.session.setEffort(effort);
    }
    this.reportStatus();
  }

  /** Generate a short 3-word tab title summary for the first user input in a session. */
  async generateTabSummary(userInput: string): Promise<string | null> {
    if (!this.modelRuntime || !this._model) { return null; }

    try {
      const model = this.modelRuntime.getModel(this._model.provider, this._model.id);
      if (!model) { return null; }

      const authData = this.modelRuntime
        ? await this.modelRuntime.getAuth(this._model.provider!)
        : undefined;
      const apiKey = authData?.auth?.apiKey;

      const context = {
        systemPrompt: "Generate a concise 3-word summary of the following user request. Respond with ONLY the three words, lowercase, no punctuation, no quotes, no explanation.",
        messages: [
          { role: "user", content: userInput, timestamp: Date.now() },
        ],
      };

      const result = await this.modelRuntime.complete(model, context, {
        maxTokens: 20,
        apiKey,
      });

      const text = this.extractTextFromContent(result.content);
      if (text) {
        // Clean up: take first line, trim, limit to ~40 chars
        return text.split("\n")[0].trim().replace(/^["']|["']$/g, "").slice(0, 40);
      }
      return null;
    } catch {
      return null;
    }
  }

  /** Set a runtime API key (not persisted to disk) */
  setRuntimeApiKey(provider: string, key: string): void {
    this.authService?.setRuntimeApiKey(provider, key);
  }

  // ── Usage / token stats ──────────────────────────────

  getUsageStats(): {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
    contextPercent: number | null;
    contextWindow: number;
  } {
    if (!this.sessionManager) {
      return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextPercent: null, contextWindow: 0 };
    }

    const entries = this.sessionManager.getEntries();
    let totalInput = 0;
    let totalOutput = 0;
    let totalCacheRead = 0;
    let totalCacheWrite = 0;
    let totalCost = 0;

    for (const entry of entries) {
      if (entry.type === "message" && entry.message?.role === "assistant") {
        const usage = entry.message.usage;
        if (usage) {
          totalInput += usage.input ?? 0;
          totalOutput += usage.output ?? 0;
          totalCacheRead += usage.cacheRead ?? 0;
          totalCacheWrite += usage.cacheWrite ?? 0;
          totalCost += usage.cost?.total ?? 0;
        }
      }
    }

    let contextPercent: number | null = null;
    let contextWindow = 0;
    try {
      const contextUsage = this.session?.getContextUsage?.();
      if (contextUsage) {
        contextPercent = contextUsage.percent;
        contextWindow = contextUsage.contextWindow;
      }
    } catch (e: unknown) { piWarn(`Non-critical failure (ignored): ${e instanceof Error ? e.message : String(e)}`); }

    return { input: totalInput, output: totalOutput, cacheRead: totalCacheRead, cacheWrite: totalCacheWrite, cost: totalCost, contextPercent, contextWindow };
  }

  // ── Getters ────────────────────────────────────────────

  get isStreaming(): boolean { return this._isStreaming; }
  get model(): { id?: string; name?: string; provider?: string } | null { return this._model; }
  get thinkingLevel(): string { return this._thinkingLevel; }

  /** Promote a follow-up message to a steering message. */
  async promoteToSteer(text: string): Promise<void> {
    if (!this.session) { return; }
    var existingSteer = this.session.getSteeringMessages ? [...this.session.getSteeringMessages()] : [];
    this.session.clearQueue();
    for (var i = 0; i < existingSteer.length; i++) {
      this.session.steer(existingSteer[i]);
    }
    this.session.steer(text);
  }

  /** Clear all queued messages. */
  async clearQueue(): Promise<void> {
    if (!this.session) { return; }
    this.session.clearQueue();
  }
  get effort(): string { return this._effort; }
  get sdkRoot(): string | null { return this._piRoot; }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  get sessionManagerInstance(): any { return this.sessionManager; }
  /** The file path of the session file on disk (for persistence across reloads). */
  get sessionFilePath(): string | null {
    return this.sessionManager?.getSessionFile?.() ?? null;
  }
  get sessionIdValue(): string | null { return this.sessionId; }
  get initialized(): boolean { return this.session !== null; }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  get rawSession(): any { return this.session; }
  /** Expose the model registry for dynamic model pickers in the webview */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  get modelRegistryInstance(): any { return this.modelRegistry; }

  /** Get the session display name from the session manager, if set. */
  get sessionName(): string | undefined {
    return this.sessionManager?.getSessionName?.();
  }

  /** Persist a display name to the session file so it survives tab close. */
  setSessionName(name: string): void {
    this.session?.setSessionName?.(name);
  }

  // ── Tools ───────────────────────────────────────────────

  /** Get all configured tools available for selection. */
  getAllTools(): Array<{ name: string; description: string; source: string }> {
    if (!this.session || typeof this.session.getAllTools !== "function") { return []; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.session.getAllTools().map((t: any) => ({
      name: t.name,
      description: t.description ?? "",
      source: t.sourceInfo?.source ?? "sdk",
    }));
  }

  /** Get names of currently active tools. */
  getActiveToolNames(): string[] {
    if (!this.session || typeof this.session.getActiveToolNames !== "function") { return []; }
    return this.session.getActiveToolNames();
  }

  /** Set which tools are active for the next agent turn. */
  setActiveTools(toolNames: string[]): void {
    if (!this.session || typeof this.session.setActiveToolsByName !== "function") {
      piWarn("setActiveTools: session not initialized or method unavailable");
      return;
    }
    this.session.setActiveToolsByName(toolNames);
    // Verify the update took effect
    const actualNames = this.session.getActiveToolNames();
    piLog(`setActiveTools: requested ${toolNames.length}, actual ${actualNames.length} — ${actualNames.join(", ") || "(none)"}`);
    // Force-persist the tool selection so it survives session close/reopen
    this._forcePersistEntry({
      type: "tools_active_change",
      id: `pi-ext-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      parentId: null,
      timestamp: new Date().toISOString(),
      toolNames,
    });
    piLog(`setActiveTools: ${toolNames.length} tools active`);
  }

  /** Walk session entries in reverse to find and apply the last tools_active_change. */
  /** Auto-name the session from first user message (Claude Code style). */
  private _autoNameSession(): void {
    if (!this.sessionManager) { return; }
    const entries = this.sessionManager.getEntries?.() ?? [];
    // Find first user message
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const firstUser = entries.find(
      (e: any) => e.type === "message" && e.message?.role === "user",
    );
    if (!firstUser) { return; }
    // Extract text content
    let text = "";
    const content = firstUser.message?.content;
    if (typeof content === "string") {
      text = content;
    } else if (Array.isArray(content)) {
      text = content.filter((c: any) => c.type === "text").map((c: any) => c.text).join(" ");
      /* eslint-enable @typescript-eslint/no-explicit-any */
    }
    if (!text.trim()) { return; }
    // First 30 chars as name
    const name = text.replace(/\n/g, " ").trim().substring(0, 30);
    if (!name) { return; }
    this.setSessionName(name);
    this._sessionNamed = true;
    this.emit({ type: "sessionName", data: { name } });
  }

  private _restoreActiveToolsFromSession(): void {
    const entries = this.sessionManager?.getEntries?.() ?? [];
    if (!entries.length) { return; }
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (e.type === "tools_active_change" && Array.isArray(e.toolNames) && e.toolNames.length > 0) {
        this.session.setActiveToolsByName(e.toolNames);
        piLog(`Restored active tools from session: ${e.toolNames.join(", ")}`);
        return;
      }
    }
  }

  /** Open a QuickPick to select which tools are active for this session. */
  async pickActiveTools(): Promise<boolean> {
    if (!this.session) {
      vscode.window.showWarningMessage("Pi session not ready yet.");
      return false;
    }

    const allTools = this.getAllTools();
    if (allTools.length === 0) {
      vscode.window.showInformationMessage("No tools available.");
      return false;
    }

    const activeNames = new Set(this.getActiveToolNames());
    piLog(`pickActiveTools: ${activeNames.size} active tools — ${[...activeNames].join(", ") || "(none)"}`);

    // Group by source for a cleaner pick list
    const builtinTools = allTools.filter((t) => t.source === "builtin");
    const bridgeTools = allTools.filter((t) => t.source === "sdk" && t.name.startsWith("vscode_"));
    const extensionTools = allTools.filter((t) => t.source !== "builtin" && !t.name.startsWith("vscode_"));

    const items: vscode.QuickPickItem[] = [];

    const addGroup = (label: string, tools: typeof allTools): void => {
      if (tools.length === 0) { return; }
      const icon = label === "Built-in" ? "tools" : label === "VS Code Bridge" ? "extensions" : "symbol-misc";
      items.push({ label: `$(${icon}) ${label}`, kind: vscode.QuickPickItemKind.Separator });
      for (const t of tools) {
        items.push({
          label: t.name,
          description: t.description,
          detail: t.source,
          picked: activeNames.has(t.name),
        });
      }
    };

    addGroup("Built-in", builtinTools);
    addGroup("VS Code Bridge", bridgeTools);
    addGroup("Extension", extensionTools);

    const picked = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      placeHolder: `Select tools (${activeNames.size} active)`,
      matchOnDescription: true,
    });

    if (!picked) { return false; }

    const selectedNames = picked
      .filter((p) => p.kind !== vscode.QuickPickItemKind.Separator)
      .map((p) => p.label);

    this.setActiveTools(selectedNames);

    const added = selectedNames.filter((n) => !activeNames.has(n)).length;
    const removed = activeNames.size - selectedNames.filter((n) => activeNames.has(n)).length;
    const parts: string[] = [];
    if (added > 0) { parts.push(`+${added}`); }
    if (removed > 0) { parts.push(`-${removed}`); }
    vscode.window.showInformationMessage(
      `Tools updated: ${selectedNames.length} active${parts.length > 0 ? ` (${parts.join(", ")})` : ""}`,
    );

    return true;
  }

  // ── Login / Logout ─────────────────────────────────────

  /**
   * Show the login flow for a provider.
   * Mirrors the pi CLI's /login command:
   * 1. Select auth type (subscription/OAuth vs API key)
   * 2. Select provider
   * 3. For OAuth: open browser and complete OAuth flow
   * 4. For API key: prompt for key and save it
   */
  async login(): Promise<void> {
    await this.authService?.login();
  }

  async logout(): Promise<void> {
    await this.authService?.logout();
  }

  // ── Cleanup ────────────────────────────────────────────

  dispose(): void {
    // Force-flush the session file to disk before tearing down.
    // The SDK defers all disk writes until the first assistant message
    // arrives, so if the model is slow or the user closes the tab early,
    // entries (including session_info with the tab name) exist only in
    // memory and would be lost.  _rewriteFile bypasses the deferral.
 
    const sm = this.sessionManager;
    if (sm && !sm.flushed && typeof sm._rewriteFile === "function") {
      try { sm._rewriteFile(); } catch (e: unknown) { piWarn(`Best-effort failure: ${e instanceof Error ? e.message : String(e)}`); }
    }
    // Kill any running bash processes before tearing down the session.
    // Without this, processes orphaned by session close survive as zombies.
    try { this.session?.abortBash?.(); } catch (e: unknown) { piWarn(`Best-effort failure: ${e instanceof Error ? e.message : String(e)}`); }
    if (this._widgetTimer) { clearInterval(this._widgetTimer); this._widgetTimer = null; }
    this.unsubscribe?.();
    this.session?.dispose();
    this.session = null;
    this.unsubscribe = null;
    this.SDK = null;
    this.modelRuntime = null;
    this.resourceLoader = null;
  }
}
