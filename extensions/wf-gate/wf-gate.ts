/**
 * wf-gate Extension — endgame guard for contract-driven workflows.
 *
 * A worktree conducted by the wf-impl skill may only open its PR once
 * <repo>/.wf/receipts.jsonl proves a passing full gate, a passing verify at
 * the current clean HEAD, and a review attest at that HEAD; it may never
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
		if (event.toolName !== "bash") return;
		const command = (event.input as { command?: string }).command;
		if (!command || !/\bgh\s+pr\b/.test(command)) return;

		// Imported on first `gh pr` call only: unrelated bash must not pay for it.
		hook ??= import(HOOK_URL) as Promise<Hook>;
		const { guard } = await hook;
		const reason = guard(command, ctx.cwd);
		if (reason) return { block: true, reason: `wf-gate: BLOCKED — ${reason}` };
	});
}
