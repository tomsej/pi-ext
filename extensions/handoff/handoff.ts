import { SessionManager, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { buildHandoffPrompt, parseWorktreeCreateOutput } from "./handoff-core.mjs";

/**
 * /handoff — create an app-managed super.engineering worktree and fork the full
 * current session (1:1 tree) into it, so work continues in the worktree with
 * complete history while the original session stays untouched in main.
 *
 * sc launches its own fresh session in the new worktree tab; the forked session
 * lands in that worktree's Pi session store, so the user runs /resume once there
 * to pick it up. sc itself rejects re-running create from a create-launched
 * session, so no extra guard is needed here.
 */
export default function (pi: ExtensionAPI) {
	pi.registerCommand("handoff", {
		description: "Create an sc worktree and fork the full current session into it",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("Handoff requires interactive mode", "error");
				return;
			}

			const source = ctx.sessionManager.getSessionFile();
			if (!source) {
				ctx.ui.notify("No session file (ephemeral session); nothing to hand off.", "error");
				return;
			}

			const goal =
				(args ?? "").trim() ||
				((await ctx.ui.input("Handoff goal (drives the worktree name):", ""))?.trim() ?? "");
			if (!goal) {
				ctx.ui.notify("Handoff cancelled: no goal given.", "warning");
				return;
			}

			ctx.ui.setStatus("handoff", "Creating worktree…");
			try {
				const { stdout, stderr, code } = await pi.exec("sc", [
					"worktree",
					"create",
					"--provider",
					"pi",
					"--prompt",
					buildHandoffPrompt(goal),
				]);
				if (code !== 0) {
					ctx.ui.notify(`sc worktree create failed: ${stderr.trim() || `exit ${code}`}`, "error");
					return;
				}

				const worktreePath = parseWorktreeCreateOutput(stdout);
				if (!worktreePath) {
					ctx.ui.notify(`Could not parse worktree path from sc output:\n${stdout.trim()}`, "error");
					return;
				}

				const forked = SessionManager.forkFrom(source, worktreePath);
				ctx.ui.notify(
					`Worktree ready: ${worktreePath}\n` +
						`Full session forked (${forked.getSessionFile() ?? "?"}).\n` +
						`In the new tab run /resume and pick the most recent session to continue.`,
					"info",
				);
			} catch (err) {
				ctx.ui.notify(`Handoff failed: ${err instanceof Error ? err.message : String(err)}`, "error");
			} finally {
				ctx.ui.setStatus("handoff", undefined);
			}
		},
	});
}
