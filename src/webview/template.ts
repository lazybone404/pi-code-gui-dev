// HTML template for the webview panel.
// Keep it simple: a function that takes URIs and returns the full HTML string.

export function renderTemplate(opts: {
  nonce: string;
  bundleUri: string;
  styleUri: string;
  cspSource: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${opts.cspSource} 'unsafe-inline'; script-src 'nonce-${opts.nonce}'; img-src ${opts.cspSource} blob: data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pi Code Gui</title>
  <link rel="stylesheet" href="${opts.styleUri}">
</head>
<body>
  <!-- Navigation bar -->
  <div id="nav-bar" class="nav-bar">
    <div class="nav-left">
      <span id="nav-session" class="nav-session">Pi Code Gui</span>
      <button id="nav-history" class="nav-icon-btn" title="Switch session">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
      </button>
    </div>
    <div class="nav-right">
      <button id="nav-model" class="nav-pill" title="Change model"></button>
      <button id="nav-thinking" class="nav-pill" title="Change thinking level"></button>
    </div>
  </div>

  <!-- Messages (scrollable) -->
  <div id="chat-container">
  <!-- Welcome / Auth page (centered empty state) -->
  <div id="welcome" class="welcome-page" style="display:none">
    <div class="welcome-ascii">
      <svg width="64" height="64" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.6">
        <circle cx="32" cy="32" r="28"/>
        <text x="32" y="40" text-anchor="middle" font-size="32" font-family="serif" fill="currentColor" stroke="none" opacity="0.8">π</text>
      </svg>
    </div>
    <h2 class="welcome-title">Pi Code Gui</h2>
    <p class="welcome-desc">Connect your API key to get started</p>
    <div id="welcome-actions" class="welcome-actions">
      <button id="welcome-login-btn" class="welcome-connect-btn">Connect Account</button>
    </div>
    <div id="welcome-auth-url" class="welcome-auth-url" style="display:none">
      <div class="welcome-url-row">
        <input id="welcome-url-input" class="welcome-url-input" readonly />
        <button id="welcome-url-copy" class="welcome-url-copy">Copy</button>
      </div>
      <p id="welcome-auth-waiting" class="welcome-auth-waiting">Waiting for authentication...</p>
    </div>
    <p class="welcome-hint">
      Or set <code>DEEPSEEK_API_KEY</code> in your environment
    </p>
  </div>
    <div id="live-panel"></div>
  </div>

  <!-- Input -->
  <div id="attachment-bar"></div>
  <div id="input-area">
    <textarea id="prompt-input" placeholder="Ask Pi to help you code..." rows="1" disabled></textarea>
    <div id="steer-split">
      <button id="send-button" disabled title="Submit (Enter)">↵</button>
      <button id="steer-dropdown" class="hidden" title="Switch to Queue">▾</button>
    </div>
    <button id="abort-button" class="hidden">■ Stop</button>
  </div>

  <!-- Status bar -->
  <div id="pi-status-bar">
    <span id="pi-sb-dot"></span>
    <div id="pi-extension-status" class="pi-sb-item"></div>
    <div class="pi-sb-item spacer"></div>
    <div class="pi-sb-item" id="pi-sb-usage" title="Click to set context budget"></div>
    <div class="pi-sb-item" id="pi-sb-settings" title="Settings">⚙</div>
  </div>

  <!-- Overlays -->
  <div class="user-msg-selector-overlay" id="user-msg-overlay"></div>
  <div class="settings-overlay" id="settings-overlay"></div>
  <div class="slash-autocomplete" id="slash-autocomplete"></div>

  <script nonce="${opts.nonce}" src="${opts.bundleUri}"></script>
</body>
</html>`;
}
