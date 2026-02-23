function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function safeInlineJSON(data: unknown): string {
	return JSON.stringify(data)
		.replace(/</g, "\\u003c")
		.replace(/>/g, "\\u003e")
		.replace(/&/g, "\\u0026");
}

function buildProviderOptions(
	available: { perplexity: boolean; gemini: boolean },
	selected: string,
): string {
	const options = [
		{ value: "perplexity", label: "Perplexity", disabled: !available.perplexity },
		{ value: "gemini", label: "Gemini", disabled: !available.gemini },
	];

	return options
		.map(o => `<option value="${o.value}"${o.value === selected ? " selected" : ""}${o.disabled ? " disabled" : ""}>${o.label}</option>`)
		.join("");
}

export function generateCuratorPage(
	queries: string[],
	sessionToken: string,
	timeout: number,
	availableProviders: { perplexity: boolean; gemini: boolean },
	defaultProvider: string,
): string {
	const providerOptionsHtml = buildProviderOptions(availableProviders, defaultProvider);
	const inlineData = safeInlineJSON({ queries, sessionToken, timeout });

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Curate Search Results</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif&family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/marked@15/marked.min.js"><\/script>
<style>
${CSS}
</style>
</head>
<body>

<div class="timer-badge" id="timer" title="Click to adjust">--:--</div>
<div class="timer-adjust" id="timer-adjust">
<input type="text" id="timer-input" value="${timeout}">
<span class="timer-adjust-label">sec</span>
<button class="timer-adjust-btn" id="timer-set">Set</button>
</div>

<main>
<div class="hero" id="hero">
<div class="hero-kicker">Web Search</div>
<h1 class="hero-title">Searching\u2026</h1>
<p class="hero-desc">Results will appear below as they complete.</p>
<div class="hero-meta">
<span id="hero-status">Searching\u2026</span>
<span class="hero-meta-sep"></span>
<select id="global-provider">${providerOptionsHtml}</select>
</div>
</div>
<div id="result-cards"></div>
<div class="add-search" id="add-search">
<span class="add-search-icon">+</span>
<input type="text" placeholder="Add a search\u2026" id="add-search-input">
</div>
</main>

<footer class="action-bar">
<div class="action-shortcuts">
<span class="shortcut"><kbd>A</kbd> <span>Toggle all</span></span>
<span class="shortcut"><kbd>Enter</kbd> <span>Send</span></span>
<span class="shortcut"><kbd>Esc</kbd> <span>Skip</span></span>
</div>
<div class="action-buttons">
<button class="btn btn-secondary" id="btn-send-all" hidden>Send All</button>
<button class="btn btn-submit" id="btn-send" disabled>Waiting for results\u2026</button>
</div>
</footer>

<div id="success-overlay" class="success-overlay hidden" aria-live="polite">
<div class="success-icon">OK</div>
<p id="success-text">Results sent</p>
</div>

<div id="expired-overlay" class="expired-overlay hidden" aria-live="polite">
<div class="expired-content">
<div class="expired-icon">!</div>
<h2>Session Ended</h2>
<p id="expired-text">Time\u2019s up \u2014 sending all results to your agent.</p>
<div class="expired-countdown">Closing in <span id="close-countdown">5</span>s</div>
</div>
</div>

<div id="error-banner" class="error-banner" hidden></div>

<script>
${SCRIPT.replace("__INLINE_DATA__", () => inlineData)}
</script>
</body>
</html>`;
}

const CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}

:root {
  --bg: #18181e;
  --bg-card: #1e1e24;
  --bg-elevated: #252530;
  --bg-hover: #2b2b37;
  --fg: #e0e0e0;
  --fg-muted: #909098;
  --fg-dim: #606068;
  --accent: #8abeb7;
  --accent-hover: #9dcec7;
  --accent-muted: rgba(138, 190, 183, 0.15);
  --accent-subtle: rgba(138, 190, 183, 0.08);
  --border: #2a2a34;
  --border-muted: #353540;
  --border-checked: #8abeb7;
  --check-bg: #8abeb7;
  --btn-primary: #8abeb7;
  --btn-primary-hover: #9dcec7;
  --btn-primary-fg: #18181e;
  --btn-secondary: #252530;
  --btn-secondary-hover: #2b2b37;
  --timer-bg: #252530;
  --timer-fg: #909098;
  --timer-warn-bg: rgba(240, 198, 116, 0.15);
  --timer-warn-fg: #f0c674;
  --timer-urgent-bg: rgba(204, 102, 102, 0.15);
  --timer-urgent-fg: #cc6666;
  --overlay-bg: rgba(24, 24, 30, 0.92);
  --success: #b5bd68;
  --warning: #f0c674;
  --font: 'Outfit', system-ui, -apple-system, sans-serif;
  --font-display: 'Instrument Serif', Georgia, 'Times New Roman', serif;
  --font-mono: 'SF Mono', Consolas, monospace;
  --radius: 10px;
  --radius-sm: 6px;
}

@media (prefers-color-scheme: light) {
  :root {
    --bg: #f5f5f7;
    --bg-card: #ffffff;
    --bg-elevated: #eeeef0;
    --bg-hover: #e4e4e8;
    --fg: #1a1a1e;
    --fg-muted: #6c6c74;
    --fg-dim: #9a9aa2;
    --accent: #5f8787;
    --accent-hover: #4a7272;
    --accent-muted: rgba(95, 135, 135, 0.12);
    --accent-subtle: rgba(95, 135, 135, 0.06);
    --border: #dcdce0;
    --border-muted: #c8c8d0;
    --border-checked: #5f8787;
    --check-bg: #5f8787;
    --btn-primary: #5f8787;
    --btn-primary-hover: #4a7272;
    --btn-primary-fg: #ffffff;
    --btn-secondary: #e4e4e8;
    --btn-secondary-hover: #d4d4d8;
    --timer-bg: #e4e4e8;
    --timer-fg: #6c6c74;
    --timer-warn-bg: rgba(217, 119, 6, 0.10);
    --timer-warn-fg: #92400e;
    --timer-urgent-bg: rgba(175, 95, 95, 0.10);
    --timer-urgent-fg: #991b1b;
    --overlay-bg: rgba(255, 255, 255, 0.92);
    --success: #4d7c0f;
    --warning: #b45309;
  }
}

body {
  font-family: var(--font);
  background: var(--bg);
  background-image: radial-gradient(ellipse at 50% 0%, var(--accent-muted) 0%, transparent 60%);
  color: var(--fg);
  line-height: 1.5;
  min-height: 100dvh;
  padding-bottom: 72px;
}

.timer-badge {
  position: fixed;
  top: 20px;
  right: 24px;
  z-index: 50;
  font-family: var(--font);
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  padding: 5px 14px;
  border-radius: 999px;
  background: var(--bg-elevated);
  color: var(--timer-fg);
  border: 1px solid var(--border);
  transition: background 0.3s, color 0.3s, border-color 0.3s, opacity 0.3s;
  box-shadow: 0 2px 8px rgba(0,0,0,0.2);
  cursor: pointer;
  user-select: none;
  opacity: 0.5;
}
.timer-badge:hover { opacity: 1; }
.timer-badge.active { opacity: 1; }
.timer-badge.warn {
  opacity: 1;
  background: var(--timer-warn-bg);
  color: var(--timer-warn-fg);
  border-color: color-mix(in srgb, var(--timer-warn-fg) 30%, transparent);
}
.timer-badge.urgent {
  opacity: 1;
  background: var(--timer-urgent-bg);
  color: var(--timer-urgent-fg);
  border-color: color-mix(in srgb, var(--timer-urgent-fg) 30%, transparent);
}
.timer-adjust {
  position: fixed;
  top: 20px;
  right: 24px;
  z-index: 51;
  display: none;
  align-items: center;
  gap: 6px;
  padding: 4px 6px 4px 12px;
  background: var(--bg-elevated);
  border: 1px solid var(--accent);
  border-radius: 999px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.3);
}
.timer-adjust.visible { display: flex; }
.timer-adjust input {
  width: 48px;
  background: transparent;
  border: none;
  outline: none;
  color: var(--fg);
  font-family: var(--font);
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  text-align: center;
}
.timer-adjust-label { font-size: 11px; color: var(--fg-dim); }
.timer-adjust-btn {
  font-family: var(--font);
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 999px;
  border: none;
  background: var(--accent);
  color: var(--btn-primary-fg);
  cursor: pointer;
}
.timer-adjust-btn:hover { background: var(--accent-hover); }

main {
  max-width: 640px;
  margin: 0 auto;
  padding: 56px 24px 16px;
}

.hero { margin-bottom: 28px; }
.hero-kicker {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--accent);
  margin-bottom: 8px;
}
.hero-title {
  font-family: var(--font-display);
  font-size: 40px;
  font-weight: 400;
  font-style: italic;
  letter-spacing: -0.01em;
  line-height: 1.1;
  color: var(--fg);
  margin-bottom: 10px;
  text-wrap: balance;
}
.hero-desc {
  font-size: 14px;
  color: var(--fg-muted);
  line-height: 1.5;
  margin-bottom: 12px;
  max-width: 480px;
}
.hero-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--fg-dim);
}
.hero-meta-sep {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--fg-dim);
  flex-shrink: 0;
}
#hero-status:empty + .hero-meta-sep { display: none; }
.hero-meta select {
  font-family: var(--font);
  font-size: 13px;
  padding: 3px 8px;
  background: transparent;
  border: 1px solid transparent;
  color: var(--fg-muted);
  border-radius: var(--radius-sm);
  font-weight: 500;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}
.hero-meta select:hover {
  border-color: var(--border-muted);
  color: var(--fg);
}
.hero-meta select:focus {
  outline: none;
  border-color: var(--accent);
  color: var(--fg);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 20%, transparent);
}

#result-cards { display: flex; flex-direction: column; gap: 8px; }

.result-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  transition: border-color 0.12s;
  box-shadow: 0 1px 2px rgba(0,0,0,0.06);
}
.result-card.checked { border-color: var(--border-checked); }
.result-card.searching {
  opacity: 0.7;
  border-style: dashed;
}
.result-card.error { border-color: var(--timer-urgent-fg); }

.result-card-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  cursor: pointer;
  user-select: none;
  transition: background 0.12s;
}
.result-card-header:hover { background: var(--bg-hover); }

.result-card-header input[type="checkbox"] {
  appearance: none;
  width: 16px;
  height: 16px;
  min-width: 16px;
  border: 1.5px solid var(--border-muted);
  border-radius: 4px;
  margin-top: 2px;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
  display: grid;
  place-content: center;
}
.result-card-header input[type="checkbox"]:checked {
  background: var(--check-bg);
  border-color: var(--check-bg);
}
.result-card-header input[type="checkbox"]:checked::after {
  content: "";
  width: 9px;
  height: 6px;
  border-left: 2px solid var(--btn-primary-fg);
  border-bottom: 2px solid var(--btn-primary-fg);
  transform: rotate(-45deg);
  margin-top: -1px;
}

.result-card-info { flex: 1; min-width: 0; }

.result-card-query {
  font-size: 14px;
  font-weight: 600;
  color: var(--fg);
  margin-bottom: 2px;
}
.result-card-meta {
  font-size: 12px;
  color: var(--fg-dim);
}
.result-card-preview {
  font-size: 12.5px;
  color: var(--fg-muted);
  margin-top: 6px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.45;
}

.result-card-expand {
  color: var(--fg-dim);
  font-size: 11px;
  margin-top: 2px;
  flex-shrink: 0;
  padding-top: 3px;
  transition: color 0.12s;
}
.result-card-header:hover .result-card-expand { color: var(--fg-muted); }

.result-card-body {
  display: none;
  border-top: 1px solid var(--border);
}
.result-card-body.open { display: block; }

.result-card-answer {
  padding: 14px 16px;
  font-size: 13.5px;
  color: var(--fg-muted);
  line-height: 1.6;
  max-height: 400px;
  overflow-y: auto;
}
.result-card-answer h1,
.result-card-answer h2,
.result-card-answer h3,
.result-card-answer h4 {
  color: var(--fg);
  font-family: var(--font);
  font-weight: 600;
  margin: 16px 0 6px;
  line-height: 1.3;
}
.result-card-answer h1 { font-size: 16px; }
.result-card-answer h2 { font-size: 14.5px; }
.result-card-answer h3 { font-size: 13.5px; }
.result-card-answer h4 { font-size: 13px; color: var(--fg-muted); }
.result-card-answer p { margin: 0 0 10px; }
.result-card-answer p:last-child { margin-bottom: 0; }
.result-card-answer strong { color: var(--fg); font-weight: 600; }
.result-card-answer a { color: var(--accent); text-decoration: none; }
.result-card-answer a:hover { text-decoration: underline; }
.result-card-answer ul, .result-card-answer ol {
  margin: 6px 0 10px;
  padding-left: 20px;
}
.result-card-answer li { margin-bottom: 4px; }
.result-card-answer li::marker { color: var(--fg-dim); }
.result-card-answer code {
  font-family: var(--font-mono);
  font-size: 12px;
  padding: 1px 5px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--fg);
}
.result-card-answer pre {
  margin: 8px 0 12px;
  padding: 12px 14px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  overflow-x: auto;
  line-height: 1.45;
}
.result-card-answer pre code {
  padding: 0;
  background: none;
  border: none;
  font-size: 12px;
  color: var(--fg-muted);
}
.result-card-answer blockquote {
  margin: 8px 0;
  padding: 8px 14px;
  border-left: 3px solid var(--accent);
  color: var(--fg-dim);
  background: var(--accent-subtle);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}
.result-card-answer table {
  width: 100%;
  border-collapse: collapse;
  margin: 8px 0 12px;
  font-size: 12.5px;
}
.result-card-answer th, .result-card-answer td {
  padding: 6px 10px;
  border: 1px solid var(--border);
  text-align: left;
}
.result-card-answer th {
  background: var(--bg-elevated);
  color: var(--fg);
  font-weight: 600;
  font-size: 11.5px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.result-card-answer hr {
  border: none;
  border-top: 1px solid var(--border);
  margin: 14px 0;
}

.result-card-sources {
  padding: 10px 16px 14px;
  border-top: 1px solid var(--border);
}
.result-card-sources-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--fg-dim);
  margin-bottom: 6px;
}
.source-link {
  display: block;
  padding: 4px 0;
  font-size: 12.5px;
  color: var(--fg-muted);
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 0.12s;
}
.source-link:hover { color: var(--accent); }
.source-domain {
  color: var(--fg-dim);
  margin-left: 6px;
}

.result-card-error-msg {
  padding: 12px 16px;
  font-size: 13px;
  color: var(--timer-urgent-fg);
}

.searching-dots::after {
  content: "";
  animation: dots 1.5s steps(4, end) infinite;
}
@keyframes dots {
  0% { content: ""; }
  25% { content: "."; }
  50% { content: ".."; }
  75% { content: "..."; }
}

.add-search {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
  padding: 11px 14px;
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  cursor: text;
  transition: border-color 0.15s, background 0.15s;
}
.add-search:hover {
  border-color: var(--border-muted);
  background: var(--accent-subtle);
}
.add-search:focus-within {
  border-color: var(--accent);
  border-style: solid;
  background: var(--accent-subtle);
}
.add-search-icon {
  color: var(--fg-dim);
  font-size: 16px;
  font-weight: 300;
  line-height: 1;
  flex-shrink: 0;
  transition: color 0.15s;
}
.add-search:focus-within .add-search-icon { color: var(--accent); }
.add-search input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: var(--fg);
  font-family: var(--font);
  font-size: 13.5px;
  font-weight: 500;
}
.add-search input::placeholder {
  color: var(--fg-dim);
  font-weight: 400;
}
.add-search.loading {
  opacity: 0.5;
  pointer-events: none;
}

.action-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  background: color-mix(in srgb, var(--bg) 90%, transparent);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-top: 1px solid var(--border);
}
.action-shortcuts { display: flex; align-items: center; gap: 16px; }
.shortcut { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--fg-dim); }
.shortcut kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 500;
  background: var(--bg-elevated);
  border: 1px solid var(--border-muted);
  border-radius: 3px;
  color: var(--fg-muted);
}
.action-buttons { display: flex; gap: 8px; }

.btn {
  font-family: var(--font);
  font-size: 13px;
  font-weight: 500;
  padding: 7px 16px;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.12s, opacity 0.12s;
}
.btn:disabled { opacity: 0.35; cursor: default; }
.btn-submit { background: var(--btn-primary); color: var(--btn-primary-fg); }
.btn-submit:hover:not(:disabled) { background: var(--btn-primary-hover); }
.btn-secondary { background: var(--btn-secondary); color: var(--fg-muted); border: 1px solid var(--border); }
.btn-secondary:hover:not(:disabled) { background: var(--btn-secondary-hover); color: var(--fg); }

.success-overlay {
  position: fixed; inset: 0; z-index: 200;
  background: var(--overlay-bg);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
  transition: opacity 200ms;
}
.success-overlay.hidden { display: flex !important; opacity: 0; pointer-events: none; }
.success-icon {
  width: 56px; height: 56px; border-radius: 50%;
  border: 2px solid var(--success);
  display: flex; align-items: center; justify-content: center;
  font-size: 18px; font-weight: 700; color: var(--success);
}
.success-overlay p { margin: 0; font-size: 13px; font-weight: 600; color: var(--success); letter-spacing: 0.06em; text-transform: uppercase; }

.expired-overlay {
  position: fixed; inset: 0;
  background: var(--overlay-bg);
  display: flex; align-items: center; justify-content: center;
  opacity: 0; transition: opacity 400ms; pointer-events: none; z-index: 200;
}
.expired-overlay.visible { opacity: 1; pointer-events: auto; }
.expired-overlay.hidden { display: flex !important; opacity: 0; pointer-events: none; }
.expired-content {
  text-align: center; max-width: 480px; padding: 48px 56px;
  background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px;
}
.expired-overlay.visible .expired-content { animation: slide-up 400ms ease-out; }
@keyframes slide-up { from { transform: translateY(20px); } to { transform: translateY(0); } }
.expired-icon {
  width: 72px; height: 72px; border-radius: 50%; border: 2px solid var(--warning);
  display: flex; align-items: center; justify-content: center;
  font-size: 32px; font-weight: bold; color: var(--warning); margin: 0 auto 24px;
}
.expired-content h2 { color: var(--fg); margin: 0 0 16px; font-size: 22px; font-weight: 600; }
.expired-content p { color: var(--fg-muted); margin: 0 0 24px; font-size: 14px; line-height: 1.6; }
.expired-countdown { font-size: 13px; color: var(--fg-dim); font-variant-numeric: tabular-nums; }
.expired-countdown span { color: var(--warning); font-weight: 600; }

.error-banner {
  position: fixed; bottom: 64px; left: 50%; transform: translateX(-50%); z-index: 50;
  padding: 10px 20px; background: var(--timer-urgent-bg); color: var(--timer-urgent-fg);
  border-radius: var(--radius); font-size: 13px; font-weight: 500;
}

@media (max-width: 500px) {
  main { padding: 32px 16px 16px; }
  .hero-title { font-size: 28px; }
  .hero-desc { font-size: 13px; }
  .action-bar { padding: 10px 14px; }
  .action-shortcuts { display: none; }
  .result-card-header { padding: 12px 14px; }
  .expired-content { padding: 32px 24px; }
  .timer-badge { top: 12px; right: 16px; }
}
`;

const SCRIPT = `(function() {
  var DATA = __INLINE_DATA__;
  var token = DATA.sessionToken;
  var timeoutSec = DATA.timeout;
  var queries = DATA.queries;
  var submitted = false;
  var timerExpired = false;
  var searchesDone = false;
  var lastInteraction = Date.now();
  var completedCount = 0;
  var es = null;

  var timerEl = document.getElementById("timer");
  var timerAdjustEl = document.getElementById("timer-adjust");
  var timerInput = document.getElementById("timer-input");
  var timerSetBtn = document.getElementById("timer-set");
  var heroTitle = document.querySelector(".hero-title");
  var heroDesc = document.querySelector(".hero-desc");
  var resultCardsEl = document.getElementById("result-cards");
  var btnSendAll = document.getElementById("btn-send-all");
  var btnSend = document.getElementById("btn-send");
  var successOverlay = document.getElementById("success-overlay");
  var successText = document.getElementById("success-text");
  var expiredOverlay = document.getElementById("expired-overlay");
  var expiredText = document.getElementById("expired-text");
  var closeCountdown = document.getElementById("close-countdown");
  var errorBanner = document.getElementById("error-banner");
  var addSearchInput = document.getElementById("add-search-input");
  var addSearchEl = document.getElementById("add-search");
  var heroStatus = document.getElementById("hero-status");
  var globalProvider = document.getElementById("global-provider");

  function escHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function post(path, body) {
    return fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ token: token }, body)),
    });
  }

  function formatTime(sec) {
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function populateResultCard(card, data, queryText) {
    var sourceCount = data.results ? data.results.length : 0;
    var domains = [];
    if (data.results) {
      for (var i = 0; i < Math.min(data.results.length, 3); i++) {
        domains.push(data.results[i].domain);
      }
    }
    var metaText = sourceCount + " source" + (sourceCount !== 1 ? "s" : "");
    if (domains.length > 0) metaText += " \\u00B7 " + domains.join(", ");
    if (sourceCount > 3) metaText += ", +" + (sourceCount - 3);

    var preview = "";
    if (data.answer) {
      preview = data.answer.substring(0, 200).replace(/\\n+/g, " ").replace(/[#*_\\[\\]]/g, "");
    }

    var bodyHtml = "";
    if (data.answer) {
      var rendered = typeof marked !== "undefined" && marked.parse
        ? marked.parse(data.answer, { breaks: true })
        : '<p>' + escHtml(data.answer) + '</p>';
      bodyHtml += '<div class="result-card-answer">' + rendered + '</div>';
    }
    if (data.results && data.results.length > 0) {
      bodyHtml += '<div class="result-card-sources"><div class="result-card-sources-title">Sources</div>';
      for (var k = 0; k < data.results.length; k++) {
        var r = data.results[k];
        var label = r.title && r.title.indexOf("Source ") !== 0 ? r.title : r.url;
        bodyHtml += '<a class="source-link" href="' + escHtml(r.url) + '" target="_blank" rel="noopener">' + escHtml(label) + '<span class="source-domain">' + escHtml(r.domain) + '</span></a>';
      }
      bodyHtml += '</div>';
    }

    card.innerHTML =
      '<div class="result-card-header">' +
        '<input type="checkbox" checked>' +
        '<div class="result-card-info">' +
          '<div class="result-card-query">' + escHtml(queryText) + '</div>' +
          '<div class="result-card-meta">' + escHtml(metaText) + '</div>' +
          (preview ? '<div class="result-card-preview">' + escHtml(preview) + '</div>' : '') +
        '</div>' +
        '<div class="result-card-expand">\\u25BC</div>' +
      '</div>' +
      '<div class="result-card-body">' + bodyHtml + '</div>';
  }

  // ── Timer ──

  function resetTimer() { lastInteraction = Date.now(); }

  function updateTimer() {
    var idleSec = Math.floor((Date.now() - lastInteraction) / 1000);
    var remaining = Math.max(0, timeoutSec - idleSec);
    timerEl.textContent = formatTime(remaining);

    timerEl.classList.remove("warn", "urgent", "active");
    if (remaining <= 15) timerEl.classList.add("urgent");
    else if (remaining <= 30) timerEl.classList.add("warn");
    else if (remaining < timeoutSec) timerEl.classList.add("active");

    if (remaining <= 0 && !submitted && !timerExpired) onTimeout();
  }

  setInterval(updateTimer, 1000);
  updateTimer();

  ["click", "keydown", "input", "change"].forEach(function(evt) {
    document.addEventListener(evt, resetTimer, { passive: true });
  });
  document.addEventListener("scroll", resetTimer, { passive: true });
  document.addEventListener("mousemove", resetTimer, { passive: true });

  // ── Timer adjust ──

  timerEl.addEventListener("click", function(e) {
    e.stopPropagation();
    timerInput.value = timeoutSec;
    timerAdjustEl.classList.add("visible");
    timerEl.style.display = "none";
    timerInput.focus();
    timerInput.select();
  });

  function applyTimerAdjust() {
    var val = parseInt(timerInput.value, 10);
    if (val && val > 0) timeoutSec = Math.min(val, 600);
    timerAdjustEl.classList.remove("visible");
    timerEl.style.display = "";
    resetTimer();
  }

  timerSetBtn.addEventListener("click", function(e) { e.stopPropagation(); applyTimerAdjust(); });
  timerInput.addEventListener("keydown", function(e) {
    if (e.key === "Enter") { e.preventDefault(); applyTimerAdjust(); }
    if (e.key === "Escape") { timerAdjustEl.classList.remove("visible"); timerEl.style.display = ""; }
    e.stopPropagation();
  });
  document.addEventListener("click", function() {
    if (timerAdjustEl.classList.contains("visible")) {
      timerAdjustEl.classList.remove("visible");
      timerEl.style.display = "";
    }
  });

  // ── Provider ──

  if (globalProvider) {
    globalProvider.addEventListener("change", function() {
      post("/provider", { provider: globalProvider.value });
    });
  }

  // ── Add search ──

  addSearchInput.addEventListener("keydown", function(e) {
    if (e.key !== "Enter") return;
    var text = addSearchInput.value.trim();
    if (!text || submitted) return;
    e.preventDefault();
    e.stopPropagation();

    addSearchEl.classList.add("loading");
    addSearchInput.value = "";

    var card = document.createElement("div");
    card.className = "result-card searching";
    card.innerHTML =
      '<div class="result-card-header">' +
        '<input type="checkbox" checked disabled>' +
        '<div class="result-card-info">' +
          '<div class="result-card-query">' + escHtml(text) + '</div>' +
          '<div class="result-card-meta"><span class="searching-dots">Searching</span></div>' +
        '</div>' +
      '</div>';
    resultCardsEl.appendChild(card);
    resetTimer();

    post("/search", { query: text }).then(function(res) {
      return res.json();
    }).then(function(data) {
      addSearchEl.classList.remove("loading");
      if (!data.ok) { card.remove(); return; }

      card.dataset.qi = data.queryIndex;

      if (data.error) {
        card.classList.remove("searching");
        card.classList.add("error");
        card.innerHTML =
          '<div class="result-card-header">' +
            '<input type="checkbox" disabled>' +
            '<div class="result-card-info">' +
              '<div class="result-card-query">' + escHtml(text) + '</div>' +
              '<div class="result-card-meta" style="color:var(--timer-urgent-fg)">Failed</div>' +
            '</div>' +
          '</div>' +
          '<div class="result-card-error-msg">' + escHtml(data.error) + '</div>';
        return;
      }

      card.classList.remove("searching");
      card.classList.add("checked");
      completedCount++;

      populateResultCard(card, data, text);
      setupCardInteraction(card);
      updateSendButton();
      heroTitle.textContent = completedCount + " Search" + (completedCount !== 1 ? "es" : "") + " Complete";
      heroDesc.textContent = "Review the results and send what you want back to your agent.";
      if (heroStatus) heroStatus.textContent = completedCount + " completed";
      resetTimer();
    }).catch(function() {
      addSearchEl.classList.remove("loading");
      card.remove();
    });
  });

  // ── Overlays ──

  function showSuccess(text) {
    if (es) { es.close(); es = null; }
    successText.textContent = text;
    successOverlay.classList.remove("hidden");
    setTimeout(function() { window.close(); }, 800);
  }

  function showExpired(text) {
    if (es) { es.close(); es = null; }
    expiredText.textContent = text;
    expiredOverlay.classList.remove("hidden");
    requestAnimationFrame(function() { expiredOverlay.classList.add("visible"); });
  }

  function showError(text) {
    errorBanner.textContent = text;
    errorBanner.hidden = false;
  }

  function onTimeout() {
    if (submitted || timerExpired) return;
    timerExpired = true;
    submitted = true;
    showExpired("Time\\u2019s up \\u2014 sending all results to your agent.");
    post("/cancel", { reason: "timeout" });
    var count = 5;
    closeCountdown.textContent = count;
    var iv = setInterval(function() {
      count--;
      closeCountdown.textContent = count;
      if (count <= 0) { clearInterval(iv); window.close(); }
    }, 1000);
  }

  // ── Create placeholder cards for each query ──

  if (queries.length === 0) {
    heroTitle.textContent = "What do you need?";
    heroDesc.textContent = "Search for anything below. Results get sent back to your agent.";
    if (heroStatus) heroStatus.textContent = "";
    btnSend.textContent = "No results yet";
  } else {
    for (var i = 0; i < queries.length; i++) {
      var card = document.createElement("div");
      card.className = "result-card searching";
      card.dataset.qi = i;
      card.innerHTML =
        '<div class="result-card-header">' +
          '<input type="checkbox" checked disabled>' +
          '<div class="result-card-info">' +
            '<div class="result-card-query">' + escHtml(queries[i]) + '</div>' +
            '<div class="result-card-meta"><span class="searching-dots">Searching</span></div>' +
          '</div>' +
        '</div>';
      resultCardsEl.appendChild(card);
    }
  }

  // ── SSE ──

  es = new EventSource("/events?session=" + encodeURIComponent(token));

  es.addEventListener("result", function(e) {
    var data = JSON.parse(e.data);
    var card = resultCardsEl.querySelector('.result-card[data-qi="' + data.queryIndex + '"]');
    if (!card) return;

    card.classList.remove("searching");
    card.classList.add("checked");
    completedCount++;

    populateResultCard(card, data, data.query || queries[data.queryIndex]);
    setupCardInteraction(card);
    updateSendButton();
    resetTimer();
  });

  es.addEventListener("search-error", function(e) {
    var data = JSON.parse(e.data);
    var card = resultCardsEl.querySelector('.result-card[data-qi="' + data.queryIndex + '"]');
    if (!card) return;

    card.classList.remove("searching");
    card.classList.add("error");
    completedCount++;

    card.innerHTML =
      '<div class="result-card-header">' +
        '<input type="checkbox" disabled>' +
        '<div class="result-card-info">' +
          '<div class="result-card-query">' + escHtml(data.query || queries[data.queryIndex]) + '</div>' +
          '<div class="result-card-meta" style="color:var(--timer-urgent-fg)">Failed</div>' +
        '</div>' +
      '</div>' +
      '<div class="result-card-error-msg">' + escHtml(data.error || "Search failed") + '</div>';

    updateSendButton();
    resetTimer();
  });

  es.addEventListener("done", function() {
    searchesDone = true;
    if (completedCount > 0) {
      heroTitle.textContent = completedCount + " Search" + (completedCount !== 1 ? "es" : "") + " Complete";
      heroDesc.textContent = "Review the results and send what you want back to your agent.";
      if (heroStatus) heroStatus.textContent = completedCount + " completed";
    }
    updateSendButton();
    resetTimer();
  });

  es.onerror = function() {};

  // ── Card interaction ──

  function setupCardInteraction(card) {
    var header = card.querySelector(".result-card-header");
    var body = card.querySelector(".result-card-body");
    var cb = card.querySelector("input[type=checkbox]");
    var expandEl = card.querySelector(".result-card-expand");

    header.addEventListener("click", function(e) {
      if (e.target.tagName === "A") return;
      if (e.target === cb) {
        card.classList.toggle("checked", cb.checked);
        updateSendButton();
        return;
      }
      var isExpanded = body && body.classList.contains("open");
      if (body) body.classList.toggle("open");
      if (expandEl) expandEl.textContent = isExpanded ? "\\u25BC" : "\\u25B2";
    });

    if (body) {
      body.addEventListener("click", function(e) {
        e.stopPropagation();
      });
    }
  }

  // ── Send button ──

  function getSelectedIndices() {
    var indices = [];
    var cards = resultCardsEl.querySelectorAll(".result-card");
    cards.forEach(function(card) {
      var cb = card.querySelector("input[type=checkbox]");
      if (cb && cb.checked && !cb.disabled) {
        indices.push(parseInt(card.dataset.qi, 10));
      }
    });
    return indices;
  }

  function updateSendButton() {
    var sel = getSelectedIndices();
    var hasResults = completedCount > 0;
    btnSend.disabled = !hasResults || sel.length === 0;
    if (!hasResults) {
      btnSend.textContent = searchesDone ? "No results yet" : "Waiting for results\\u2026";
    } else {
      btnSend.textContent = "Send Selected (" + sel.length + ")";
    }
    btnSendAll.hidden = !searchesDone || !hasResults;
  }

  // ── Submit / Cancel ──

  function doSubmit(indices) {
    if (submitted) return;
    submitted = true;
    post("/submit", { selected: indices }).then(function(res) {
      if (!res.ok) throw new Error("submit failed");
      showSuccess("Results sent");
    }).catch(function() {
      submitted = false;
      showError("Failed to send \\u2014 the agent may have moved on");
    });
  }

  function doCancel() {
    if (submitted) return;
    submitted = true;
    post("/cancel", { reason: "user" }).then(function(res) {
      if (!res.ok) throw new Error("cancel failed");
      showSuccess("Skipped");
    }).catch(function() {
      submitted = false;
      showError("Failed \\u2014 the agent may have moved on");
    });
  }

  // ── Button handlers ──

  btnSend.addEventListener("click", function() {
    var sel = getSelectedIndices();
    if (sel.length > 0) doSubmit(sel);
  });

  btnSendAll.addEventListener("click", function() {
    var all = [];
    resultCardsEl.querySelectorAll(".result-card").forEach(function(card) {
      var cb = card.querySelector("input[type=checkbox]");
      if (cb && !cb.disabled) all.push(parseInt(card.dataset.qi, 10));
    });
    if (all.length > 0) doSubmit(all);
  });

  // ── Keyboard ──

  document.addEventListener("keydown", function(e) {
    if (submitted || timerExpired) return;
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;

    if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      var sel = getSelectedIndices();
      if (sel.length > 0) doSubmit(sel);
    } else if (e.key === "Escape") {
      e.preventDefault();
      doCancel();
    } else if (e.key === "a" && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      var boxes = resultCardsEl.querySelectorAll("input[type=checkbox]:not(:disabled)");
      var allChecked = true;
      boxes.forEach(function(cb) { if (!cb.checked) allChecked = false; });
      boxes.forEach(function(cb) {
        cb.checked = !allChecked;
        cb.closest(".result-card").classList.toggle("checked", cb.checked);
      });
      updateSendButton();
      resetTimer();
    }
  });

  // ── Heartbeat ──

  setInterval(function() {
    if (submitted) return;
    post("/heartbeat", {});
  }, 10000);

  // ── Focus add-search input when no initial queries ──

  if (queries.length === 0 && addSearchInput) {
    addSearchInput.focus();
  }
})();`;
