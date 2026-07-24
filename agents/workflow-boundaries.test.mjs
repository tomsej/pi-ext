import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const implementer = readFileSync(new URL("./implementer.md", import.meta.url), "utf8");
const workflowPrompt = readFileSync(new URL("../prompts/wf.md", import.meta.url), "utf8");
const quickWorkflowPrompt = readFileSync(new URL("../prompts/wq.md", import.meta.url), "utf8");
const prFinisher = readFileSync(new URL("./pr-finisher.md", import.meta.url), "utf8");

// ── /wf — spec emitter for the Claude Code wf pipeline ──────────────────────

test("wf writes the spec outside the repo and lints it with wf-gate", () => {
	assert.match(workflowPrompt, /~\/Workspace\/specs\/<project>\/<name>\.md/);
	assert.match(workflowPrompt, /wf-gate\.mjs/);
	assert.match(workflowPrompt, /GATE check/);
});

test("wf carries no chain-era machinery", () => {
	assert.doesNotMatch(workflowPrompt, /\.pi\/chains/);
	assert.doesNotMatch(workflowPrompt, /run-chain/);
	assert.doesNotMatch(workflowPrompt, /chain\.json/);
	assert.doesNotMatch(workflowPrompt, /runbook/);
	assert.equal(existsSync(new URL("./uat.md", import.meta.url)), false);
});

test("wf defaults implementation to the pi engine with an explicit model", () => {
	assert.match(workflowPrompt, /\{agent: pi, model: openai-codex\/gpt-5\.6-sol\}/);
});

test("wf keeps the hard-won verify-command rules", () => {
	for (const rule of [
		/studen(ý|ým) start/, // cold start in a fresh worktree
		/serializovaně/, // shared-resource tests never run in parallel
		/strom svých potomků/, // gate kills its process tree on timeout
		/gitignored/, // full check must not rely on local gitignored artifacts
		/konkrétní stage/, // stage-level logging so failures name the test
	]) {
		assert.match(workflowPrompt, rule);
	}
	assert.match(workflowPrompt, /`\|\| true`/);
});

test("wf hands execution to /wf-run and never implements", () => {
	assert.match(workflowPrompt, /\/wf-run/);
	assert.match(workflowPrompt, /[Nn]epiš žádný produkční kód/);
});

// ── /wq — Pi-native quick path (unchanged behavior) ─────────────────────────

test("quick workflow keeps one review owner outside the implementer task", () => {
	const task = quickWorkflowPrompt.match(/1\. \*\*implementer\*\*([\s\S]*?)\n\n2\. \*\*review-loop\*\*/)[1];
	assert.match(task, /Do not run code review or spawn reviewers; the following review-loop step owns review/);
	assert.equal([...quickWorkflowPrompt.matchAll(/^\d+\. \*\*review-loop\*\*/gm)].length, 1);
});

test("quick workflow timeboxes every child step", () => {
	const steps = quickWorkflowPrompt.split(/^\d+\. \*\*/m).slice(1);
	assert.equal(steps.length, 3);
	for (const step of steps) {
		assert.match(step, /timeout <s>/);
	}
});

test("quick workflow reviewers inherit the available default model", () => {
	assert.doesNotMatch(quickWorkflowPrompt, /anthropic\//);
	assert.doesNotMatch(quickWorkflowPrompt, /openai-codex\//);
	assert.match(quickWorkflowPrompt, /zdědí dostupný defaultní model/);
});

// ── agent personas (used by /wq and as the headless pi implementer) ─────────

test("implementer leaves all review orchestration to the workflow", () => {
	assert.match(implementer, /Never run code review, spawn reviewers, or invoke the review-loop/);
	assert.match(implementer, /The workflow owns the review phase/);
});

test("implementer commits per criterion as the external progress signal", () => {
	assert.match(implementer, /one commit per GREEN criterion/);
	assert.match(implementer, /progress signal/);
});

test("pr-finisher trusts only the authoritative CI conclusion", () => {
	assert.match(prFinisher, /gh run view <run-id> --json status,conclusion/);
	assert.match(prFinisher, /watcher.*exit code|exit code.*advisory/);
	assert.match(prFinisher, /git push origin HEAD:<branch>/);
});
