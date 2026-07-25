/**
 * Custom Footer Extension — Two-line compact powerline style
 *
 * Line 1:  MODE  ~/path (branch) │ 42%/200k │ ⚡ model • thinking
 * Line 2: Provider  S ████████ 23%  ⟳ 2h 14m  W ██████░░ 67%  ⟳ 3d 5h
 *
 * Rendered as a belowEditor widget (not setFooter) so sub-bar appears below us.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { PermissionMode } from "../permissions/permissions.js";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { formatDuration } from "../worktime/worktime-core.mjs";
import { execSync } from "node:child_process";
import { existsSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import {
	buildPathString,
	fmtTokens,
	modePillWidth,
	renderContextUsage,
	renderModelInfo,
	renderModePill,
	renderPath,
} from "./renderers.js";



// ── Helpers ────────────────────────────────────────────────────────────

/** Statuses we never want to show. */
const HIDDEN_STATUS_KEYS = new Set(["ponytail"]);

/**
 * Extension statuses (subagents / workflows / summaries) as widget lines, in their
 * original wording. Sorted by key because Map order shifts on clear+set.
 */
export function statusLines(statuses: Iterable<[string, string]>, width: number): string[] {
	return Array.from(statuses)
		.filter(([key]) => !HIDDEN_STATUS_KEYS.has(key))
		.sort(([a], [b]) => a.localeCompare(b))
		.flatMap(([, text]) => text.split(/[\r\n]/))
		.filter((line) => line.trim() !== "")
		.map((line) => truncateToWidth(line, width));
}

function getGitBranch(cwd: string): string | null {
	try {
		return execSync("git branch --show-current", { cwd, encoding: "utf-8", timeout: 500 }).trim() || null;
	} catch {
		return null;
	}
}

// ── Extension ──────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	let currentMode: PermissionMode = "safe";
	let tuiRef: { requestRender(): void } | null = null;
	let workedMs = 0;
	// Captured from the footer factory — the only way an extension can read
	// statuses set by other extensions via ctx.ui.setStatus().
	let statuses: (() => ReadonlyMap<string, string>) | null = null;

	pi.events.on("worktime:update", (data: unknown) => {
		workedMs = (data as { ms?: number })?.ms ?? 0;
		tuiRef?.requestRender();
	});
	let gitBranch: string | null = null;
	let gitWatcher: FSWatcher | undefined;

	pi.events.on("mode:change", (data: unknown) => {
		currentMode = data as PermissionMode;
		tuiRef?.requestRender();
	});

	pi.on("session_start", async (_event, ctx) => {
		// Get initial git branch
		gitBranch = getGitBranch(ctx.cwd);

		// Watch .git/HEAD for branch changes
		const headPath = join(ctx.cwd, ".git", "HEAD");
		if (existsSync(headPath)) {
			gitWatcher = watch(headPath, () => {
				gitBranch = getGitBranch(ctx.cwd);
				tuiRef?.requestRender();
			});
		}

		// Render as a belowEditor widget — no setFooter, so no divider line
		const setWidgetFn = ctx.ui.setWidget.bind(ctx.ui) as (
			name: string,
			content: unknown,
			options?: { placement?: string },
		) => void;

		setWidgetFn(
			"custom-footer",
			(_widgetTui: { requestRender(): void }, widgetTheme: any) => {
				tuiRef = _widgetTui;
				return {
					render(width: number): string[] {
						return [
							renderLine1(width, widgetTheme, ctx),
						];
					},
					invalidate() {},
				};
			},
			{ placement: "belowEditor" },
		);

		// Extension statuses (subagents / workflows) above the editor, next to the
		// background-terminals widget instead of at the very bottom.
		setWidgetFn("extension-statuses", (_widgetTui: unknown) => ({
			render(width: number): string[] {
				return statuses ? statusLines(statuses(), width) : [];
			},
			invalidate() {},
		}));

		// Suppress default pi footer (empty render); it only serves to hand us the
		// status provider.
		ctx.ui.setFooter((_tui, _theme, footerData) => {
			statuses = () => footerData.getExtensionStatuses();
			return {
				render() {
					return [];
				},
				invalidate() {},
			};
		});
	});

	pi.on("session_shutdown", async () => {
		gitWatcher?.close();
	});

	// ── Line 1: Mode │ Path │ Context │ Model ──────────────────────────

	function renderLine1(
		width: number,
		theme: { fg: (role: any, text: string) => string; bold: (text: string) => string; inverse: (text: string) => string; bg: (role: any, text: string) => string },
		ctx: { getContextUsage(): { percent: number | null; contextWindow: number } | null | undefined; model: { provider?: string; id?: string; contextWindow?: number } | null | undefined },
	): string {
		const sep = theme.fg("dim", " │ ");
		const sepW = 3;

		// Mode pill
		const pill = renderModePill(currentMode, theme);
		const pillW = modePillWidth(currentMode);

		// Path + branch
		const pathRaw = buildPathString(process.cwd(), gitBranch);

		// Context usage
		const usage = ctx.getContextUsage();
		const pct = usage?.percent ?? 0;
		const win = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
		const ctxRaw = `${pct.toFixed(0)}%/${fmtTokens(win)}`;
		const ctxColored = renderContextUsage(pct, win, theme);

		// Model + thinking
		const provider = ctx.model?.provider || "unknown";
		const modelName = ctx.model?.id || "no-model";
		const thinking = pi.getThinkingLevel();
		const model = renderModelInfo(modelName, provider, thinking, theme);

		// Worktime, appended inline after model/thinking: "… • high • ⏱ 21m 50s"
		const workedStr = `⏱ ${formatDuration(workedMs)}`;
		const workedText = theme.fg("dim", " • ") + theme.fg("dim", workedStr);
		const workedRawWidth = visibleWidth(` • ${workedStr}`);

		// Layout: compute path budget from remaining space
		const rightBlockWidth = visibleWidth(ctxRaw) + sepW + model.rawWidth + workedRawWidth;
		const pathBudget = width - pillW - sepW - rightBlockWidth - sepW;
		const pathDisplay = renderPath(pathRaw, pathBudget, theme);

		// Assemble
		const segments: string[] = [pill];
		if (pathDisplay) segments.push(pathDisplay);
		segments.push(ctxColored);
		segments.push(model.text + workedText);

		return truncateToWidth(segments.join(sep), width);
	}


}
