/**
 * Model Switcher (embedded in leader-key)
 *
 * A multi-step model selector with searchable lists:
 *   1. Pick a provider (searchable)
 *   2. Pick a model from that provider (searchable)
 *   3. Pick a thinking level (searchable)
 *
 * Exported for use by the leader-key extension.
 */

import type { ExtensionAPI, ExtensionContext, ThinkingLevel } from "@mariozechner/pi-coding-agent";
import { SettingsManager } from "@mariozechner/pi-coding-agent";
import { fuzzyFilter, Key, matchesKey, visibleWidth, truncateToWidth } from "@mariozechner/pi-tui";

export const ALL_THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — only enabled & available providers & models
// ─────────────────────────────────────────────────────────────────────────────

interface ProviderInfo {
	name: string;
	modelCount: number;
}

/**
 * Get the set of enabled model identifiers from settings.
 * Returns undefined when there is no filter (all models are enabled).
 */
function getEnabledModelSet(): Set<string> | undefined {
	const sm = SettingsManager.create();
	const patterns = sm.getEnabledModels();
	if (!patterns || patterns.length === 0) return undefined;
	// enabledModels entries are "provider/modelId" exact strings (or globs, but
	// for our purposes exact membership check covers the common case).
	return new Set(patterns.map((p) => p.toLowerCase()));
}

/**
 * Check whether a model matches the enabledModels allowlist.
 * Supports exact "provider/modelId" entries and simple glob "*" patterns.
 */
function isModelEnabled(provider: string, modelId: string, enabled: Set<string> | undefined): boolean {
	if (!enabled) return true; // no filter → everything enabled
	const key = `${provider}/${modelId}`.toLowerCase();
	// Exact match first
	if (enabled.has(key)) return true;
	// Simple glob matching (supports trailing *, e.g. "anthropic/*")
	for (const pattern of enabled) {
		if (pattern.includes("*") || pattern.includes("?")) {
			const regex = new RegExp(
				"^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$",
			);
			if (regex.test(key)) return true;
		}
	}
	return false;
}

function getAvailableEnabledModels(ctx: ExtensionContext) {
	const enabled = getEnabledModelSet();
	return ctx.modelRegistry
		.getAvailable()
		.filter((m) => isModelEnabled(m.provider, m.id, enabled));
}

export function getProviders(ctx: ExtensionContext): ProviderInfo[] {
	const models = getAvailableEnabledModels(ctx);
	const providerMap = new Map<string, number>();

	for (const model of models) {
		providerMap.set(model.provider, (providerMap.get(model.provider) ?? 0) + 1);
	}

	return Array.from(providerMap.entries())
		.map(([name, count]) => ({ name, modelCount: count }))
		.sort((a, b) => a.name.localeCompare(b.name));
}

export function getModelsForProvider(ctx: ExtensionContext, provider: string) {
	return getAvailableEnabledModels(ctx)
		.filter((m) => m.provider === provider)
		.sort((a, b) => a.name.localeCompare(b.name));
}

// ─────────────────────────────────────────────────────────────────────────────
// Searchable select UI — styled to match leader-key overlay
// ─────────────────────────────────────────────────────────────────────────────

interface SearchableItem {
	value: string;
	label: string;
	description?: string;
}

const MAX_VISIBLE = 15;

export async function searchableSelect<T extends string>(
	ctx: ExtensionContext,
	title: string,
	items: SearchableItem[],
	helpText?: string,
): Promise<T | null> {
	return ctx.ui.custom<T | null>((tui, theme, _kb, done) => {
		let searchText = "";
		let filteredItems = [...items];
		let highlightedIndex = 0;
		let scrollOffset = 0;

		const th = theme;

		const pad = (s: string, len: number) => {
			const vis = visibleWidth(s);
			return s + " ".repeat(Math.max(0, len - vis));
		};

		const applyFilter = () => {
			if (searchText === "") {
				filteredItems = [...items];
			} else {
				filteredItems = fuzzyFilter(items, searchText, (item) => `${item.label} ${item.value}`);
			}
			highlightedIndex = 0;
			scrollOffset = 0;
		};

		const ensureVisible = () => {
			if (highlightedIndex < scrollOffset) {
				scrollOffset = highlightedIndex;
			} else if (highlightedIndex >= scrollOffset + MAX_VISIBLE) {
				scrollOffset = highlightedIndex - MAX_VISIBLE + 1;
			}
		};

		return {
			render: (width: number) => {
				const lines: string[] = [];
				const maxW = Math.min(width, 80);

				const hLine = "─".repeat(maxW - 2);
				const row = (content: string) =>
					th.fg("border", "│") + " " + pad(content, maxW - 4) + " " + th.fg("border", "│");

				// Header
				lines.push(th.fg("border", `╭${hLine}╮`));
				lines.push(row(th.fg("accent", th.bold(title))));

				// Search indicator
				if (searchText.length > 0) {
					lines.push(row(
						th.fg("muted", "search: ") + th.fg("accent", searchText) + th.fg("dim", "▏"),
					));
				}

				lines.push(th.fg("border", `├${hLine}┤`));

				// Items
				if (filteredItems.length === 0) {
					lines.push(row(th.fg("warning", "  no matches")));
				} else {
					const visibleEnd = Math.min(scrollOffset + MAX_VISIBLE, filteredItems.length);

					if (scrollOffset > 0) {
						lines.push(row(th.fg("dim", `  ↑ ${scrollOffset} more`)));
					}

					for (let i = scrollOffset; i < visibleEnd; i++) {
						const item = filteredItems[i];
						const isHighlighted = i === highlightedIndex;

						const label = isHighlighted
							? th.fg("accent", th.bold(item.label))
							: th.fg("text", item.label);

						let line = `${isHighlighted ? "> " : "  "}${label}`;

						if (item.description) {
							line += "  " + th.fg("dim", item.description);
						}

						lines.push(row(truncateToWidth(line, maxW - 4)));
					}

					const remaining = filteredItems.length - visibleEnd;
					if (remaining > 0) {
						lines.push(row(th.fg("dim", `  ↓ ${remaining} more`)));
					}
				}

				// Footer
				lines.push(th.fg("border", `├${hLine}┤`));
				const hint = helpText ?? "type to search • ↑↓ navigate • enter select • esc cancel";
				lines.push(row(th.fg("dim", hint)));
				lines.push(th.fg("border", `╰${hLine}╯`));

				return lines;
			},
			invalidate: () => {},
			handleInput: (data: string) => {
				// Escape / Ctrl+C: cancel
				if (matchesKey(data, "escape") || matchesKey(data, Key.ctrl("c"))) {
					done(null);
					return;
				}

				// Backspace: trim search or cancel if empty
				if (matchesKey(data, "backspace")) {
					if (searchText.length > 0) {
						searchText = searchText.slice(0, -1);
						applyFilter();
						tui.requestRender();
					}
					return;
				}

				// Navigation
				if (matchesKey(data, "up") || matchesKey(data, Key.ctrl("p"))) {
					highlightedIndex = Math.max(0, highlightedIndex - 1);
					ensureVisible();
					tui.requestRender();
					return;
				}
				if (matchesKey(data, "down") || matchesKey(data, Key.ctrl("n"))) {
					highlightedIndex = Math.min(filteredItems.length - 1, highlightedIndex + 1);
					ensureVisible();
					tui.requestRender();
					return;
				}

				// Enter: select highlighted
				if (matchesKey(data, "enter")) {
					if (filteredItems.length > 0 && highlightedIndex < filteredItems.length) {
						done(filteredItems[highlightedIndex].value as T);
					}
					return;
				}

				// Printable characters: search
				if (data.length === 1 && data >= " " && data <= "~") {
					searchText += data;
					applyFilter();
					tui.requestRender();
					return;
				}
			},
		};
	}, {
		overlay: true,
		overlayOptions: {
			anchor: "center",
			width: 80,
			minWidth: 50,
		},
	});
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-step flow
// ─────────────────────────────────────────────────────────────────────────────

export async function runModelSwitcher(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	if (!ctx.hasUI) return;

	// ── Step 1: Pick provider ──────────────────────────────────────────────
	const providers = getProviders(ctx);
	if (providers.length === 0) {
		ctx.ui.notify("No providers available", "warning");
		return;
	}

	const currentProvider = ctx.model?.provider;

	const providerItems: SearchableItem[] = providers.map((p) => {
		const isCurrent = p.name === currentProvider;
		const badge = isCurrent ? " (current)" : "";
		return {
			value: p.name,
			label: `${p.name}${badge}`,
			description: `${p.modelCount} model${p.modelCount !== 1 ? "s" : ""}`,
		};
	});

	const selectedProvider = await searchableSelect<string>(
		ctx,
		"Select Provider",
		providerItems,
	);
	if (!selectedProvider) return;

	// ── Step 2: Pick model from provider ──────────────────────────────────
	const models = getModelsForProvider(ctx, selectedProvider);
	if (models.length === 0) {
		ctx.ui.notify(`No models found for provider "${selectedProvider}"`, "warning");
		return;
	}

	const currentModelId = ctx.model?.id;

	const modelItems: SearchableItem[] = models.map((model) => {
		const isCurrent = model.provider === currentProvider && model.id === currentModelId;
		const badge = isCurrent ? " (current)" : "";
		const features: string[] = [];
		if (model.reasoning) features.push("reasoning");
		if (model.input.includes("image")) features.push("vision");
		const desc = features.length > 0 ? features.join(", ") : "";

		return {
			value: model.id,
			label: `${model.name}${badge}`,
			description: desc,
		};
	});

	const selectedModelId = await searchableSelect<string>(
		ctx,
		`Select Model (${selectedProvider})`,
		modelItems,
	);
	if (!selectedModelId) return;

	// ── Step 3: Pick thinking level ───────────────────────────────────────
	const selectedModel = ctx.modelRegistry.find(selectedProvider, selectedModelId);
	if (!selectedModel) {
		ctx.ui.notify(`Model ${selectedProvider}/${selectedModelId} not found`, "error");
		return;
	}

	const supportsReasoning = selectedModel.reasoning;
	let selectedThinking: ThinkingLevel = pi.getThinkingLevel();

	if (supportsReasoning) {
		const currentThinking = pi.getThinkingLevel();

		const thinkingItems: SearchableItem[] = ALL_THINKING_LEVELS.map((level) => {
			const isCurrent = level === currentThinking;
			return {
				value: level,
				label: isCurrent ? `${level} (current)` : level,
				description: getThinkingDescription(level),
			};
		});

		const thinkingChoice = await searchableSelect<ThinkingLevel>(
			ctx,
			`Thinking Level (${selectedModel.name})`,
			thinkingItems,
			"type to search • ↑↓ navigate • enter select • esc cancel",
		);

		if (!thinkingChoice) return;
		selectedThinking = thinkingChoice;
	}

	// ── Apply ─────────────────────────────────────────────────────────────
	const ok = await pi.setModel(selectedModel);
	if (!ok) {
		ctx.ui.notify(`No API key available for ${selectedProvider}/${selectedModelId}`, "warning");
		return;
	}

	if (supportsReasoning) {
		pi.setThinkingLevel(selectedThinking);
	}

	ctx.ui.notify(
		`Switched to ${selectedModel.name}${supportsReasoning ? ` (thinking: ${selectedThinking})` : ""}`,
		"info",
	);
}

export function getThinkingDescription(level: ThinkingLevel): string {
	switch (level) {
		case "off":
			return "No extended thinking";
		case "minimal":
			return "Minimal reasoning effort";
		case "low":
			return "Low reasoning effort";
		case "medium":
			return "Moderate reasoning effort";
		case "high":
			return "High reasoning effort";
		case "xhigh":
			return "Maximum reasoning effort";
		default:
			return "";
	}
}

/**
 * Interactive thinking level picker — opens a searchable select list of
 * all thinking levels and applies the chosen one immediately.
 */
export async function runThinkingPicker(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	if (!ctx.hasUI) return;

	const currentThinking = pi.getThinkingLevel();

	const thinkingItems: SearchableItem[] = ALL_THINKING_LEVELS.map((level) => {
		const isCurrent = level === currentThinking;
		return {
			value: level,
			label: isCurrent ? `${level} (current)` : level,
			description: getThinkingDescription(level),
		};
	});

	const choice = await searchableSelect<ThinkingLevel>(
		ctx,
		"Select Thinking Level",
		thinkingItems,
	);

	if (!choice) return;

	pi.setThinkingLevel(choice);
	ctx.ui.notify(`Thinking: ${choice}`, "info");
}
