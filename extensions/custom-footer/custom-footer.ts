/**
 * Custom Footer Extension — Single-line compact powerline style
 *
 * ~/path (branch) │ ↑in ↓out $cost │ 42%/200k │ ⚡ model • thinking
 * [gold]  [dim]       [dim]       [color ctx]  [accent]
 */

import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

function fmtTokens(n: number): string {
	if (n < 1000) return n.toString();
	if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
	if (n < 1000000) return `${Math.round(n / 1000)}k`;
	return `${(n / 1000000).toFixed(1)}M`;
}

// Catppuccin Mocha Yellow — #f9e2af
const gold = (s: string) => `\x1b[38;2;249;226;175m${s}\x1b[0m`;

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		ctx.ui.setFooter((tui, theme, footerData) => {
			const unsub = footerData.onBranchChange(() => tui.requestRender());

			return {
				dispose: unsub,
				invalidate() {},
				render(width: number): string[] {
					const sep = theme.fg("dim", " │ ");
					const sepWidth = 3; // " │ "

					// ── Segment 1: path (branch) ───────────────────────────
					let pwd = process.cwd();
					const home = process.env.HOME || process.env.USERPROFILE;
					if (home && pwd.startsWith(home)) pwd = `~${pwd.slice(home.length)}`;
					const branch = footerData.getGitBranch();
					const pathRaw = pwd + (branch ? ` (${branch})` : "");

					// ── Segment 2: token stats ──────────────────────────────
					let totalIn = 0,
						totalOut = 0,
						totalCost = 0;
					for (const e of ctx.sessionManager.getBranch()) {
						if (e.type === "message" && e.message.role === "assistant") {
							const m = e.message as AssistantMessage;
							totalIn += m.usage.input;
							totalOut += m.usage.output;
							totalCost += m.usage.cost.total;
						}
					}
					const statsParts: string[] = [];
					if (totalIn || totalOut) {
						statsParts.push(`↑${fmtTokens(totalIn)}`);
						statsParts.push(`↓${fmtTokens(totalOut)}`);
					}
					if (totalCost) statsParts.push(`$${totalCost.toFixed(2)}`);
					const statsRaw = statsParts.join(" ");

					// ── Segment 3: context % ────────────────────────────────
					const usage = ctx.getContextUsage();
					const pct = usage?.percent ?? 0;
					const win = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
					const ctxRaw = `${pct.toFixed(0)}%/${fmtTokens(win)}`;

					// ── Segment 4: (provider) model + thinking ──────────────
					const provider = ctx.model?.provider || "unknown";
					const modelName = ctx.model?.id || "no-model";
					const thinking = pi.getThinkingLevel();
					const thinkSuffix = thinking !== "off" ? ` • ${thinking}` : "";
					const modelRaw = `⚡ ${modelName} (${provider})${thinkSuffix}`;

					// ── Assemble: figure out what fits ──────────────────────
					// Always show: path | ctx | model. Stats only if room.
					const fixedRight = ctxRaw + modelRaw;
					const fixedRightWidth = visibleWidth(fixedRight);
					const sepsNeeded = statsRaw ? 3 : 2; // number of separators
					const sepsWidth = sepsNeeded * sepWidth;

					// Available width for path after reserving right segments
					const rightBlockWidth = (statsRaw ? visibleWidth(statsRaw) + sepWidth : 0)
						+ visibleWidth(ctxRaw) + sepWidth + visibleWidth(modelRaw);
					const pathBudget = width - rightBlockWidth - sepWidth; // -sepWidth for first separator

					let pathDisplay: string;
					if (pathBudget >= 10) {
						// Enough room for path
						if (visibleWidth(pathRaw) <= pathBudget) {
							pathDisplay = gold(pathRaw);
						} else {
							// Truncate from the left: …ail/path (branch)
							const truncated = "…" + pathRaw.slice(-(pathBudget - 1));
							pathDisplay = gold(truncated);
						}
					} else {
						// Very narrow — skip path entirely
						pathDisplay = "";
					}

					// Context coloring
					let ctxColored: string;
					if (pct > 90) ctxColored = theme.fg("error", ctxRaw);
					else if (pct > 70) ctxColored = theme.fg("warning", ctxRaw);
					else ctxColored = theme.fg("success", ctxRaw);

					// Thinking level coloring — semaphore, hardcoded to decouple from border
					const thinkingColors: Record<string, string> = {
						off:     "\x1b[38;2;51;45;62m",   // surface1 — invisible
						minimal: "\x1b[38;2;67;61;78m",   // surface2 — barely there
						low:     "\x1b[38;2;166;227;161m", // green
						medium:  "\x1b[38;2;249;226;175m", // yellow
						high:    "\x1b[38;2;250;179;135m", // peach
						xhigh:   "\x1b[38;2;243;139;168m", // red
					};
					const thinkAnsi = thinkingColors[thinking] ?? thinkingColors.off;
					let modelColored = theme.fg("accent", `⚡ ${modelName}`) + theme.fg("muted", ` (${provider})`);
					if (thinking !== "off") {
						modelColored += theme.fg("dim", " • ") + `${thinkAnsi}${thinking}\x1b[0m`;
					}

					// Blue (#89B4FA) for token stats
					const blue = (s: string) => `\x1b[38;2;137;180;250m${s}\x1b[0m`;
					const statsColored = statsRaw ? blue(statsRaw) : "";

					// Build the line
					const segments: string[] = [];
					if (pathDisplay) segments.push(pathDisplay);
					if (statsColored) segments.push(statsColored);
					segments.push(ctxColored);
					segments.push(modelColored);

					const joined = segments.join(sep);
					return [truncateToWidth(joined, width)];
				},
			};
		});
	});
}
