/**
 * Pi Sessions Provider
 *
 * Browse and preview pi agent sessions.
 * Preview renders conversation with styled pills and Markdown,
 * matching the session-switch extension style.
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Theme } from "@mariozechner/pi-coding-agent";
import { parseSessionEntries, getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import type { SessionEntry } from "@mariozechner/pi-coding-agent";
import { Markdown, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import type { TelescopeProvider } from "../types.js";
import { copyToClipboard } from "../clipboard.js";

const SESSION_BASE = join(process.env.HOME ?? "~", ".pi/agent/sessions");

// ── Types ────────────────────────────────────────────

interface SessionInfo {
	path: string;
	cwd: string;
	name?: string;
	firstMessage: string;
	modified: Date;
	messageCount: number;
}

interface MessageBlock {
	role: "user" | "assistant";
	text: string;
}

// ── Helpers ──────────────────────────────────────────

function relativeTime(date: Date): string {
	const diff = Date.now() - date.getTime();
	const minutes = Math.floor(diff / 60_000);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);
	if (days > 30) return `${Math.floor(days / 30)}mo ago`;
	if (days > 0) return `${days}d ago`;
	if (hours > 0) return `${hours}h ago`;
	if (minutes > 0) return `${minutes}m ago`;
	return "just now";
}

function padTo(s: string, w: number): string {
	const vis = visibleWidth(s);
	if (vis >= w) return truncateToWidth(s, w);
	return s + " ".repeat(w - vis);
}

// ── Session parsing ──────────────────────────────────

const sessionCache = new Map<string, { meta: SessionInfo; mtime: number }>();

function parseSession(filePath: string): SessionInfo | null {
	try {
		const stat = statSync(filePath);
		const cached = sessionCache.get(filePath);
		if (cached && cached.mtime === stat.mtimeMs) return cached.meta;

		const content = readFileSync(filePath, "utf-8");
		const lines = content.split("\n");

		let cwd = "";
		let name: string | undefined;
		let firstMessage = "";
		let messageCount = 0;

		for (const line of lines) {
			if (!line.trim()) continue;
			try {
				const entry = JSON.parse(line);
				if (entry.type === "session") cwd = entry.cwd ?? "";
				if (entry.type === "session_info" && entry.name) name = entry.name;
				if (entry.type === "message" && entry.message) {
					const msg = entry.message;
					if (msg.role === "user" || msg.role === "assistant") messageCount++;
					if (msg.role === "user" && !firstMessage) {
						if (typeof msg.content === "string") {
							firstMessage = msg.content;
						} else if (Array.isArray(msg.content)) {
							const textBlock = msg.content.find((b: any) => b.type === "text");
							if (textBlock) firstMessage = textBlock.text;
						}
					}
				}
			} catch {}
		}

		const meta: SessionInfo = {
			path: filePath,
			cwd,
			name,
			firstMessage: firstMessage.split("\n")[0]?.trim() ?? "(empty)",
			modified: stat.mtime,
			messageCount,
		};

		sessionCache.set(filePath, { meta, mtime: stat.mtimeMs });
		return meta;
	} catch {
		return null;
	}
}

function findSessionsFromFiles(): SessionInfo[] {
	if (!existsSync(SESSION_BASE)) return [];

	const results: SessionInfo[] = [];
	try {
		for (const dir of readdirSync(SESSION_BASE)) {
			const dirPath = join(SESSION_BASE, dir);
			try {
				if (!statSync(dirPath).isDirectory()) continue;
				for (const file of readdirSync(dirPath)) {
					if (!file.endsWith(".jsonl")) continue;
					const meta = parseSession(join(dirPath, file));
					if (meta && meta.messageCount > 0) results.push(meta);
				}
			} catch {}
		}
	} catch {}

	results.sort((a, b) => b.modified.getTime() - a.modified.getTime());
	return results;
}

function findSessions(): SessionInfo[] {
	return findSessionsFromFiles();
}

function searchSessions(query: string): SessionInfo[] {
	const trimmed = query.trim();
	if (!trimmed) return findSessions();

	const lower = trimmed.toLowerCase();
	return findSessionsFromFiles().filter((session) => {
		const text = `${session.name ?? ""} ${session.firstMessage} ${session.cwd}`.toLowerCase();
		return text.includes(lower);
	});
}

// ── Message extraction ───────────────────────────────

const messageCache = new Map<string, MessageBlock[]>();

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

function getMessageBlocks(sessionPath: string): MessageBlock[] {
	const cached = messageCache.get(sessionPath);
	if (cached) return cached;

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

		// Keep last N blocks for preview
		const maxBlocks = 50;
		const result = blocks.length > maxBlocks ? blocks.slice(blocks.length - maxBlocks) : blocks;
		messageCache.set(sessionPath, result);
		return result;
	} catch {
		return [];
	}
}

// ── Rich preview rendering ───────────────────────────

function buildRichPreview(session: SessionInfo, theme: Theme, maxLines: number): string[] {
	const th = theme;
	const w = 80; // reasonable default, telescope truncates to fit
	const lines: string[] = [];

	// ── Header ──
	const name = session.name || session.firstMessage.split("\n")[0]?.trim() || "(unnamed)";
	const msgs = `${session.messageCount} msg${session.messageCount !== 1 ? "s" : ""}`;
	const time = relativeTime(session.modified);
	const cwdShort = session.cwd.replace(process.env.HOME ?? "~", "~");

	lines.push(truncateToWidth(" " + th.fg("accent", th.bold(name)), w));
	lines.push(truncateToWidth(" " + th.fg("dim", `${msgs} · ${time} · ${cwdShort}`), w));
	lines.push(th.fg("border", " " + "─".repeat(Math.max(0, w - 2))));

	// ── Messages ──
	const blocks = getMessageBlocks(session.path);
	if (blocks.length === 0) {
		lines.push("");
		lines.push(th.fg("dim", "  (no messages)"));
		return lines.slice(0, maxLines);
	}

	let mdTheme: any;
	try {
		// pi >=0.80: getMarkdownTheme takes no arguments (uses the active theme).
		mdTheme = getMarkdownTheme();
	} catch {
		mdTheme = undefined;
	}

	let lastRole: string | undefined;

	for (const block of blocks) {
		if (lines.length >= maxLines) break;

		if (lines.length > 3) lines.push(""); // spacer between blocks

		if (block.role === "user") {
			const pill = th.bold(th.inverse(th.fg("accent", " USER ")));
			lines.push(" " + pill);

			// Render user message with background if possible
			try {
				const bgBlank = th.bg("userMessageBg", " ".repeat(w));
				lines.push(bgBlank);

				const md = new Markdown(block.text, 1, 0, mdTheme, {
					bgColor: (text: string) => th.bg("userMessageBg", text),
					color: (text: string) => th.fg("userMessageText", text),
				});
				const rendered = md.render(w);
				for (const line of rendered) {
					if (lines.length >= maxLines) break;
					lines.push(th.bg("userMessageBg", padTo(line, w)));
				}
				lines.push(bgBlank);
			} catch {
				// Fallback: plain text
				for (const textLine of block.text.split("\n").slice(0, 5)) {
					if (lines.length >= maxLines) break;
					lines.push("  " + th.fg("accent", textLine));
				}
			}
		} else {
			if (lastRole !== "assistant") {
				const pill = th.bold(th.inverse(th.fg("success", " AGENT ")));
				lines.push(" " + pill);
			}

			try {
				const md = new Markdown(block.text, 1, 0, mdTheme);
				const rendered = md.render(w);
				for (const line of rendered) {
					if (lines.length >= maxLines) break;
					lines.push(line);
				}
			} catch {
				// Fallback: plain text
				for (const textLine of block.text.split("\n").slice(0, 10)) {
					if (lines.length >= maxLines) break;
					lines.push("  " + textLine);
				}
			}
		}

		lastRole = block.role;
	}

	return lines.slice(0, maxLines);
}

/** Plain fallback preview (no theme available) */
function plainPreview(session: SessionInfo, maxLines: number): string[] {
	const lines: string[] = [];
	lines.push(`Session: ${session.name ?? "(unnamed)"}`);
	lines.push(`CWD: ${session.cwd}`);
	lines.push(`Messages: ${session.messageCount}`);
	lines.push(`Modified: ${session.modified.toLocaleString()}`);
	lines.push("");

	const blocks = getMessageBlocks(session.path);
	for (const block of blocks) {
		if (lines.length >= maxLines) break;
		const role = block.role === "user" ? "👤" : "🤖";
		const preview = block.text.split("\n")[0]?.slice(0, 100) ?? "";
		lines.push(`${role} ${preview}`);
	}

	return lines.slice(0, maxLines);
}

// ── Provider ─────────────────────────────────────────

export function createSessionsProvider(): TelescopeProvider<SessionInfo> {
	return {
		name: "sessions",
		icon: "💬",
		description: "Pi sessions",

		load() {
			return findSessions();
		},

		supportsDynamicSearch: true,

		async search(query) {
			return searchSessions(query);
		},

		getSearchText(item) {
			const label = item.name ?? item.firstMessage;
			return `${label} ${item.firstMessage} ${item.cwd} ${item.path}`;
		},

		getDisplayText(item, theme) {
			const label = item.name ?? item.firstMessage;
			const truncated = label.length > 50 ? label.slice(0, 49) + "…" : label;
			const cwdShort = item.cwd.replace(process.env.HOME ?? "~", "~");
			const time = theme.fg("dim", relativeTime(item.modified));
			const msgs = theme.fg("dim", `${item.messageCount}msg`);
			return `${truncated}  ${time} ${msgs}`;
		},

		async onSelect(item, ctx) {
			ctx.ui.setEditorText(`/resume ${item.path}`);
			setTimeout(() => process.stdin.emit("data", "\r"), 0);
		},

		getPreview(item, maxLines, theme) {
			if (theme) {
				return buildRichPreview(item, theme, maxLines);
			}
			return plainPreview(item, maxLines);
		},

		getFrecencyKey(item) {
			return item.path;
		},

		actions: [
			{ key: "c", label: "Copy path", description: "Copy session file path" },
		],

		onAction(actionKey, items) {
			if (actionKey === "c") {
				copyToClipboard(items.map((i) => i.path).join("\n"));
			}
		},
	};
}
