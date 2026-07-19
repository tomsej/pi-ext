/**
 * Workflow (contract + chain) leader-key group.
 *
 * New stages the /wf planner prompt (builds contract.md + a generated
 * .chain.json under .pi/chains/<name>/). Validate, Run, and Phase pop a fuzzy
 * picker over discovered workflows: Validate stages /plannotator-annotate on
 * the folder, Run stages /run-chain for the whole chain, Phase stages /run
 * for a single chosen step (re-run after a mid-chain failure).
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { join } from "node:path";
import type { TopLevelEntry } from "./types.js";
import { searchableSelect } from "./model-switcher.js";
import { discoverWorkflows } from "./workflow-discovery.mjs";

interface WorkflowStep {
	agent: string;
	label?: string;
	task: string;
}

interface Workflow {
	name: string;
	dir: string;
	description?: string;
	createdMs: number;
	steps: WorkflowStep[];
}

/** Compact local timestamp, e.g. "2025-01-30 14:07". */
function fmtDate(ms: number): string {
	const d = new Date(ms);
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
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
		description: w.description ? `${fmtDate(w.createdMs)} · ${w.description}` : fmtDate(w.createdMs),
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
				{
					key: "p",
					label: "Phase",
					description: "pick a workflow + one phase, run just that agent (re-run after a failure)",
					action: async (ctx: ExtensionContext) => {
						const wf = await pickWorkflow(ctx, "Run one phase of which workflow?");
						if (!wf) return;
						if (wf.steps.length === 0) {
							ctx.ui.notify("This workflow's chain has no simple agent steps", "info");
							return;
						}
						const stepItems = wf.steps.map((s, i) => ({
							value: String(i),
							label: s.label ? `${s.agent} — ${s.label}` : s.agent,
							description: s.task.length > 80 ? `${s.task.slice(0, 77)}...` : s.task,
						}));
						const idx = await searchableSelect<string>(ctx, "Run which phase?", stepItems);
						if (idx === null) return;
						const step = wf.steps[Number(idx)];
						ctx.ui.setEditorText(`/run ${step.agent} ${step.task}`);
						ctx.ui.notify("Enter to run just this phase (no acceptance gate)", "info");
					},
				},
			],
		},
	};
}
