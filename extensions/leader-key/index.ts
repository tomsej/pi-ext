/**
 * Leader Key Extension
 *
 * Press Ctrl+X to open a floating command palette showing all available
 * actions organised into groups (like Vim's which-key or Emacs' leader key).
 *
 * Each group has a single-character chord key. Press the chord to see the
 * group's actions, then press the action key to execute.
 *
 * Navigation:
 *   - Chord keys shown in the palette (e.g. "s" for Session, "m" for Model)
 *   - Backspace / Escape to go back or close
 *   - Direct key press executes the action immediately
 *
 * The palette auto-discovers extension commands and merges them with
 * built-in actions (session, model, etc.).
 */

import type {
	ExtensionAPI,
	ExtensionContext,
	Theme,
} from "@mariozechner/pi-coding-agent";
import { matchesKey, parseKey, Key } from "@mariozechner/pi-tui";
import { runFavouriteModels } from "./favourite-models.js";
import { OverlayFrame } from "../shared/overlay.js";
import type { ActionItem, ActionGroup, TopLevelEntry } from "./types.js";
import { buildWorkflowEntries } from "./workflow-actions.js";

// ─────────────────────────────────────────────────────────────────────────────
// Build top-level entries
// ─────────────────────────────────────────────────────────────────────────────

function runCommand(ctx: ExtensionContext, command: string) {
	ctx.ui.setEditorText(command);
	setTimeout(() => process.stdin.emit("data", "\r"), 0);
}

export function buildEntries(
	pi: ExtensionAPI,
	openFavouriteModels: (ctx: ExtensionContext) => Promise<void>,
): TopLevelEntry[] {
	return [
		{
			type: "action",
			key: "m",
			label: "Models",
			description: "switch scoped model",
			action: openFavouriteModels,
		},
		buildWorkflowEntries(pi),
		{
			type: "group",
			group: {
				key: "p",
				label: "Plannotator",
				items: [
					{
						key: "a",
						label: "Annotate last",
						description: "annotate last assistant message",
						action: (ctx) => runCommand(ctx, "/plannotator-last"),
					},
					{
						key: "r",
						label: "Review changes",
						description: "review current code changes",
						action: (ctx) => runCommand(ctx, "/plannotator-review"),
					},
					{
						key: "f",
						label: "Annotate file",
						description: "file, folder, or URL",
						action: async (ctx) => {
							const path = await ctx.ui.input("Annotate file, folder, or URL", "path or URL");
							if (path?.trim()) runCommand(ctx, `/plannotator-annotate ${path.trim()}`);
						},
					},
				],
			},
		},
		{
			type: "action",
			key: "t",
			label: "Tree",
			description: "open native session tree",
			action: (ctx) => runCommand(ctx, "/tree"),
		},
		{
			type: "action",
			key: "q",
			label: "Quit",
			description: "quit pi",
			action: (ctx) => ctx.shutdown(),
		},
	];
}

// ─────────────────────────────────────────────────────────────────────────────
// Overlay component
// ─────────────────────────────────────────────────────────────────────────────

type View = { type: "root" } | { type: "group"; group: ActionGroup };

class LeaderKeyOverlay {
	private view: View = { type: "root" };
	private entries: TopLevelEntry[];
	private theme: Theme;
	private done: (result: ActionItem | null) => void;
	private highlightedIndex = 0;

	constructor(
		entries: TopLevelEntry[],
		theme: Theme,
		done: (result: ActionItem | null) => void,
	) {
		this.entries = entries;
		this.theme = theme;
		this.done = done;
	}

	private get currentItems(): Array<{ key: string; label: string; description?: string }> {
		if (this.view.type === "root") {
			return this.entries.map((e) => {
				if (e.type === "group") {
					return {
						key: e.group.key,
						label: e.group.label,
						description: `${e.group.items.length} action${e.group.items.length !== 1 ? "s" : ""}`,
					};
				}
				return {
					key: e.key,
					label: e.label,
					description: e.description,
				};
			});
		}
		return this.view.group.items;
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, Key.ctrl("c"))) {
			if (this.view.type === "group") {
				this.view = { type: "root" };
				this.highlightedIndex = 0;
			} else {
				this.done(null);
			}
			return;
		}

		if (matchesKey(data, "backspace")) {
			if (this.view.type === "group") {
				this.view = { type: "root" };
				this.highlightedIndex = 0;
			} else {
				this.done(null);
			}
			return;
		}

		// Arrow keys for highlighting
		if (matchesKey(data, "up")) {
			this.highlightedIndex = Math.max(0, this.highlightedIndex - 1);
			return;
		}
		if (matchesKey(data, "down")) {
			const items = this.currentItems;
			this.highlightedIndex = Math.min(items.length - 1, this.highlightedIndex + 1);
			return;
		}

		// Enter to select highlighted item
		if (matchesKey(data, "enter") || matchesKey(data, "return")) {
			const items = this.currentItems;
			if (this.highlightedIndex >= 0 && this.highlightedIndex < items.length) {
				const item = items[this.highlightedIndex];
				if (this.view.type === "root") {
					this.handleRootSelection(item.key);
				} else {
					const action = this.view.group.items.find((a) => a.key === item.key);
					if (action) {
						this.done(action);
					}
				}
			}
			return;
		}

		// Direct key press — use parseKey to handle both raw chars and Kitty protocol sequences
		const parsed = parseKey(data);
		if (parsed && parsed.length === 1 && parsed >= "a" && parsed <= "z") {
			const key = parsed.toLowerCase();

			if (this.view.type === "root") {
				this.handleRootSelection(key);
			} else {
				const action = this.view.group.items.find((a) => a.key === key);
				if (action) {
					this.done(action);
				}
			}
		} else if (data.length === 1 && data >= " " && data <= "~") {
			// Fallback for raw printable characters (legacy terminals)
			const key = data.toLowerCase();

			if (this.view.type === "root") {
				this.handleRootSelection(key);
			} else {
				const action = this.view.group.items.find((a) => a.key === key);
				if (action) {
					this.done(action);
				}
			}
		}
	}

	private handleRootSelection(key: string): void {
		const entry = this.entries.find((e) => {
			if (e.type === "group") return e.group.key === key;
			return e.key === key;
		});
		if (!entry) return;

		if (entry.type === "group") {
			this.view = { type: "group", group: entry.group };
			this.highlightedIndex = 0;
		} else {
			// Direct action — wrap it as an ActionItem and fire
			this.done({
				key: entry.key,
				label: entry.label,
				description: entry.description,
				action: entry.action,
			});
		}
	}

	render(width: number): string[] {
		const th = this.theme;
		const f = new OverlayFrame(width, th);
		const lines: string[] = [];

		// Header
		lines.push(f.top());

		if (this.view.type === "root") {
			lines.push(f.row(th.fg("accent", th.bold("Leader Key"))));
		} else {
			const g = this.view.group;
			const breadcrumb = th.fg("dim", "< ") + th.fg("accent", th.bold(g.label));
			lines.push(f.row(breadcrumb));
		}

		lines.push(f.separator());

		// Items
		const items = this.currentItems;
		if (items.length === 0) {
			lines.push(f.row(th.fg("muted", "  (no items)")));
		} else {
			for (let i = 0; i < items.length; i++) {
				const item = items[i];
				const isHighlighted = i === this.highlightedIndex;

				const keyBadge = th.fg("warning", th.bold(`[${item.key}]`));
				const label = isHighlighted
					? th.fg("accent", th.bold(item.label))
					: th.fg("text", item.label);

				// Show a chevron for groups in root view
				let suffix = "";
				if (this.view.type === "root") {
					const entry = this.entries.find((e) => {
						if (e.type === "group") return e.group.key === item.key;
						return e.key === item.key;
					});
					if (entry?.type === "group") {
						suffix = " " + th.fg("dim", ">");
					}
				}

				let line = `${isHighlighted ? "> " : "  "}${keyBadge} ${label}${suffix}`;

				if (item.description) {
					line += "  " + th.fg("dim", item.description);
				}

				lines.push(f.rowTruncated(line));
			}
		}

		// Footer
		lines.push(f.separator());

		if (this.view.type === "root") {
			lines.push(f.row(th.fg("dim", "press key to select | esc close")));
		} else {
			lines.push(f.row(th.fg("dim", "press key to run | bksp back | esc close")));
		}

		lines.push(f.bottom());

		return lines;
	}

	invalidate(): void {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Extension
// ─────────────────────────────────────────────────────────────────────────────

export default function leaderKeyExtension(pi: ExtensionAPI) {
	let stopFavouriteModelsShortcut: (() => void) | undefined;
	let favouriteModelsOpen = false;

	async function openFavouriteModels(ctx: ExtensionContext) {
		if (!ctx.hasUI || favouriteModelsOpen) return;

		favouriteModelsOpen = true;
		try {
			await runFavouriteModels(pi, ctx);
		} finally {
			favouriteModelsOpen = false;
		}
	}

	async function openLeaderKey(ctx: ExtensionContext) {
		if (!ctx.hasUI) return;

		const entries = buildEntries(pi, openFavouriteModels);

		const selected = await ctx.ui.custom<ActionItem | null>(
			(tui, theme, _kb, done) => {
				const overlay = new LeaderKeyOverlay(entries, theme, done);
				return {
					render: (w: number) => overlay.render(w),
					invalidate: () => overlay.invalidate(),
					handleInput: (data: string) => {
						overlay.handleInput(data);
						tui.requestRender();
					},
				};
			},
			{
				overlay: true,
				overlayOptions: {
					anchor: "center",
					width: 80,
					minWidth: 50,
					maxHeight: "80%",
				},
			},
		);

		if (selected) {
			try {
				await selected.action(ctx);
			} catch (err) {
				const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
				ctx.ui.notify(`Action failed: ${detail}`, "error");
			}
		}
	}

	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;

		stopFavouriteModelsShortcut?.();
		stopFavouriteModelsShortcut = ctx.ui.onTerminalInput((data) => {
			if (parseKey(data) !== Key.ctrl("m")) return;
			void openFavouriteModels(ctx);
			return { consume: true };
		});
	});

	pi.on("session_shutdown", async () => {
		stopFavouriteModelsShortcut?.();
		stopFavouriteModelsShortcut = undefined;
	});

	// Register as a command
	pi.registerCommand("lk", {
		description: "Open Leader Key palette",
		handler: async (_args, ctx) => {
			await openLeaderKey(ctx);
		},
	});

	// Register shortcut: Ctrl+X
	pi.registerShortcut(Key.ctrl("x"), {
		description: "Open Leader Key",
		handler: async (ctx) => {
			await openLeaderKey(ctx);
		},
	});
}
