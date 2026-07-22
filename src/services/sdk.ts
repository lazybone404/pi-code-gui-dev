/**
 * SDK resolution and dynamic import helpers.
 * Finds the pi-coding-agent SDK at runtime and provides type definitions.
 */

import * as path from "node:path";
import * as fs from "node:fs";
import { piWarn } from "../logger.js";

// ── Types for the dynamically loaded SDK ──────────────────

/* eslint-disable @typescript-eslint/no-explicit-any -- dynamically imported SDK */
export interface PiSdk {
  createAgentSession: Function;
  SessionManager: any;
  SettingsManager: any;
  ModelRuntime: any;
  ModelRegistry: any;
  createCodingTools: Function;
  createReadOnlyTools: Function;
  DefaultResourceLoader: any;
  defineTool: Function;
  getAgentDir: Function;
  createSyntheticSourceInfo: Function;
}

export interface PiAi {
  getModel: Function;
  getProviders: Function;
  complete: Function;
}

export interface InstallStatus {
  installed: boolean;
  hasApiKey: boolean;
  path?: string;
  error?: string;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ── Helpers ──────────────────────────────────────────────

/** Find the last element matching predicate (ES2023 findLast polyfill). */
export function reverseFind<T>(arr: T[], pred: (el: T) => boolean): T | undefined {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i])) { return arr[i]; }
  }
  return undefined;
}

/** Convert a Windows absolute path to a file:// URL for ESM import. */
export function toFileUrl(filePath: string): string {
  if (process.platform === "win32" && filePath.length > 1 && filePath[1] === ":") {
    return "file:///" + filePath.replace(/\\/g, "/");
  }
  return filePath;
}

/**
 * Dynamic import with retry — handles the race where npm is still
 * populating node_modules when the extension host first activates.
 */
export async function importWithRetry(
  modulePath: string,
  maxAttempts: number,
  delayMs: number,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const importUrl = toFileUrl(modulePath);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await import(importUrl);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      if (attempt === maxAttempts) { throw e; }
      piWarn(`importWithRetry: attempt ${attempt}/${maxAttempts} failed for ${modulePath}: ${e.message}`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

// ── SDK Path Resolution ──────────────────────────────────

export function resolvePiPackagePath(): string {
  const pkgSuffix = path.join("node_modules", "@earendil-works", "pi-coding-agent");
  const candidates: Set<string> = new Set();

  // 1. Project-local install
  candidates.add(path.resolve(path.join(".pi", "npm", pkgSuffix)));

  // 2. Universal PATH scan — derive npm global prefixes from $PATH entries
  const pathEnv = process.env.PATH || "";
  const separator = process.platform === "win32" ? ";" : ":";
  const seenPrefixes = new Set<string>();
  for (const binDir of pathEnv.split(separator)) {
    if (!binDir) { continue; }
    let normBin = path.normalize(binDir);
    if (normBin.endsWith(path.sep)) { normBin = normBin.slice(0, -1); }
    const prefix = path.dirname(normBin);
    if (seenPrefixes.has(normBin)) { continue; }
    seenPrefixes.add(normBin);
    candidates.add(path.join(prefix, "lib", pkgSuffix));
    if (process.platform === "win32") {
      candidates.add(path.join(prefix, pkgSuffix));
    }
  }

  // 3. Windows AppData (npm default on Windows)
  const appData = process.env.APPDATA || "";
  if (appData) {
    candidates.add(path.join(appData, "npm", pkgSuffix));
  }

  // 4. Legacy hardcoded fallbacks (for GUI-launched VS Code with incomplete $PATH)
  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (home) {
    candidates.add(path.join(home, ".npm-global", "lib", pkgSuffix));
    candidates.add(path.join(home, ".local", "lib", pkgSuffix));
  }
  if (process.env.NVM_DIR) {
    try {
      const versionsDir = path.join(process.env.NVM_DIR, "versions", "node");
      if (fs.existsSync(versionsDir)) {
        for (const version of fs.readdirSync(versionsDir)) {
          candidates.add(path.join(versionsDir, version, "lib", pkgSuffix));
        }
      }
    } catch (e: unknown) { piWarn(`Non-critical failure (ignored): ${e instanceof Error ? e.message : String(e)}`); }
  }

  for (const candidate of candidates) {
    try {
      const pkgPath = path.join(candidate, "package.json");
      if (fs.existsSync(pkgPath)) { return candidate; }
    } catch (e: unknown) { piWarn(`Non-critical failure (ignored): ${e instanceof Error ? e.message : String(e)}`); }
  }

  throw new Error(
    "Pi coding agent SDK not found. Please install it:\n" +
      "  npm install -g @earendil-works/pi-coding-agent",
  );
}

/** Check if pi-coding-agent SDK is installed globally */
export function checkPiInstall(): InstallStatus {
  try {
    const piRoot = resolvePiPackagePath();
    const requiredDeps = [
      ["openai", "index.js"],
      ["@anthropic-ai/sdk", "index.mjs"],
    ] as const;
    const missing: string[] = [];
    for (const [dep, file] of requiredDeps) {
      const depPath = path.join(piRoot, "node_modules", dep, file);
      if (!fs.existsSync(depPath)) {
        const altPath = path.join(piRoot, "..", "..", dep, file);
        if (!fs.existsSync(altPath)) { missing.push(dep); }
      }
    }

    if (missing.length > 0) {
      return {
        installed: false,
        hasApiKey: false,
        error: `Pi SDK found but dependencies are missing: ${missing.join(", ")}. Reinstall with: npm uninstall -g @earendil-works/pi-coding-agent && npm install -g @earendil-works/pi-coding-agent`,
      };
    }

    return { installed: true, hasApiKey: true, path: piRoot };
  } catch (e: unknown) {
    const err = e as Error;
    return { installed: false, hasApiKey: false, error: err.message ?? String(err) };
  }
}
