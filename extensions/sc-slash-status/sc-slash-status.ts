import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { buildNotifyPayload, parseHookMeta } from "./sc-slash-status-core.mjs";

// Report slash-driven subagent runs (/run-chain, /chain, /parallel, /run) to
// Superconductor. Those dispatch through pi-subagents' `subagent:slash:*`
// bridge, not the parent agent loop, so the generated superconductor hook never
// sees an agent_start and the worktree stays "idle" while work is running.
// Living in pi-ext keeps this upgrade-safe: the generated hook is regenerated
// on every Superconductor update, this extension is not.

const SC_ROOT = join(homedir(), ".superconductor");
const NOTIFY_PATH = join(SC_ROOT, "hooks", "notify.sh");
const GENERATED_HOOK = join(SC_ROOT, "hooks", "pi-superconductor.ts");

function sessionTopology(ctx: any) {
	const sessionId = ctx?.sessionManager?.getSessionId?.();
	return {
		sessionId,
		sessionPath: ctx?.sessionManager?.getSessionFile?.(),
		piSessionId: sessionId,
	};
}

export default function (pi: ExtensionAPI) {
	// Only active inside a Superconductor-managed session; a no-op everywhere else.
	const terminalId = process.env.SUPERCONDUCTOR_TERMINAL_ID;
	if (!terminalId) return;
	const worktreePath = process.env.SUPERCONDUCTOR_WORKTREE_PATH;

	let meta: { env: string; version: string };
	try {
		meta = parseHookMeta(readFileSync(GENERATED_HOOK, "utf8"));
	} catch {
		meta = parseHookMeta("");
	}

	const runs = new Map<string, { turnId: string; ctx: any }>();

	function notify(payload: Record<string, unknown>) {
		const child = spawn(NOTIFY_PATH, [JSON.stringify(payload)], { stdio: "ignore" });
		child.once("error", () => {});
	}

	pi.events.on("subagent:slash:request", (data: any) => {
		const requestId = data?.requestId;
		const ctx = data?.ctx;
		// Skip control actions (doctor/status/stop) that do no real work.
		if (!requestId || !ctx || data?.params?.action) return;
		const turnId = `pi-slash-run:${requestId}`;
		runs.set(requestId, { turnId, ctx });
		notify(
			buildNotifyPayload({
				eventType: "Start",
				eventId: turnId,
				turnId,
				hookEventName: "slash_subagent_start",
				meta,
				terminalId,
				worktreePath,
				session: sessionTopology(ctx),
			}),
		);
	});

	pi.events.on("subagent:slash:update", (data: any) => {
		const run = runs.get(data?.requestId);
		if (!run) return;
		notify(
			buildNotifyPayload({
				eventType: "ToolActivity",
				eventId: `${run.turnId}:update:${Date.now()}`,
				turnId: run.turnId,
				hookEventName: "slash_subagent_update",
				toolName: data?.currentTool,
				meta,
				terminalId,
				worktreePath,
				session: sessionTopology(run.ctx),
			}),
		);
	});

	pi.events.on("subagent:slash:response", (data: any) => {
		const run = runs.get(data?.requestId);
		if (!run) return;
		runs.delete(data.requestId);
		notify(
			buildNotifyPayload({
				eventType: "AfterAgent",
				eventId: `${run.turnId}:end`,
				turnId: run.turnId,
				hookEventName: "slash_subagent_end",
				meta,
				terminalId,
				worktreePath,
				session: sessionTopology(run.ctx),
			}),
		);
	});
}
