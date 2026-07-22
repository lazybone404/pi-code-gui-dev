// ── Shared DOM element references ──────────────────
// All handler modules import from here to avoid circular deps.

// Nav bar elements
export const navSession   = document.getElementById("nav-session");
export const navModel     = document.getElementById("nav-model");
export const navThinking  = document.getElementById("nav-thinking");
export const navHistory   = document.getElementById("nav-history");

// Status bar elements (metrics only)
export const sbDot        = document.getElementById("pi-sb-dot");
export const sbEffort     = document.getElementById("pi-sb-effort");
export const sbUsage      = document.getElementById("pi-sb-usage");
export const sbSettings   = document.getElementById("pi-sb-settings");
export const sbExtStatus  = document.getElementById("pi-extension-status");

// Input elements
export const promptInput  = document.getElementById("prompt-input") as HTMLTextAreaElement | null;
export const sendButton   = document.getElementById("send-button") as HTMLButtonElement | null;
export const abortButton  = document.getElementById("abort-button") as HTMLButtonElement | null;

// Chat
export const chatContainer = document.getElementById("chat-container");
export const livePanel     = document.getElementById("live-panel");
export const attachmentBar = document.getElementById("attachment-bar");

// Overlays
export const userMsgOverlay   = document.getElementById("user-msg-overlay");
export const settingsOverlay  = document.getElementById("settings-overlay");
export const slashAutocomplete = document.getElementById("slash-autocomplete");
