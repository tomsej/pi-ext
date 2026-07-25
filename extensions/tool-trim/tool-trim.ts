import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

/**
 * Deactivate registered-but-not-worth-their-prompt-tokens tools.
 *
 * - hypa_read/grep/find/ls duplicate Pi builtins and pi-fff; only hypa_shell
 *   (deterministic shell-output compression) earns its slot.
 * - sem_diff/eval/log/blame measured worse than `git diff` + `read`
 *   (1.23-1.44x more tokens); sem_impact and sem_context stay.
 *
 * Neither extension offers a per-tool switch, and Pi has no persistent
 * per-tool disable, so drop them from the active set. MCP aliases are dropped
 * too, and re-dropped every turn because pi-claude-code-use re-activates them.
 */
const DROP = new Set(
	[
		"hypa_read",
		"hypa_grep",
		"hypa_find",
		"hypa_ls",
		"sem_diff",
		"sem_eval",
		"sem_log",
		"sem_blame",
	].flatMap((n) => [n, `mcp__pi__${n}`]),
);

export default function (pi: ExtensionAPI) {
	const trim = async () => {
		const active = pi.getActiveTools();
		const kept = active.filter((name) => !DROP.has(name));
		if (kept.length !== active.length) pi.setActiveTools(kept);
	};
	pi.on("session_start", trim);
	pi.on("turn_start", trim);
}
