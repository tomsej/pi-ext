/**
 * Favourite Models Picker
 *
 * Quick-switch to a favourite model with inline thinking level.
 * Favourites are configured in favourite-models.json (max 8 entries).
 *
 * Each entry specifies:
 *   - label:     display name shown in the picker
 *   - provider:  provider name (e.g. "anthropic", "google", "openai")
 *   - model:     model id
 *   - thinking:  (optional) default thinking level
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import { matchesKey, Key } from "@mariozechner/pi-tui";
import { OverlayFrame } from "../shared/overlay.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { ALL_THINKING_LEVELS, getCurrentThinkingLevel, setCurrentThinkingLevel } from "./model-switcher";
import { THINKING_ROLES } from "../shared/thinking-colors.js";

// ─────────────────────────────────────────────────────────────────────────────
// Config types
// ─────────────────────────────────────────────────────────────────────────────

interface FavouriteModelEntry {
	label: string;
	provider: string;
	model: string;
	thinking?: string;
}

const MAX_FAVOURITES = 8;

// ─────────────────────────────────────────────────────────────────────────────
// Load config
// ─────────────────────────────────────────────────────────────────────────────

function loadFavourites(): FavouriteModelEntry[] {
	const configPath = join(dirname(new URL(import.meta.url).pathname), "favourite-models.json");
	try {
		const raw = readFileSync(configPath, "utf-8");
		const parsed = JSON.parse(raw) as FavouriteModelEntry[];
		if (!Array.isArray(parsed)) {
			return [];
		}
		// Enforce max and validate
		return parsed
			.filter(
				(e) =>
					typeof e.label === "string" &&
					typeof e.provider === "string" &&
					typeof e.model === "string",
			)
			.slice(0, MAX_FAVOURITES);
	} catch {
		return [];
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Favourite Models Picker UI
// ─────────────────────────────────────────────────────────────────────────────

interface PickerResult {
	fav: FavouriteModelEntry;
	thinking: ThinkingLevel;
}

export async function runFavouriteModels(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	if (!ctx.hasUI) return;

	const favourites = loadFavourites();
	if (favourites.length === 0) {
		ctx.ui.notify("No favourite models configured. Edit favourite-models.json", "warning");
		return;
	}

	const currentModel = ctx.model;
	const currentThinking = getCurrentThinkingLevel(pi);

	// Build per-entry thinking indices
	const thinkingIndices: number[] = favourites.map((fav) => {
		const idx = fav.thinking ? ALL_THINKING_LEVELS.indexOf(fav.thinking as ThinkingLevel) : -1;
		return idx >= 0 ? idx : ALL_THINKING_LEVELS.indexOf(currentThinking);
	});

	const selected = await ctx.ui.custom<PickerResult | null>(
		(tui, theme, _kb, done) => {
			let highlightedIndex = 0;
			const th = theme;

			return {
				render: (width: number) => {
					const f = new OverlayFrame(width, th);
					const lines: string[] = [];

					lines.push(f.top());
					lines.push(f.row(th.fg("accent", th.bold("Favourite Models"))));
					lines.push(f.separator());

					for (let i = 0; i < favourites.length; i++) {
						const fav = favourites[i];
						const isHighlighted = i === highlightedIndex;

						const isCurrent =
							currentModel?.provider === fav.provider &&
							currentModel?.id === fav.model;

						const label = isHighlighted
							? th.fg("accent", th.bold(fav.label))
							: th.fg("text", fav.label);

						const providerTag = th.fg("dim", `(${fav.provider})`);
						const currentBadge = isCurrent ? " " + th.fg("success", "●") : "";

						const thinking = ALL_THINKING_LEVELS[thinkingIndices[i]];
						const thinkingRole = THINKING_ROLES[thinking] ?? "dim";
						const thinkingTag = isHighlighted
							? th.fg("dim", "‹") + th.fg(thinkingRole, ` ${thinking} `) + th.fg("dim", "›")
							: th.fg(thinkingRole, thinking);

						const num = th.fg("dim", `${i + 1}`);
						const line = `${isHighlighted ? "> " : "  "}${num} ${label} ${providerTag}${currentBadge}  ${thinkingTag}`;
						lines.push(f.rowTruncated(line));
					}

					lines.push(f.separator());
					lines.push(f.row(th.fg("dim", "j/k navigate | 1-8 jump | h/l thinking | enter select | esc cancel")));
					lines.push(f.bottom());

					return lines;
				},
				invalidate: () => {},
				handleInput: (data: string) => {
					if (matchesKey(data, "escape") || matchesKey(data, Key.ctrl("c"))) {
						done(null);
						return;
					}

					if (matchesKey(data, "backspace")) {
						done(null);
						return;
					}

					// Navigate: arrows + vim j/k
					if (matchesKey(data, "up") || matchesKey(data, Key.ctrl("p")) || data === "k") {
						highlightedIndex = Math.max(0, highlightedIndex - 1);
						tui.requestRender();
						return;
					}
					if (matchesKey(data, "down") || matchesKey(data, Key.ctrl("n")) || data === "j") {
						highlightedIndex = Math.min(favourites.length - 1, highlightedIndex + 1);
						tui.requestRender();
						return;
					}

					// Thinking: arrows + vim h/l
					if (matchesKey(data, "left") || data === "h") {
						thinkingIndices[highlightedIndex] = (thinkingIndices[highlightedIndex] - 1 + ALL_THINKING_LEVELS.length) % ALL_THINKING_LEVELS.length;
						tui.requestRender();
						return;
					}
					if (matchesKey(data, "right") || data === "l") {
						thinkingIndices[highlightedIndex] = (thinkingIndices[highlightedIndex] + 1) % ALL_THINKING_LEVELS.length;
						tui.requestRender();
						return;
					}

					// Number keys 1-8: jump to entry
					const num = parseInt(data, 10);
					if (num >= 1 && num <= favourites.length) {
						highlightedIndex = num - 1;
						tui.requestRender();
						return;
					}

					// Enter: select highlighted
					if (matchesKey(data, "enter")) {
						if (highlightedIndex >= 0 && highlightedIndex < favourites.length) {
							done({
								fav: favourites[highlightedIndex],
								thinking: ALL_THINKING_LEVELS[thinkingIndices[highlightedIndex]],
							});
						}
						return;
					}
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

	if (!selected) return;

	const modelInfo = ctx.modelRegistry.find(selected.fav.provider, selected.fav.model);
	if (!modelInfo) {
		ctx.ui.notify(`Model ${selected.fav.provider}/${selected.fav.model} not found in registry`, "error");
		return;
	}

	const ok = await pi.setModel(modelInfo);
	if (!ok) {
		ctx.ui.notify(`No API key available for ${selected.fav.provider}/${selected.fav.model}`, "warning");
		return;
	}
	setCurrentThinkingLevel(pi, selected.thinking);

	ctx.ui.notify(
		`Switched to ${selected.fav.label} (thinking: ${selected.thinking})`,
		"info",
	);
}
