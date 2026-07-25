import { expect, test } from "bun:test";
import { statusLines } from "./custom-footer.js";

const WIDE = 200;

test("hides ponytail, keeps the rest verbatim", () => {
	expect(
		statusLines(
			[
				["ponytail", "○ 🐴 ponytail: ⚡ FULL"],
				["subagents", "subagents: ■ 2 running · /subagents to view"],
			],
			WIDE,
		),
	).toEqual(["subagents: ■ 2 running · /subagents to view"]);
});

test("sorts by key so lines don't jump when a status is re-set", () => {
	expect(
		statusLines(
			[
				["workflows", "workflows: ■ 1 running"],
				["subagents", "subagents: ■ 2 done"],
			],
			WIDE,
		),
	).toEqual(["subagents: ■ 2 done", "workflows: ■ 1 running"]);
});

test("splits multi-line statuses and drops blank ones", () => {
	expect(statusLines([["a", "one\n\ntwo"], ["b", "   "]], WIDE)).toEqual(["one", "two"]);
});

test("truncates to the available width", () => {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: measuring visible width
	const visible = statusLines([["a", "abcdefghij"]], 5)[0]!.replace(/\x1b\[[0-9;]*m/g, "");
	expect(visible).toBe("ab...");
});
