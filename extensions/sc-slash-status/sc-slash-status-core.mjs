// Pure helpers for the sc-slash-status extension.
//
// Superconductor flips a worktree to "running" only on Pi's agent_start
// (posted as eventType "Start"). Slash-driven subagent runs (/run-chain,
// /chain, /parallel, /run) dispatch through pi-subagents' internal
// `subagent:slash:*` event bridge, never through the parent agent loop, so no
// agent_start fires and the worktree stays "idle". These helpers build the
// notify.sh payloads that report Start/ToolActivity/AfterAgent for such runs.

const DEFAULT_ENV = "release";
const DEFAULT_VERSION = "8";

// Read HOOK_ENV / HOOK_VERSION from the installed (generated) superconductor
// hook so we always match whatever version the current install ships, instead
// of hardcoding a value that drifts on every upgrade.
export function parseHookMeta(fileContent) {
	const env = /HOOK_ENV\s*=\s*"([^"]+)"/.exec(fileContent ?? "")?.[1] ?? DEFAULT_ENV;
	const version = /HOOK_VERSION\s*=\s*"([^"]+)"/.exec(fileContent ?? "")?.[1] ?? DEFAULT_VERSION;
	return { env, version };
}

export function buildNotifyPayload({
	eventType,
	eventId,
	turnId,
	hookEventName,
	toolName,
	meta,
	terminalId,
	worktreePath,
	session,
}) {
	const payload = {
		env: meta?.env ?? DEFAULT_ENV,
		version: meta?.version ?? DEFAULT_VERSION,
		terminalId,
		worktreePath,
		eventType,
		eventId,
		turnId,
		sourcePayload: {
			hook_event_name: hookEventName,
			...(toolName ? { tool_name: toolName } : {}),
		},
		sessionId: session?.sessionId,
		sessionPath: session?.sessionPath,
		piSessionId: session?.piSessionId,
	};
	return payload;
}
