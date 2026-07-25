import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

/**
 * Keep hypa's shell compression, drop its file tools.
 *
 * pi-hypa registers hypa_shell/read/grep/find/ls in one extension and has no
 * per-tool switch. read/grep/find/ls duplicate Pi builtins + pi-fff, so they
 * only cost prompt tokens. Also drop the MCP aliases pi-claude-code-use mirrors
 * them into, and re-drop on every turn since that extension re-activates them.
 */
const DROP = new Set(
	["hypa_read", "hypa_grep", "hypa_find", "hypa_ls"].flatMap((n) => [n, `mcp__pi__${n}`]),
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
