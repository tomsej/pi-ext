/**
 * Contracts leader-key entry.
 *
 * One picker over the project's wf contracts, built from `wf-gate status
 * --json` — the same derived state the skills use, so the menu can never drift
 * from reality. Picking a contract offers only the actions its state allows.
 *
 * Deterministic actions (check, archive, delete, open PR, review) run right
 * here; a leader key should not spend a model turn on a file move. Actions
 * needing judgement (launch, resume, resolve comments) stage a prompt for the
 * wf-run skill, which owns dispatch.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { TopLevelEntry } from "./types.js";
import { searchableSelect } from "./model-switcher.js";

const GATE = new URL("../../wf/wf-gate.mjs", import.meta.url).pathname;

export type ContractState = "ready" | "running" | "pr-open" | "done";

export interface Contract {
	name: string;
	file: string; // …/<name>/contract.md
	state: ContractState;
	deps?: string[];
	branch?: string;
	worktree?: string;
	lastCommit?: string;
	unresolvedThreads?: number | null;
	pr?: { number: number; isDraft?: boolean };
	note?: string;
}

interface Item {
	value: string;
	label: string;
	description: string;
}

const NEW_CONTRACT = "\u0000new";

const MARK: Record<ContractState, string> = {
	running: "●",
	"pr-open": "◐",
	done: "✓",
	ready: "○",
};

/** One line of context per contract — whatever its state makes relevant. */
export function contractDetail(c: Contract): string {
	switch (c.state) {
		case "running":
			return [c.branch, c.lastCommit && `commit ${c.lastCommit}`].filter(Boolean).join(" · ");
		case "pr-open": {
			const threads = c.unresolvedThreads ? `${c.unresolvedThreads} unresolved` : "no open threads";
			return `PR #${c.pr?.number}${c.pr?.isDraft ? " (draft)" : ""} · ${threads}`;
		}
		case "done":
			return `PR #${c.pr?.number} merged — archive it`;
		default:
			return c.note ?? "ready to launch";
	}
}

/** Picker rows: a pinned "new contract" action, then the contracts. */
export function contractItems(contracts: Contract[]): Item[] {
	return [
		{ value: NEW_CONTRACT, label: "+ New contract", description: "turn the discussion into a contract (/wf)" },
		...contracts.map((c) => ({
			value: c.name,
			label: `${MARK[c.state] ?? "○"} ${c.name}`,
			description: `${c.state} · ${contractDetail(c)}`,
		})),
	];
}

/**
 * Actions a contract's state allows. Review (the contract folder in
 * plannotator) is always offered — reading is safe in every state.
 */
export function actionsFor(c: Contract): Item[] {
	const review: Item = {
		value: "review",
		label: "Review",
		description: "open the contract folder (contract + explanation) in plannotator",
	};
	const check: Item = { value: "check", label: "Check", description: "lint the contract with wf-gate" };
	const openPr: Item = { value: "pr", label: "Open PR", description: `gh pr view ${c.pr?.number ?? ""} --web` };

	switch (c.state) {
		case "ready":
			return [
				{ value: "launch", label: "Launch", description: "create a worktree and conduct this contract" },
				review,
				check,
				{ value: "delete", label: "Delete", description: "remove the contract folder (asks to confirm)" },
			];
		case "running":
			return [
				{ value: "resume", label: "Resume", description: "nudge the conducting session to continue" },
				review,
				check,
			];
		case "pr-open":
			return [
				openPr,
				{ value: "comments", label: "Resolve comments", description: "dispatch the worktree session at the open threads" },
				review,
			];
		case "done":
			return [
				{ value: "archive", label: "Archive", description: "move the contract folder into _archive/" },
				review,
				openPr,
			];
	}
}

/** `wf-gate status --json` for the current project, or null when it fails. */
function loadContracts(cwd: string): Contract[] | null {
	const r = spawnSync("node", [GATE, "status", "--json"], { cwd, encoding: "utf8", timeout: 30_000 });
	if (r.status !== 0 || !r.stdout) return null;
	try {
		return JSON.parse(r.stdout).specs as Contract[];
	} catch {
		return null;
	}
}

function stage(ctx: ExtensionContext, text: string, hint: string) {
	ctx.ui.setEditorText(text);
	ctx.ui.notify(hint, "info");
}

async function runAction(ctx: ExtensionContext, action: string, c: Contract) {
	const dir = dirname(c.file);
	switch (action) {
		case "launch":
			return stage(ctx, `/skill:wf-run launch the contract "${c.name}" (${c.file})`, "Enter to plan and launch");
		case "resume":
			return stage(
				ctx,
				`/skill:wf-run resume the contract "${c.name}" (${c.file}) — its session looks stalled`,
				"Enter to dispatch a resume",
			);
		case "comments":
			return stage(
				ctx,
				`/skill:wf-run resolve the open review threads on PR #${c.pr?.number} for the contract "${c.name}" (${c.file})`,
				"Enter to dispatch comment resolution",
			);
		case "review":
			return stage(ctx, `/plannotator-annotate ${dir}/`, "Enter to open the contract folder");
		case "check": {
			const r = spawnSync("node", [GATE, "check", c.file], { cwd: ctx.cwd, encoding: "utf8", timeout: 60_000 });
			const problems = (r.stdout + r.stderr).split("\n").filter((l) => l.startsWith("✖"));
			return ctx.ui.notify(
				r.status === 0 ? `${c.name}: contract is clean` : problems.slice(0, 3).join(" | ") || `${c.name}: check failed`,
				r.status === 0 ? "info" : "error",
			);
		}
		case "pr":
			if (!c.pr) return ctx.ui.notify("No PR for this contract", "info");
			spawn("gh", ["pr", "view", String(c.pr.number), "--web"], { cwd: ctx.cwd, detached: true, stdio: "ignore" }).unref();
			return ctx.ui.notify(`Opening PR #${c.pr.number}`, "info");
		case "archive": {
			const archive = join(dirname(dir), "_archive");
			mkdirSync(archive, { recursive: true });
			let dest = join(archive, basename(dir));
			if (existsSync(dest)) dest += `-${Date.now()}`;
			renameSync(dir, dest);
			return ctx.ui.notify(`Archived ${c.name} → _archive/`, "info");
		}
		case "delete": {
			const confirm = await searchableSelect<string>(ctx, `Delete ${c.name}? This cannot be undone`, [
				{ value: "no", label: "Cancel" },
				{ value: "yes", label: "Delete permanently" },
			]);
			if (confirm !== "yes") return;
			rmSync(dir, { recursive: true, force: true });
			return ctx.ui.notify(`Deleted ${c.name}`, "info");
		}
	}
}

export function buildWorkflowEntries(_pi: ExtensionAPI): TopLevelEntry {
	return {
		type: "action",
		key: "c",
		label: "Contracts",
		description: "wf contracts — state-driven actions",
		action: async (ctx: ExtensionContext) => {
			const contracts = loadContracts(ctx.cwd);
			if (contracts === null) {
				ctx.ui.notify("wf-gate status failed — is this a git repo with a project remote?", "error");
				return;
			}
			const picked = await searchableSelect<string>(ctx, "Contracts", contractItems(contracts));
			if (!picked) return;
			if (picked === NEW_CONTRACT) {
				return stage(ctx, "/wf ", "Describe the goal, then Enter");
			}
			const contract = contracts.find((c) => c.name === picked);
			if (!contract) return;
			const action = await searchableSelect<string>(ctx, `${contract.name} (${contract.state})`, actionsFor(contract));
			if (action) await runAction(ctx, action, contract);
		},
	};
}
