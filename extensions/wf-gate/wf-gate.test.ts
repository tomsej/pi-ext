// Wiring test for the wf-gate extension: the guard's decisions are covered by
// wf/wf-gate.test.mjs, this proves the tool_call plumbing around it — event
// shape, cwd source, and that only `gh pr` commands reach the guard.
import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import extension from "./wf-gate.ts";

type Handler = (
	event: { toolName: string; input: unknown },
	ctx: { cwd: string },
) => Promise<{ block: true; reason: string } | undefined>;

function loadExtension(): Handler {
	let handler: Handler | undefined;
	const pi = {
		on: (event: string, fn: Handler) => {
			if (event === "tool_call") handler = fn;
		},
		// biome-ignore lint/suspicious/noExplicitAny: minimal ExtensionAPI stub
	} as any;
	extension(pi);
	if (!handler) throw new Error("extension registered no tool_call handler");
	return handler;
}

const GATE = new URL("../../wf/wf-gate.mjs", import.meta.url).pathname;

/** A git repo whose worktree is conducted by wf-impl, with no receipts yet. */
function wfRepo(): string {
	const dir = mkdtempSync(join(tmpdir(), "wf-ext-"));
	execFileSync("git", ["init", "-q"], { cwd: dir });
	execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: dir });
	execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
	mkdirSync(join(dir, "specs"));
	writeFileSync(
		join(dir, "specs", "alpha.md"),
		`---\nname: alpha\nimpl: sol\nreview:\n  - smoke: cc\nverify:\n  quick:\n    - {id: q, kind: hard, command: "true", timeoutMs: 1000}\n  full:\n    - {id: f, kind: hard, command: "true", timeoutMs: 1000}\n---\n\n## Akceptační kritéria\n\n- ok\n`,
	);
	execFileSync("git", ["add", "-A"], { cwd: dir });
	execFileSync("git", ["commit", "-qm", "init"], { cwd: dir });
	execFileSync("node", [GATE, "begin", "specs/alpha.md"], { cwd: dir });
	return dir;
}

test("blocks gh pr create without receipts and hands the model a reason", async () => {
	const handler = loadExtension();
	const result = await handler({ toolName: "bash", input: { command: "gh pr create --draft" } }, { cwd: wfRepo() });
	expect(result?.block).toBe(true);
	expect(result?.reason).toContain("wf-gate: BLOCKED");
	expect(result?.reason).toMatch(/verify/i);
});

test("blocks a guarded command routed through another tool, e.g. bg_start", async () => {
	const handler = loadExtension();
	const cwd = wfRepo();
	for (const toolName of ["bg_start", "hypa_shell"]) {
		const result = await handler({ toolName, input: { command: "gh pr create --draft" } }, { cwd });
		expect(result?.block).toBe(true);
	}
});

test("allows gh pr create once the receipts prove the gates", async () => {
	const handler = loadExtension();
	const cwd = wfRepo();
	execFileSync("node", [GATE, "verify", "specs/alpha.md", "full"], { cwd });
	execFileSync("node", [GATE, "attest", "review", "specs/alpha.md"], { cwd });
	expect(await handler({ toolName: "bash", input: { command: "gh pr create --draft" } }, { cwd })).toBeUndefined();
});

test("blocks gh pr merge in a conducted worktree", async () => {
	const handler = loadExtension();
	const result = await handler({ toolName: "bash", input: { command: "gh pr merge 7 --squash" } }, { cwd: wfRepo() });
	expect(result?.block).toBe(true);
	expect(result?.reason).toMatch(/merge/i);
});

test("blocks a direct full gate that would bypass receipts", async () => {
	const handler = loadExtension();
	const result = await handler({ toolName: "bash", input: { command: "CH_GATE_SKIP_PERF=1 just gate alpha" } }, { cwd: wfRepo() });
	expect(result?.block).toBe(true);
	expect(result?.reason).toMatch(/wf-gate verify/i);
});

test("lets unrelated commands and non-bash tools through", async () => {
	const handler = loadExtension();
	const cwd = wfRepo();
	expect(await handler({ toolName: "bash", input: { command: "gh pr view 7" } }, { cwd })).toBeUndefined();
	expect(await handler({ toolName: "bash", input: { command: "npm test" } }, { cwd })).toBeUndefined();
	expect(await handler({ toolName: "bash", input: {} }, { cwd })).toBeUndefined();
	expect(await handler({ toolName: "edit", input: { path: "a.txt", content: "gh pr merge" } }, { cwd })).toBeUndefined();
});

test("leaves repos that are not wf-conducted alone", async () => {
	const handler = loadExtension();
	const dir = mkdtempSync(join(tmpdir(), "wf-plain-"));
	execFileSync("git", ["init", "-q"], { cwd: dir });
	expect(await handler({ toolName: "bash", input: { command: "gh pr merge 7" } }, { cwd: dir })).toBeUndefined();
});
