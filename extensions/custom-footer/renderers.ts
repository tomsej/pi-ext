/**
 * Pure rendering helpers for the custom footer.
 *
 * Each function produces a styled string segment — no side effects.
 * All colors are resolved via theme roles (no hardcoded ANSI).
 */

import { visibleWidth } from "@mariozechner/pi-tui";
import { THINKING_ROLES } from "../shared/thinking-colors.js";

type ThemeFg = { fg: (role: any, text: string) => string };

// ── Tokens ─────────────────────────────────────────────────────────────

export function fmtTokens(n: number): string {
	if (n < 1000) return n.toString();
	if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
	if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
	return `${(n / 1_000_000).toFixed(1)}M`;
}

// ── Path ───────────────────────────────────────────────────────────────

export function renderPath(
	pathRaw: string,
	budget: number,
	theme: ThemeFg,
): string {
	if (budget < 10) return "";
	if (visibleWidth(pathRaw) <= budget) return theme.fg("warning", pathRaw);
	return theme.fg("warning", "…" + pathRaw.slice(-(budget - 1)));
}

export function buildPathString(cwd: string, branch: string | null): string {
	let pwd = cwd;
	const home = process.env.HOME || process.env.USERPROFILE;
	if (home && pwd.startsWith(home)) pwd = `~${pwd.slice(home.length)}`;
	return pwd + (branch ? ` (${branch})` : "");
}

// ── Context Usage ──────────────────────────────────────────────────────

export function renderContextUsage(
	pct: number,
	win: number,
	theme: { fg: (role: any, text: string) => string },
): string {
	const raw = `${pct.toFixed(0)}%/${fmtTokens(win)}`;
	if (pct > 90) return theme.fg("error", raw);
	if (pct > 70) return theme.fg("warning", raw);
	return theme.fg("success", raw);
}

// ── Model + Thinking ───────────────────────────────────────────────────

export function renderModelInfo(
	modelName: string,
	provider: string,
	thinking: string,
	theme: ThemeFg,
): { text: string; rawWidth: number } {
	const thinkSuffix = thinking !== "off" ? ` • ${thinking}` : "";
	const rawWidth = visibleWidth(`⚡ ${modelName} (${provider})${thinkSuffix}`);

	let text = theme.fg("accent", `⚡ ${modelName}`) + theme.fg("muted", ` (${provider})`);
	if (thinking !== "off") {
		const role = THINKING_ROLES[thinking] ?? THINKING_ROLES.off;
		text += theme.fg("dim", " • ") + theme.fg(role, thinking);
	}

	return { text, rawWidth };
}

// ── Usage Bars (Line 2) ───────────────────────────────────────────────

export function clampPct(v: number): number {
	return Math.max(0, Math.min(100, Math.round(v)));
}

type ThemeRole = "success" | "warning" | "error";
function colorForPct(v: number): ThemeRole {
	return v >= 90 ? "error" : v >= 70 ? "warning" : "success";
}

const BAR_WIDTH = 8;

export function renderBar(
	pct: number,
	theme: { fg: (role: any, text: string) => string },
): string {
	const v = clampPct(pct);
	const filled = Math.round((v / 100) * BAR_WIDTH);
	return theme.fg(colorForPct(v), "█".repeat(filled))
		+ theme.fg("dim", "░".repeat(BAR_WIDTH - filled));
}

export function renderPct(
	pct: number,
	theme: { fg: (role: any, text: string) => string },
): string {
	const v = clampPct(pct);
	return theme.fg(colorForPct(v), `${v}%`.padStart(4));
}
