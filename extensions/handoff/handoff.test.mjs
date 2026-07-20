import assert from "node:assert/strict";
import { test } from "node:test";
import { buildHandoffPrompt, parseWorktreeCreateOutput } from "./handoff-core.mjs";

test("parses path from tab-separated sc output", () => {
	assert.equal(
		parseWorktreeCreateOutput("/Users/me/.superconductor/worktrees/repo/name\tsc-branch\n"),
		"/Users/me/.superconductor/worktrees/repo/name",
	);
});

test("ignores leading log lines and uses the tabbed line", () => {
	const out = "running setup...\nlaunching pi...\n/wt/path\tsc-branch\n";
	assert.equal(parseWorktreeCreateOutput(out), "/wt/path");
});

test("falls back to the last non-empty line when there is no tab", () => {
	assert.equal(parseWorktreeCreateOutput("\n/only/path\n\n"), "/only/path");
});

test("returns null on empty output", () => {
	assert.equal(parseWorktreeCreateOutput("   \n"), null);
});

test("handoff prompt leads with the goal and instructs /resume", () => {
	const prompt = buildHandoffPrompt("fix login bug");
	assert.match(prompt, /^Handoff: fix login bug\./);
	assert.match(prompt, /\/resume/);
});

test("handoff prompt handles a missing goal", () => {
	assert.match(buildHandoffPrompt(""), /\/resume/);
});
