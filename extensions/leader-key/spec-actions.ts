/**
 * Spec (OpenSpec workflow) leader-key group.
 *
 * Explore and Propose are open-ended (no target change yet), so they just
 * stage a command. Apply / Validation / QA / Archive act on an existing
 * change, so they first pop a fuzzy picker of active changes, then stage the
 * command with the chosen id filled in.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { TopLevelEntry } from "./types.js";
import { searchableSelect } from "./model-switcher.js";

interface OpenSpecChange {
	name: string;
	completedTasks: number;
	totalTasks: number;
	status: "no-tasks" | "complete" | "in-progress";
}

async function listChanges(pi: ExtensionAPI): Promise<OpenSpecChange[] | null> {
	const result = await pi.exec("openspec", ["list", "--json"]);
	if (result.code !== 0) return null;
	try {
		const parsed = JSON.parse(result.stdout);
		return Array.isArray(parsed.changes) ? parsed.changes : null;
	} catch {
		return null;
	}
}

function changeProgress(c: OpenSpecChange): string {
	if (c.status === "no-tasks") return "no tasks yet";
	return `${c.completedTasks}/${c.totalTasks} tasks${c.status === "complete" ? " ✓" : ""}`;
}

/** Pop a fuzzy picker of active changes. Returns the chosen id, or null on cancel/none/error. */
export async function pickChange(pi: ExtensionAPI, ctx: ExtensionContext, title: string): Promise<string | null> {
	const changes = await listChanges(pi);
	if (changes === null) {
		ctx.ui.notify("openspec list failed — is OpenSpec initialized here? (openspec init --tools pi)", "error");
		return null;
	}
	if (changes.length === 0) {
		ctx.ui.notify("No active OpenSpec changes — propose one first (Spec → Spec)", "info");
		return null;
	}
	const items = changes.map((c) => ({ value: c.name, label: c.name, description: changeProgress(c) }));
	return searchableSelect<string>(ctx, title, items);
}

/** Pick a change, then stage `cmd(id)` in the editor for the user to confirm/extend. */
function pickThenStage(
	pi: ExtensionAPI,
	title: string,
	cmd: (id: string) => string,
	hint: string,
) {
	return async (ctx: ExtensionContext) => {
		const id = await pickChange(pi, ctx, title);
		if (!id) return;
		ctx.ui.setEditorText(cmd(id));
		ctx.ui.notify(hint, "info");
	};
}

export function buildSpecEntries(pi: ExtensionAPI): TopLevelEntry {
	const stage = (cmd: string, hint: string) => (ctx: ExtensionContext) => {
		ctx.ui.setEditorText(cmd);
		ctx.ui.notify(hint, "info");
	};

	return {
		type: "group",
		group: {
			key: "c",
			label: "Spec",
			items: [
				{
					key: "e",
					label: "Explore",
					description: "openspec — investigate before proposing",
					action: stage(
						"/opsx-explore (odpovídej vždy česky; file paths, kód a příkazy nech anglicky) ",
						"Describe what to explore, then Enter",
					),
				},
				{
					key: "s",
					label: "Spec",
					description: "openspec — propose a change (proposal + specs + tasks)",
					action: stage("/opsx-propose ", "Describe the change, then Enter"),
				},
				{
					key: "v",
					label: "Validation",
					description: "pick a change, annotate its spec files in the plannotator browser UI",
					// ponytail: local path only; store-based changes would need `--store` resolution — add if a store ever hosts changes.
					action: pickThenStage(
						pi,
						"Review spec of which change?",
						(id) => `/plannotator-annotate openspec/changes/${id}/`,
						"Enter to open the change's spec folder in plannotator",
					),
				},
				{
					key: "a",
					label: "Apply",
					description: "openspec — pick a change, implement interactively",
					action: pickThenStage(pi, "Apply which change?", (id) => `/opsx-apply ${id}`, "Enter to implement interactively"),
				},
				{
					key: "q",
					label: "QA",
					description: "openspec — pick a change, generate qa.md + prep env, test manually via plannotator",
					action: pickThenStage(pi, "QA which change?", (id) => `/opsx-qa ${id}`, "Enter to generate QA checklist and prep environment"),
				},
				{
					key: "z",
					label: "Archive",
					description: "openspec — pick a change, merge spec deltas and archive it",
					action: pickThenStage(pi, "Archive which change?", (id) => `/opsx-archive ${id}`, "Enter to archive"),
				},
			],
		},
	};
}
