// The palette's whole job is offering the right actions for a contract's
// state. That mapping is pure, so it is tested directly; the side effects
// around it (spawn, ui) are thin wrappers over commands tested in wf/.
import { expect, test } from "bun:test";
import { type Contract, actionsFor, contractDetail, contractItems } from "./workflow-actions.ts";

const contract = (over: Partial<Contract> = {}): Contract => ({
	name: "parse-duration-days",
	file: "/specs/demo/parse-duration-days/contract.md",
	state: "ready",
	...over,
});

const values = (c: Contract) => actionsFor(c).map((a) => a.value);

test("a ready contract can be launched, reviewed, checked and deleted", () => {
	expect(values(contract())).toEqual(["launch", "review", "check", "delete"]);
});

test("a running contract is resumed, never launched again", () => {
	const v = values(contract({ state: "running", branch: "feat/x" }));
	expect(v).toContain("resume");
	expect(v).not.toContain("launch");
	expect(v).not.toContain("delete"); // deleting work in flight is never the intent
});

test("an open PR offers the PR and its comments, not a relaunch", () => {
	const v = values(contract({ state: "pr-open", pr: { number: 12, isDraft: true }, unresolvedThreads: 2 }));
	expect(v).toEqual(["pr", "comments", "review"]);
});

test("a merged contract offers archiving", () => {
	expect(values(contract({ state: "done", pr: { number: 9 } }))).toContain("archive");
});

test("review is available in every state", () => {
	for (const state of ["ready", "blocked", "running", "pr-open", "done"] as const) {
		expect(values(contract({ state, pr: { number: 1 } }))).toContain("review");
	}
});

test("details carry what each state makes actionable", () => {
	expect(contractDetail(contract({ state: "running", branch: "sc-zero-perovskite-654b", lastCommit: "4 minutes ago" }))).toBe(
		"sc-zero-perovskite-654b · commit 4 minutes ago",
	);
	expect(contractDetail(contract({ state: "pr-open", pr: { number: 12, isDraft: true }, unresolvedThreads: 2 }))).toBe(
		"PR #12 (draft) · 2 unresolved",
	);
	expect(contractDetail(contract({ state: "blocked", blockedBy: ["alpha", "beta"] }))).toBe("waiting for alpha, beta");
	expect(contractDetail(contract({ state: "done", pr: { number: 9 } }))).toMatch(/#9 merged/);
});

test("the picker pins a new-contract row above the contracts", () => {
	const items = contractItems([contract({ state: "running" })]);
	expect(items).toHaveLength(2);
	expect(items[0].label).toBe("+ New contract");
	expect(items[1].label).toBe("● parse-duration-days");
	expect(items[1].description).toStartWith("running · ");
});

test("an empty project still offers the new-contract row", () => {
	expect(contractItems([]).map((i) => i.label)).toEqual(["+ New contract"]);
});
