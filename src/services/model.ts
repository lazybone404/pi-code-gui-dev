/**
 * Model service — handles model selection, cycling, thinking level,
 * and default model/thinking persistence.
 * Extracted from PiService.
 */

import * as vscode from "vscode";
import { piWarn } from "../logger.js";

/** Dependencies ModelService needs from its host */
export interface ModelServiceHost {
  ai: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  modelRegistry: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  session: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  get model(): { id?: string; provider?: string } | null;
  set model(m: { id?: string; provider?: string } | null);
  get thinkingLevel(): string;
  set thinkingLevel(level: string);
  cycleModels: Array<{ provider: string; id: string }>;
  cycleIndex: number;
  /** Persist an entry to the session file (called after model/thinking change). */
  forcePersistEntry(entry: Record<string, unknown>): void;
  /** Refresh status in the webview footer. */
  reportStatus(): void;
}

export class ModelService {
  constructor(private host: ModelServiceHost) {}

  get model(): { id?: string; provider?: string } | null { return this.host.model; }

  /** Cycle to the next model in the scoped list. */
  async cycleModel(): Promise<void> {
    if (!this.host.session || !this.host.ai) {
      vscode.window.showWarningMessage("Pi session not ready yet.");
      return;
    }
    if (this.host.cycleModels.length === 0) {
      vscode.window.showWarningMessage("No models available. Configure an API key first.");
      return;
    }
    this.host.cycleIndex = (this.host.cycleIndex + 1) % this.host.cycleModels.length;
    const next = this.host.cycleModels[this.host.cycleIndex];
    const model = this.host.ai.getModel(next.provider, next.id);
    if (model) {
      const prevId = this.host.model?.id ?? "?";
      await this.host.session.setModel(model);
      this.host.model = { id: next.id, provider: next.provider };
      if (this.host.cycleModels.length <= 1) {
        vscode.window.showInformationMessage(`Only ${next.id} configured.`);
      } else {
        vscode.window.showInformationMessage(`Model: ${prevId} → ${next.id}`);
      }
      this.host.reportStatus();
    }
  }

  /** Switch to a specific model by provider and model ID. */
  async setModel(provider: string, modelId: string): Promise<void> {
    const model = this.host.ai.getModel(provider, modelId);
    if (!model) {
      vscode.window.showErrorMessage(`Model not found: ${provider}/${modelId}`);
      return;
    }
    if (this.host.session && typeof this.host.session.setModel === "function") {
      await this.host.session.setModel(model);
    }
    const prevId = this.host.model?.id ?? "?";
    this.host.model = { id: model.id, provider: model.provider };
    this.host.reportStatus();

    this.host.forcePersistEntry({
      type: "model_change",
      id: `pi-ext-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      parentId: null,
      timestamp: new Date().toISOString(),
      provider: model.provider,
      modelId: model.id,
    });
    vscode.window.showInformationMessage(`Model: ${prevId} → ${model.id}`);
  }

  /** Set thinking level on current session. */
  async setThinkingLevel(level: string): Promise<void> {
    if (!this.host.session) {
      piWarn(`setThinkingLevel("${level}") ignored: session not initialized`);
      return;
    }
    this.host.session.setThinkingLevel(level);
    this.host.thinkingLevel = level;
    this.host.reportStatus();
    this.host.forcePersistEntry({
      type: "thinking_level_change",
      id: `pi-ext-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      parentId: null,
      timestamp: new Date().toISOString(),
      thinkingLevel: level,
    });
  }

  // ── Default model / thinking persistence ──────────────

  saveDefaultModel(): void {
    if (!this.host.model?.provider || !this.host.model?.id) {
      piWarn("saveDefaultModel() called but no model is active — ignoring");
      return;
    }
    const cfg = vscode.workspace.getConfiguration("pi-code-gui");
    cfg.update("defaultModelProvider", this.host.model.provider, vscode.ConfigurationTarget.Global);
    cfg.update("defaultModelId", this.host.model.id, vscode.ConfigurationTarget.Global);
  }

  saveDefaultThinking(): void {
    const cfg = vscode.workspace.getConfiguration("pi-code-gui");
    cfg.update("defaultThinkingLevel", this.host.thinkingLevel, vscode.ConfigurationTarget.Global);
  }

  getDefaultModel(): { provider: string; id: string } | null {
    const cfg = vscode.workspace.getConfiguration("pi-code-gui");
    const provider = cfg.get<string>("defaultModelProvider");
    const id = cfg.get<string>("defaultModelId");
    return (provider && id) ? { provider, id } : null;
  }

  getDefaultThinking(): string {
    return vscode.workspace.getConfiguration("pi-code-gui").get<string>("defaultThinkingLevel") ?? "off";
  }

  getContextBudget(): number {
    return vscode.workspace.getConfiguration("pi-code-gui").get<number>("contextBudget") ?? 0;
  }

  async setContextBudget(budget: number): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("pi-code-gui");
    await cfg.update("contextBudget", budget, vscode.ConfigurationTarget.Global);
    this.host.reportStatus();
  }

  // ── Available models ──────────────────────────────────

  async getAvailableModels(): Promise<Array<{
    provider: string; id: string; name?: string;
    cost?: { input: number; output: number }; contextWindow?: number;
  }>> {
    if (!this.host.modelRegistry) { return []; }
    try {
      const available = await this.host.modelRegistry.getAvailable();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      return available.map((m: any) => ({
        provider: m.provider,
        id: m.id,
        name: m.name,
        cost: m.cost ? { input: m.cost.input, output: m.cost.output } : undefined,
        contextWindow: m.contextWindow ?? undefined,
      }));
    } catch {
      return [];
    }
  }

  static formatModelDetail(cost?: { input: number; output: number }, contextWindow?: number): string {
    const parts: string[] = [];
    if (cost) { parts.push(`$${cost.input}/$${cost.output} per M tokens`); }
    if (contextWindow) { parts.push(`${Math.round(contextWindow / 1000)}K context`); }
    return parts.join(" · ");
  }

  // ── Model / Thinking Pickers ──────────────────────────

  async pickModel(): Promise<boolean> {
    interface ModelItem { label: string; provider: string; modelId: string; cost?: { input: number; output: number }; contextWindow?: number; }
    let models: ModelItem[] = [];

    try {
      const available = await this.getAvailableModels();
      if (available.length > 0) {
        models = available.map((m) => ({
          label: m.name || m.id,
          provider: m.provider,
          modelId: m.id,
          cost: m.cost,
          contextWindow: m.contextWindow,
        }));
      }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      piWarn(`pickModel: getAvailableModels failed (${e.message}), using static fallback`);
    }

    if (models.length === 0) {
      models = [
        { label: "Claude Sonnet 4.5", provider: "anthropic", modelId: "claude-sonnet-4-5" },
        { label: "Claude Haiku 4.5", provider: "anthropic", modelId: "claude-haiku-4-5" },
        { label: "Claude Opus 4.5", provider: "anthropic", modelId: "claude-opus-4-5" },
        { label: "GPT 4o", provider: "openai", modelId: "gpt-4o" },
        { label: "Gemini 2.5 Pro", provider: "google", modelId: "gemini-2.5-pro" },
        { label: "DeepSeek V3", provider: "deepseek", modelId: "deepseek-chat" },
      ];
    }

    const currentId = this.host.model?.id;
    const defModel = this.getDefaultModel();
    const items = models.map((m) => {
      const isDefault = defModel && m.provider === defModel.provider && m.modelId === defModel.id;
      return {
        label: `${m.label}${m.modelId === currentId ? " $(check)" : ""}${isDefault ? " \u2605" : ""}`,
        description: m.provider,
        detail: ModelService.formatModelDetail(m.cost, m.contextWindow),
        provider: m.provider,
        modelId: m.modelId,
        isDefault,
      };
    });

    const picked = await vscode.window.showQuickPick(items, { placeHolder: "Select model (\u2605 = default)", matchOnDetail: true });
    if (!picked) { return false; }

    await this.setModel(picked.provider, picked.modelId);

    if (!picked.isDefault) {
      const save = await vscode.window.showQuickPick(
        [{ label: "\u2605 Save as default", description: "Use this model for future sessions" }],
        { placeHolder: "Use as default?" },
      );
      if (save) { this.saveDefaultModel(); }
    }

    return true;
  }

  async pickThinkingLevel(): Promise<boolean> {
    const levels = [
      { label: "off", description: "No thinking" },
      { label: "minimal", description: "Minimal thinking" },
      { label: "low", description: "Brief thinking" },
      { label: "medium", description: "Balanced thinking" },
      { label: "high", description: "Extended thinking" },
      { label: "xhigh", description: "Maximum thinking" },
    ];
    const current = this.host.thinkingLevel;
    const defLevel = this.getDefaultThinking();
    const items = levels.map((l) => {
      const isDefault = l.label === defLevel;
      return {
        label: `${l.label === current ? "$(check) " : ""}${l.label}${isDefault ? " \u2605" : ""}`,
        description: l.description,
        level: l.label,
        isDefault,
      };
    });

    const picked = await vscode.window.showQuickPick(items, { placeHolder: "Select thinking level (\u2605 = default)" });
    if (!picked) { return false; }

    await this.setThinkingLevel(picked.level);

    if (!picked.isDefault) {
      const save = await vscode.window.showQuickPick(
        [{ label: "\u2605 Save as default", description: "Use this thinking level for future sessions" }],
        { placeHolder: `Use "${picked.level}" thinking as the default?` },
      );
      if (save) { this.saveDefaultThinking(); }
    }

    return true;
  }

  // ── Scoped Models ─────────────────────────────────────

  getScopedModels(): Array<{ provider: string; id: string; thinkingLevel: string }> {
    if (!this.host.session || !this.host.session.scopedModels) { return []; }
    return this.host.session.scopedModels
      .filter((s: Record<string, unknown>) => s.model !== null && s.model !== undefined)
      .map((s: Record<string, unknown>) => ({
        provider: (s.model as Record<string, unknown>).provider as string,
        id: (s.model as Record<string, unknown>).id as string,
        thinkingLevel: (s.thinkingLevel as string) ?? "off",
      }));
  }
}
