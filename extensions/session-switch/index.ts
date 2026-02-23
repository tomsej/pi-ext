/**
 * Session Switcher — split-panel session picker
 *
 * Uses Pi's native SessionSelectorComponent on the left (preserving ALL
 * controls: search, delete, rename, scope toggle, sort, name filter, etc.)
 * with a live conversation preview panel on the right.
 *
 * Rendered as a centered overlay (like leader-key, but much larger).
 */

import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext, SessionInfo, SessionEntry } from "@mariozechner/pi-coding-agent";
import { SessionManager, SessionSelectorComponent, parseSessionEntries, getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import { readFileSync } from "node:fs";

import type { Focusable } from "@mariozechner/pi-tui";
import { Markdown, truncateToWidth, visibleWidth, CURSOR_MARKER } from "@mariozechner/pi-tui";

// ─────────────────────────────────────────────────────────────────────────────
// Preview helpers
// ─────────────────────────────────────────────────────────────────────────────

/** A message block from the session */
interface MessageBlock {
	role: "user" | "assistant";
	text: string;
}

const previewCache = new Map<string, MessageBlock[]>();

function extractText(message: any): string {
	const content = message.content;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.filter((b: any) => b.type === "text")
			.map((b: any) => b.text)
			.join("\n");
	}
	return "";
}

function buildMessageBlocks(sessionPath: string): MessageBlock[] {
	try {
		const raw = readFileSync(sessionPath, "utf-8");
		const entries = parseSessionEntries(raw);
		const blocks: MessageBlock[] = [];

		for (const entry of entries) {
			if ((entry as any).type !== "message") continue;
			const msg = (entry as SessionEntry & { type: "message" }).message as any;
			if (!msg || (msg.role !== "user" && msg.role !== "assistant")) continue;

			const text = extractText(msg);
			if (!text.trim()) continue;

			blocks.push({ role: msg.role as "user" | "assistant", text: text.trim() });
		}

		// Keep last N messages
		const maxBlocks = 50;
		return blocks.length > maxBlocks ? blocks.slice(blocks.length - maxBlocks) : blocks;
	} catch {
		return [];
	}
}

function getMessageBlocks(path: string): MessageBlock[] {
	const cached = previewCache.get(path);
	if (cached) return cached;

	const blocks = buildMessageBlocks(path);
	previewCache.set(path, blocks);
	return blocks;
}

function relativeTime(date: Date): string {
	const diff = Date.now() - date.getTime();
	const minutes = Math.floor(diff / 60_000);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);
	if (days > 30) return `${Math.floor(days / 30)}mo`;
	if (days > 0) return `${days}d`;
	if (hours > 0) return `${hours}h`;
	if (minutes > 0) return `${minutes}m`;
	return "now";
}

/** Pad or truncate a (possibly ANSI-styled) string to exact visible width */
function padTo(s: string, w: number): string {
	const vis = visibleWidth(s);
	if (vis >= w) return truncateToWidth(s, w);
	return s + " ".repeat(w - vis);
}

// ─────────────────────────────────────────────────────────────────────────────
// Border-stripping helper
// ─────────────────────────────────────────────────────────────────────────────

/** Strip ANSI escapes to get visible text */
const ANSI_RE = /\x1b\[[0-9;]*m|\x1b_[^\x07]*\x07/g;

/** Detect DynamicBorder lines (just ─ repeated, possibly with ANSI) */
function isBorderLine(line: string): boolean {
	const stripped = line.replace(ANSI_RE, "").trim();
	return stripped.length > 0 && /^─+$/.test(stripped);
}

/**
 * Remove the top/bottom DynamicBorder lines (and their adjacent spacers)
 * that SessionSelectorComponent.buildBaseLayout() adds internally.
 */
function stripSelectorBorders(lines: string[]): string[] {
	// Strip border lines
	let result = lines.filter((l) => !isBorderLine(l));
	// Trim leading empty lines (spacers around removed border)
	while (result.length > 0 && result[0].trim() === "") result.shift();
	// Trim trailing empty lines
	while (result.length > 0 && result[result.length - 1].trim() === "") result.pop();
	return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Split overlay component
// ─────────────────────────────────────────────────────────────────────────────

class SplitOverlay implements Focusable {
	private selector: SessionSelectorComponent;
	private sessionByPath: Map<string, SessionInfo>;
	private getTermRows: () => number;
	private requestRender: () => void;
	private theme: any;
	private mdTheme: any;

	// Track selection to reset preview position
	private lastSelectedPath: string | undefined;

	// ── Focusable — delegate to selector for IME cursor support ──
	_focused = false;
	get focused(): boolean {
		return this._focused;
	}
	set focused(v: boolean) {
		this._focused = v;
		this.selector.focused = v;
	}

	constructor(opts: {
		selector: SessionSelectorComponent;
		sessionByPath: Map<string, SessionInfo>;
		getTermRows: () => number;
		requestRender: () => void;
		theme: any;
		mdTheme: any;
	}) {
		this.selector = opts.selector;
		this.sessionByPath = opts.sessionByPath;
		this.getTermRows = opts.getTermRows;
		this.requestRender = opts.requestRender;
		this.theme = opts.theme;
		this.mdTheme = opts.mdTheme;
	}

	handleInput(data: string): void {
		// All input goes to the native selector (search, nav, delete, rename, etc.)
		this.selector.handleInput(data);
		this.requestRender();
	}

	render(width: number): string[] {
		const th = this.theme;
		const termRows = this.getTermRows();

		// ── Outer frame dimensions ──
		const innerW = width - 2; // inside left/right border │
		const leftW = Math.max(25, Math.floor(innerW * 0.40));
		const rightW = innerW - leftW - 1; // -1 for center │

		// ── Render selector (strip internal DynamicBorder lines) ──
		const selectorLines = stripSelectorBorders(this.selector.render(leftW));

		// ── Determine total height ──
		const targetH = Math.max(selectorLines.length, Math.floor(termRows * 0.80));

		// ── Detect selection changes ──
		const selectedPath = this.selector.getSessionList().getSelectedSessionPath();
		if (selectedPath !== this.lastSelectedPath) {
			this.lastSelectedPath = selectedPath;
		}

		// ── Build right panel ──
		const rightLines = this.buildPreview(selectedPath, rightW, targetH);

		// ── Pad left panel to target height ──
		while (selectorLines.length < targetH) selectorLines.push("");

		// ── Assemble framed output ──
		const lines: string[] = [];

		// Top border
		lines.push(
			th.fg("border", "╭" + "─".repeat(leftW) + "┬" + "─".repeat(rightW) + "╮"),
		);

		// Content rows
		const sep = th.fg("border", "│");
		for (let i = 0; i < targetH; i++) {
			lines.push(
				sep +
				padTo(selectorLines[i] ?? "", leftW) +
				sep +
				padTo(rightLines[i] ?? "", rightW) +
				sep,
			);
		}

		// Bottom border
		lines.push(
			th.fg("border", "╰" + "─".repeat(leftW) + "┴" + "─".repeat(rightW) + "╯"),
		);

		return lines;
	}

	// ── Right panel: session info + conversation preview ─────────────────

	private buildPreview(selectedPath: string | undefined, w: number, h: number): string[] {
		const th = this.theme;

		if (!selectedPath) {
			return this.centeredMessage(th.fg("dim", "(no session selected)"), w, h);
		}

		const session = this.sessionByPath.get(selectedPath);
		const lines: string[] = [];

		// ── Header: session info ──
		if (session) {
			const name = session.name || session.firstMessage.split("\n")[0]?.trim() || "(unnamed)";
			const msgs = `${session.messageCount} msg${session.messageCount !== 1 ? "s" : ""}`;
			const time = relativeTime(session.modified);
			const cwd = session.cwd || "";

			lines.push(truncateToWidth(
				" " + th.fg("accent", th.bold(name)),
				w,
			));
			lines.push(truncateToWidth(
				" " + th.fg("dim", `${msgs} • ${time} • ${cwd}`),
				w,
			));
			lines.push(th.fg("border", " " + "─".repeat(Math.max(0, w - 2))));
		}

		// ── Preview content ──
		const blocks = getMessageBlocks(selectedPath);
		const headerH = lines.length;
		const contentH = h - headerH;

		if (blocks.length === 0) {
			const emptyLines = this.centeredMessage(th.fg("dim", "(no preview)"), w, contentH);
			lines.push(...emptyLines);
			return lines;
		}

		// Render all message blocks using Markdown components
		const allContentLines: string[] = [];
		let lastRole: string | undefined;

		for (const block of blocks) {
			// Spacer between messages
			if (allContentLines.length > 0) {
				allContentLines.push("");
			}

			if (block.role === "user") {
				// ── USER pill ── (accent color inverted for a bold colored background)
				const pill = th.bold(th.inverse(th.fg("accent", " USER ")));
				allContentLines.push(" " + pill);

				// User: full-width Markdown with userMessage bg/fg, extra vertical padding
				const bgBlank = th.bg("userMessageBg", " ".repeat(w));
				allContentLines.push(bgBlank); // top padding

				const md = new Markdown(block.text, 1, 0, this.mdTheme, {
					bgColor: (text: string) => th.bg("userMessageBg", text),
					color: (text: string) => th.fg("userMessageText", text),
				});
				const rendered = md.render(w);
				// Apply bg to the full width of each line
				for (const line of rendered) {
					const padded = padTo(line, w);
					allContentLines.push(th.bg("userMessageBg", padded));
				}

				allContentLines.push(bgBlank); // bottom padding
			} else {
				// Only show AGENT pill on first consecutive agent message
				if (lastRole !== "assistant") {
					const pill = th.bold(th.inverse(th.fg("success", " AGENT ")));
					allContentLines.push(" " + pill);
				}

				// Assistant: render with Markdown, no special background
				const md = new Markdown(block.text, 1, 0, this.mdTheme);
				const rendered = md.render(w);
				allContentLines.push(...rendered);
			}

			lastRole = block.role;
		}

		// Show from the top (beginning of conversation)
		for (let i = 0; i < contentH; i++) {
			if (i < allContentLines.length) {
				lines.push(truncateToWidth(allContentLines[i], w));
			} else {
				lines.push("");
			}
		}

		return lines;
	}

	private centeredMessage(msg: string, w: number, h: number): string[] {
		const mid = Math.floor(h / 2);
		const vis = visibleWidth(msg);
		const padLeft = Math.max(0, Math.floor((w - vis) / 2));

		return Array.from({ length: h }, (_, i) =>
			i === mid ? " ".repeat(padLeft) + msg : "",
		);
	}

	invalidate(): void {
		this.selector.invalidate();
	}

	dispose(): void {
		previewCache.clear();
		// SessionSelectorComponent extends Container which has no dispose(),
		// so use optional chaining to be safe.
		(this.selector as any).dispose?.();
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Exported runner (callable from leader-key or other extensions)
// ─────────────────────────────────────────────────────────────────────────────

export async function runSessionSwitch(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	if (!ctx.hasUI) return;

	// Set editor text to the command and simulate Enter to execute it
	ctx.ui.setEditorText("/switch-session");
	// Inject Enter keypress into stdin so the command auto-submits
	setTimeout(() => process.stdin.emit("data", "\r"), 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Extension
// ─────────────────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	pi.registerCommand("switch-session", {
		description: "Session picker with conversation preview (split panel)",
		handler: async (_args, ctx: ExtensionCommandContext) => {
			if (!ctx.hasUI) return;

			previewCache.clear();

			const currentCwd = ctx.cwd;
			const currentSessionFilePath = ctx.sessionManager.getSessionFile();

			const sessionByPath = new Map<string, SessionInfo>();
			const recordSessions = (sessions: SessionInfo[]) => {
				for (const session of sessions) {
					sessionByPath.set(session.path, session);
				}
			};

			const currentSessionsLoader = async (onProgress?: (loaded: number, total: number) => void) => {
				const sessions = await SessionManager.list(currentCwd, undefined, onProgress);
				recordSessions(sessions);
				return sessions;
			};

			const allSessionsLoader = async (onProgress?: (loaded: number, total: number) => void) => {
				const sessions = await SessionManager.listAll(onProgress);
				recordSessions(sessions);
				return sessions;
			};

			const selectedPath = await ctx.ui.custom<string | null>(
				(tui, theme, _kb, done) => {
					const selector = new SessionSelectorComponent(
						currentSessionsLoader,
						allSessionsLoader,
						(path) => done(path),
						() => done(null),
						() => done(null),
						() => tui.requestRender(),
						{
							showRenameHint: true,
							renameSession: async (sessionPath: string, newName: string | undefined) => {
								const name = (newName ?? "").trim();
								if (!name) return;

								if (currentSessionFilePath && sessionPath === currentSessionFilePath) {
									pi.setSessionName(name);
									return;
								}

								const mgr = SessionManager.open(sessionPath);
								mgr.appendSessionInfo(name);
							},
						},
						currentSessionFilePath,
					);

					// Show more sessions in the list (default is 10)
					const termRows = tui.terminal?.rows ?? 40;
					(selector.getSessionList() as any).maxVisible = Math.max(15, Math.floor(termRows * 0.6));

					return new SplitOverlay({
						selector,
						sessionByPath,
						getTermRows: () => tui.terminal?.rows ?? 40,
						requestRender: () => tui.requestRender(),
						theme,
						mdTheme: getMarkdownTheme(),
					});
				},
				{
					overlay: true,
					overlayOptions: {
						anchor: "center",
						width: "90%",
						minWidth: 80,
						maxHeight: "85%",
					},
				},
			);

			if (!selectedPath) return;

			const result = await ctx.switchSession(selectedPath);
			if (result.cancelled) {
				ctx.ui.notify("Session switch cancelled", "info");
			}
		},
	});
}
