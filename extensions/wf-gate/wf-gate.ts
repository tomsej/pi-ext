/**
 * wf-gate Extension — endgame guard for contract-driven workflows.
 *
 * A worktree conducted by the wf-impl skill may only open its PR once
 * <repo>/.wf/receipts.jsonl proves a passing full gate and review attest at
 * the current clean HEAD; it may never
 * merge. The decision lives in wf/wf-hook.mjs (shared with the Claude Code
 * PreToolUse hook, so delegated Claude subagents obey the same rules) — this
 * file is only the wiring that turns a block into a reason the model reads.
 *
 * Repos without .wf/active are untouched.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const HOOK_URL = new URL("../../wf/wf-hook.mjs", import.meta.url).href;

type Hook = {
	isGuardedCommand: (command: string) => boolean;
	guard: (command: string, cwd?: string) => string | null;
};

export default function (pi: ExtensionAPI) {
	let hook: Promise<Hook> | undefined;

	pi.on("tool_call", async (event, ctx) => {
		// Any tool that runs a shell command, not just `bash`: bg_start and other
		// command runners would otherwise be an open side door around the guard.
		const command = (event.input as { command?: unknown }).command;
		if (typeof command !== "string" || (!command.includes("gh") && !command.includes("gate"))) return;

		// Imported only for likely guarded commands: unrelated shell calls pay nothing.
		hook ??= import(HOOK_URL) as Promise<Hook>;
		const { isGuardedCommand, guard } = await hook;
		if (!isGuardedCommand(command)) return;
		const reason = guard(command, ctx.cwd);
		if (reason) return { block: true, reason: `wf-gate: BLOCKED — ${reason}` };
	});
}
