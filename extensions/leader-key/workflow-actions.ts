/**
 * Workflow (contract + chain) leader-key group.
 *
 * New stages the /wf planner prompt (builds contract.md + a generated
 * .chain.json under .pi/chains/<name>/). Run and Validate pop a fuzzy picker
 * over discovered workflows: Run stages /run-chain, Validate stages
 * /plannotator-annotate on the workflow folder.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { join } from "node:path";
import type { TopLevelEntry } from "./types.js";
import { searchableSelect } from "./model-switcher.js";
import { discoverWorkflows } from "./workflow-discovery.mjs";

interface Workflow {
	name: string;
	dir: string;
	description?: string;
}

/** Pop a fuzzy picker over discovered workflows. Returns the chosen one, or null. */
async function pickWorkflow(ctx: ExtensionContext, title: string): Promise<Workflow | null> {
	const workflows: Workflow[] = discoverWorkflows(join(ctx.cwd, ".pi", "chains"));
	if (workflows.length === 0) {
		ctx.ui.notify("No workflows in .pi/chains — create one first (Workflow → New)", "info");
		return null;
	}
	const items = workflows.map((w) => ({
		value: w.name,
		label: w.name,
		description: w.description ?? w.dir,
	}));
	const name = await searchableSelect<string>(ctx, title, items);
	if (!name) return null;
	return workflows.find((w) => w.name === name) ?? null;
}

export function buildWorkflowEntries(_pi: ExtensionAPI): TopLevelEntry {
	return {
		type: "group",
		group: {
			key: "c",
			label: "Workflow",
			items: [
				{
					key: "n",
					label: "New",
					description: "build contract.md + workflow chain from the discussion (/wf)",
					action: (ctx: ExtensionContext) => {
						ctx.ui.setEditorText("/wf ");
						ctx.ui.notify("Describe the goal, then Enter", "info");
					},
				},
				{
					key: "v",
					label: "Validate",
					description: "pick a workflow, annotate its contract + chain in plannotator",
					action: async (ctx: ExtensionContext) => {
						const wf = await pickWorkflow(ctx, "Validate which workflow?");
						if (!wf) return;
						ctx.ui.setEditorText(`/plannotator-annotate ${wf.dir}/`);
						ctx.ui.notify("Enter to open the workflow folder in plannotator", "info");
					},
				},
				{
					key: "r",
					label: "Run",
					description: "pick a contract, run its workflow chain",
					action: async (ctx: ExtensionContext) => {
						const wf = await pickWorkflow(ctx, "Run which workflow?");
						if (!wf) return;
						ctx.ui.setEditorText(`/run-chain ${wf.name} -- execute the workflow per its contract`);
						ctx.ui.notify("Enter to run the workflow", "info");
					},
				},
			],
		},
	};
}
