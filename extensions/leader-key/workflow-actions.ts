/**
 * Workflow (contract + chain) leader-key group.
 *
 * New stages the /wf planner prompt (builds contract.md + a generated
 * .chain.json under .pi/chains/<name>/). Run pops a fuzzy picker over
 * discovered workflows and stages /run-chain for the chosen one.
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
					key: "r",
					label: "Run",
					description: "pick a contract, run its workflow chain",
					action: async (ctx: ExtensionContext) => {
						const workflows: Workflow[] = discoverWorkflows(join(ctx.cwd, ".pi", "chains"));
						if (workflows.length === 0) {
							ctx.ui.notify("No workflows in .pi/chains — create one first (Workflow → New)", "info");
							return;
						}
						const items = workflows.map((w) => ({
							value: w.name,
							label: w.name,
							description: w.description ?? w.dir,
						}));
						const name = await searchableSelect<string>(ctx, "Run which workflow?", items);
						if (!name) return;
						ctx.ui.setEditorText(`/run-chain ${name} -- execute the workflow per its contract`);
						ctx.ui.notify("Enter to run the workflow", "info");
					},
				},
			],
		},
	};
}
