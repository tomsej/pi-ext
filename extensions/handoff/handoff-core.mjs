/**
 * Parse the text output of `sc worktree create` ("<path>\t<branch>") into the
 * worktree path. sc may print setup/launch log lines first, so prefer the last
 * tab-separated line and fall back to the last non-empty line.
 *
 * ponytail: text-parse of the documented output shape; switch to `--json` if
 * sc ever changes its stdout format.
 */
export function parseWorktreeCreateOutput(stdout) {
	const lines = String(stdout ?? "")
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	if (lines.length === 0) return null;
	const tabbed = [...lines].reverse().find((line) => line.includes("\t"));
	const line = tabbed ?? lines[lines.length - 1];
	const path = line.split("\t")[0].trim();
	return path || null;
}

/**
 * Build the first-message prompt for the new worktree session. It drives the
 * generated branch/tab name (so it leads with the goal) and tells whoever lands
 * in that tab to `/resume` the forked full-history session instead of starting over.
 */
export function buildHandoffPrompt(goal) {
	const trimmed = String(goal ?? "").trim();
	const lead = trimmed ? `Handoff: ${trimmed}.` : "Handoff from a previous session.";
	return `${lead} The full prior session was forked into this worktree. Run /resume and pick the most recent session to continue with complete history; do not restart the task from scratch here.`;
}
