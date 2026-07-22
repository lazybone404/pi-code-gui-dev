/**
 * Auth service — handles login/logout/API key management.
 * Extracted from PiService to keep the main file focused on agent lifecycle.
 */

import * as vscode from "vscode";

/** Minimum dependencies AuthService needs from its host */
export interface AuthServiceHost {
  modelRuntime: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  modelRegistry: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  get model(): { id?: string; provider?: string } | null;
  setModel(provider: string, modelId: string): Promise<void>;
}

// Helper: vscode.l10n.t with {0},{1} parameter support
const lt = (key: string, ...args: string[]): string => {
  let msg = vscode.l10n.t(key);
  for (let i = 0; i < args.length; i++) { msg = msg.replace(`{${i}}`, args[i]); }
  return msg;
};

export class AuthService {
  constructor(private host: AuthServiceHost) {}

  /** Set a runtime API key (not persisted to disk) */
  setRuntimeApiKey(provider: string, key: string): void {
    if (this.host.modelRuntime && typeof this.host.modelRuntime.setRuntimeApiKey === "function") {
      void this.host.modelRuntime.setRuntimeApiKey(provider, key);
    }
  }

  /**
   * Main login flow:
   * 1. Pick auth type (oauth vs api_key)
   * 2. Select provider
   * 3. Execute the appropriate login flow
   */
  async login(): Promise<void> {
    if (!this.host.modelRuntime || !this.host.modelRegistry) {
      throw new Error("Pi session not initialized");
    }

    const authType = await this.pickAuthType();
    if (!authType) { return; }

    const providerChoice = await this.pickLoginProvider(authType);
    if (!providerChoice) { return; }

    if (providerChoice.authType === "oauth") {
      await this.doOAuthLogin(providerChoice.id, providerChoice.name);
    } else if (providerChoice.id === "amazon-bedrock") {
      await vscode.window.showInformationMessage(
        "Amazon Bedrock uses AWS credentials. Configure an AWS profile, IAM keys, or role-based credentials.",
      );
    } else {
      await this.doApiKeyLogin(providerChoice.id, providerChoice.name);
    }
  }

  /**
   * Show the logout flow for a provider.
   */
  async logout(): Promise<void> {
    const { modelRuntime, modelRegistry } = this.host;

    if (!modelRuntime || !modelRegistry) {
      throw new Error("Pi session not initialized");
    }

    const options: Array<{ id: string; name: string; label: string; description: string }> = [];
    const creds = await modelRuntime.listCredentials();
    for (const c of creds) {
      const providerId = c.providerId;
      const auth = await modelRuntime.getAuth(providerId);
      const credential = auth
        ? { type: auth.source === "oauth" ? "oauth" : "api_key", ...auth.auth }
        : undefined;
      if (!credential) { continue; }
      const displayName = modelRegistry.getProviderDisplayName(providerId);
      options.push({
        id: providerId,
        name: displayName,
        label: displayName,
        description: credential.type === "oauth" ? "OAuth subscription" : "API key",
      });
    }

    if (options.length === 0) {
      await vscode.window.showInformationMessage(
        lt("msg.noStoredCredentials"),
      );
      return;
    }

    const pick = await this.quickPick(
      options.sort((a, b) => a.name.localeCompare(b.name)),
      "Select provider to logout:",
    );
    if (!pick) { return; }

    try {
      await modelRuntime.logout(pick.id);
      modelRegistry.refresh();
      const message =
        pick.description === "OAuth subscription"
          ? `Logged out of ${pick.name}`
          : `Removed stored API key for ${pick.name}.`;
      await vscode.window.showInformationMessage(message);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      await vscode.window.showErrorMessage(lt("msg.logoutFailed", error.message ?? error));
    }
  }

  // ── Private helpers ────────────────────────────────────

  private async quickPick<T extends { label: string; description?: string }>(
    items: T[],
    placeHolder: string,
  ): Promise<T | undefined> {
    return vscode.window.showQuickPick(items, { placeHolder, matchOnDescription: true });
  }

  private async pickAuthType(): Promise<"oauth" | "api_key" | undefined> {
    const ITEMS = [
      { label: "Use a subscription", authType: "oauth" as const, description: "OAuth login" },
      { label: "Use an API key", authType: "api_key" as const, description: "Enter an API key" },
    ];
    const pick = await this.quickPick(ITEMS, "Select authentication method:");
    return pick?.authType;
  }

  private async pickLoginProvider(
    authType: "oauth" | "api_key",
  ): Promise<{ id: string; name: string; authType: string } | undefined> {
    const options = this.buildProviderOptions(authType);
    if (options.length === 0) {
      const label = authType === "oauth"
        ? lt("msg.noOAuthProviders")
        : lt("msg.noApiKeyProviders");
      await vscode.window.showInformationMessage(label);
      return undefined;
    }
    const pick = await this.quickPick(
      options,
      `Select ${authType === "oauth" ? "subscription" : "API key"} provider:`,
    );
    return pick;
  }

  private buildProviderOptions(
    authType: "oauth" | "api_key",
  ): Array<{ id: string; name: string; authType: string; label: string; description: string }> {
    const { modelRuntime, modelRegistry } = this.host;

    const oauthProviders = modelRuntime.getRegisteredProviderIds()
      .filter((id: string) => modelRuntime.isUsingOAuth(id))
      .map((id: string) => ({
        id,
        name: modelRegistry?.getProviderDisplayName(id) ?? id,
      }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const oauthProviderIds = new Set(oauthProviders.map((p: any) => p.id));
    const options: Array<{ id: string; name: string; authType: string; label: string; description: string }> = [];

    if (authType === "oauth") {
      for (const provider of oauthProviders) {
        const authStatus = modelRegistry.getProviderAuthStatus(provider.id);
        options.push({
          id: provider.id,
          name: provider.name,
          authType: "oauth",
          label: provider.name,
          description: authStatus?.configured ? "$(check) Already configured" : "",
        });
      }
    } else {
      const allModels = modelRegistry.getAll();
      const seenProviders = new Set<string>();
      for (const model of allModels) {
        const providerId = model.provider;
        if (seenProviders.has(providerId)) { continue; }
        seenProviders.add(providerId);
        if (oauthProviderIds.has(providerId)) { continue; }
        const displayName = modelRegistry.getProviderDisplayName(providerId);
        const authStatus = modelRegistry.getProviderAuthStatus(providerId);
        options.push({
          id: providerId,
          name: displayName,
          authType: "api_key",
          label: displayName,
          description: authStatus?.configured
            ? `$(check) Already configured (${authStatus.source})`
            : "",
        });
      }
    }

    return options.sort((a, b) => a.name.localeCompare(b.name));
  }

  private async doOAuthLogin(providerId: string, providerName: string): Promise<void> {
    const { modelRuntime, modelRegistry } = this.host;
    const previousModel = this.host.model;

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Logging in to ${providerName}...`,
          cancellable: true,
        },
        async (progress, token) => {
          const abortController = new AbortController();
          token.onCancellationRequested(() => abortController.abort());

          await modelRuntime.login(providerId, {
            onAuth: (info: { url: string; instructions?: string }) => {
              vscode.env.openExternal(vscode.Uri.parse(info.url));
              if (info.instructions) { progress.report({ message: info.instructions }); }
            },
            onPrompt: async (prompt: { message: string; placeholder?: string }) => {
              return vscode.window.showInputBox({
                prompt: prompt.message,
                placeHolder: prompt.placeholder,
                password: true,
                ignoreFocusOut: true,
              }) ?? "";
            },
            onProgress: (message: string) => { progress.report({ message }); },
            onManualCodeInput: () => {
              return new Promise<string>((resolve, reject) => {
                token.onCancellationRequested(() => reject(new Error("Login cancelled")));
                vscode.window
                  .showInputBox({
                    prompt: "Paste redirect URL below, or complete login in browser:",
                    ignoreFocusOut: true,
                  })
                  .then((value) => {
                    if (value) { resolve(value); }
                    else { reject(new Error("Login cancelled")); }
                  });
              });
            },
            signal: abortController.signal,
          });

          progress.report({ message: "Login successful!" });
        },
      );

      modelRegistry.refresh();
      await this.afterLogin(providerId, providerName, "oauth", previousModel);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      if (error.message !== "Login cancelled") {
        await vscode.window.showErrorMessage(lt("msg.loginFailed", providerName, error.message ?? error));
      }
    }
  }

  private async doApiKeyLogin(providerId: string, providerName: string): Promise<void> {
    const { modelRuntime, modelRegistry } = this.host;
    const previousModel = this.host.model;

    try {
      const apiKey = await vscode.window.showInputBox({
        prompt: `Enter API key for ${providerName}:`,
        password: true,
        placeHolder: "sk-...",
        validateInput: (value) => (value.trim() ? undefined : "API key required"),
        ignoreFocusOut: true,
      });

      if (!apiKey || !apiKey.trim()) { return; }

      await modelRuntime.setRuntimeApiKey(providerId, apiKey.trim());
      modelRegistry.refresh();
      await this.afterLogin(providerId, providerName, "api_key", previousModel);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      if (error.message !== "Login cancelled") {
        await vscode.window.showErrorMessage(lt("msg.saveKeyFailed", providerName, error.message ?? error));
      }
    }
  }

  private async afterLogin(
    providerId: string,
    providerName: string,
    authType: string,
    previousModel: { id?: string; provider?: string } | null,
  ): Promise<void> {
    const { modelRegistry } = this.host;
    const hasModelRegistry = modelRegistry && modelRegistry.getAvailable;
    if (hasModelRegistry && (!previousModel || previousModel.provider === "unknown")) {
      const availableModels = modelRegistry.getAvailable();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      const providerModels = availableModels.filter((m: any) => m.provider === providerId);
      if (providerModels.length > 0) {
        try {
          await this.host.setModel(providerId, providerModels[0].id);
          await vscode.window.showInformationMessage(lt("msg.loggedIn", providerName, providerModels[0].id));
        } catch {
          await vscode.window.showInformationMessage(lt("msg.loggedInNoModel", providerName));
        }
        return;
      }
    }

    await vscode.window.showInformationMessage(lt("msg.loggedInNoModel", providerName));
  }
}
