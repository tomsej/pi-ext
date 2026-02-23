/**
 * Model Switcher Extension
 *
 * A multi-step model selector with searchable lists:
 *   1. Pick a provider (searchable)
 *   2. Pick a model from that provider (searchable)
 *   3. Pick a thinking level (searchable)
 *
 * Triggered via `/switch` command or Ctrl+Shift+M shortcut.
 */

import type { ExtensionAPI, ExtensionContext, ThinkingLevel } from "@mariozechner/pi-coding-agent";
import { DynamicBorder, SettingsManager } from "@mariozechner/pi-coding-agent";
import { Container, fuzzyFilter, Key, matchesKey, type SelectItem, SelectList, Text } from "@mariozechner/pi-tui";

const ALL_THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

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

function getProviders(ctx: ExtensionContext): ProviderInfo[] {
	const models = getAvailableEnabledModels(ctx);
	const providerMap = new Map<string, number>();

	for (const model of models) {
		providerMap.set(model.provider, (providerMap.get(model.provider) ?? 0) + 1);
	}

	return Array.from(providerMap.entries())
		.map(([name, count]) => ({ name, modelCount: count }))
		.sort((a, b) => a.name.localeCompare(b.name));
}

function getModelsForProvider(ctx: ExtensionContext, provider: string) {
	return getAvailableEnabledModels(ctx)
		.filter((m) => m.provider === provider)
		.sort((a, b) => a.name.localeCompare(b.name));
}

// ─────────────────────────────────────────────────────────────────────────────
// Searchable select UI (reusable)
// ─────────────────────────────────────────────────────────────────────────────

async function searchableSelect<T extends string>(
	ctx: ExtensionContext,
	title: string,
	items: SelectItem[],
	helpText?: string,
): Promise<T | null> {
	return ctx.ui.custom<T | null>((tui, theme, _kb, done) => {
		let searchText = "";

		const container = new Container();

		// Top border
		container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

		// Title
		container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));

		// Search indicator (shown when user starts typing)
		const searchDisplay = new Text("", 1, 0);
		container.addChild(searchDisplay);

		// SelectList
		const selectList = new SelectList(items, Math.min(items.length, 15), {
			selectedPrefix: (text: string) => theme.fg("accent", text),
			selectedText: (text: string) => theme.fg("accent", text),
			description: (text: string) => theme.fg("muted", text),
			scrollInfo: (text: string) => theme.fg("dim", text),
			noMatch: (text: string) => theme.fg("warning", text),
		});

		selectList.onSelect = (item: SelectItem) => done(item.value as T);
		selectList.onCancel = () => done(null);

		container.addChild(selectList);

		// Help text
		const hint = helpText ?? "type to search • ↑↓ navigate • enter select • esc cancel";
		container.addChild(new Text(theme.fg("dim", hint), 1, 0));

		// Bottom border
		container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

		// Apply fuzzy filter to the select list.
		// We bypass selectList.setFilter() (which only does startsWith on value)
		// and instead use fuzzyFilter for much better matching, then set the
		// internal filteredItems/selectedIndex directly.
		const applyFuzzyFilter = (query: string) => {
			const sl = selectList as any;
			if (query === "") {
				sl.filteredItems = items;
			} else {
				sl.filteredItems = fuzzyFilter(items, query, (item) => `${item.label} ${item.value}`);
			}
			sl.selectedIndex = 0;
		};

		const updateSearchDisplay = () => {
			if (searchText.length > 0) {
				searchDisplay.setText(theme.fg("muted", "  search: ") + theme.fg("accent", searchText) + theme.fg("dim", "▏"));
			} else {
				searchDisplay.setText("");
			}
		};

		return {
			render: (w: number) => container.render(w),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				// Backspace: trim search text
				if (matchesKey(data, "backspace")) {
					if (searchText.length > 0) {
						searchText = searchText.slice(0, -1);
						applyFuzzyFilter(searchText);
						updateSearchDisplay();
						tui.requestRender();
					}
					return;
				}

				// Let SelectList handle navigation keys (up/down/enter/escape)
				if (matchesKey(data, "up") || matchesKey(data, "down") ||
					matchesKey(data, "enter") || matchesKey(data, "escape") ||
					matchesKey(data, Key.ctrl("c")) || matchesKey(data, Key.ctrl("n")) ||
					matchesKey(data, Key.ctrl("p"))) {
					selectList.handleInput(data);
					tui.requestRender();
					return;
				}

				// Printable characters: append to search
				if (data.length === 1 && data >= " " && data <= "~") {
					searchText += data;
					applyFuzzyFilter(searchText);
					updateSearchDisplay();
					tui.requestRender();
					return;
				}

				// Fallback: forward to selectList
				selectList.handleInput(data);
				tui.requestRender();
			},
		};
	});
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-step flow
// ─────────────────────────────────────────────────────────────────────────────

async function runModelSwitcher(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	if (!ctx.hasUI) return;

	// ── Step 1: Pick provider ──────────────────────────────────────────────
	const providers = getProviders(ctx);
	if (providers.length === 0) {
		ctx.ui.notify("No providers available", "warning");
		return;
	}

	const currentProvider = ctx.model?.provider;

	const providerItems: SelectItem[] = providers.map((p) => {
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

	const modelItems: SelectItem[] = models.map((model) => {
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

		const thinkingItems: SelectItem[] = ALL_THINKING_LEVELS.map((level) => {
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

function getThinkingDescription(level: ThinkingLevel): string {
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

// ─────────────────────────────────────────────────────────────────────────────
// Extension Export
// ─────────────────────────────────────────────────────────────────────────────

export { runModelSwitcher, runThinkingPicker };

/**
 * Interactive thinking level picker — opens a searchable select list of
 * all thinking levels and applies the chosen one immediately.
 */
async function runThinkingPicker(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	if (!ctx.hasUI) return;

	const currentThinking = pi.getThinkingLevel();

	const thinkingItems: SelectItem[] = ALL_THINKING_LEVELS.map((level) => {
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

export default function (pi: ExtensionAPI) {
	pi.registerCommand("switch", {
		description: "Switch model (provider → model → thinking level)",
		handler: async (_args, ctx) => {
			await runModelSwitcher(pi, ctx);
		},
	});

	pi.registerShortcut(Key.ctrlShift("m"), {
		description: "Switch model (provider → model → thinking level)",
		handler: async (ctx) => {
			await runModelSwitcher(pi, ctx);
		},
	});
}
