/**
 * Tool Pills + Diff Renderer — combined extension.
 *
 * • ls, read, bash → colored pill labels + collapsed output
 * • write, edit → Shiki-powered syntax-highlighted diffs (from pi-diff)
 */

import type { ExtensionAPI, AgentToolResult, Theme } from "@mariozechner/pi-coding-agent";
import {
	createBashToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	highlightCode,
	keyHint,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { pill } from "./pill.js";
import { registerDiffTools } from "./diff-renderer.js";

/** Max lines shown in collapsed (non-expanded) result view */
const COLLAPSED_MAX_LINES = 15;

/** Extract the first text content from a tool result */
function getText(result: AgentToolResult<unknown>): string | undefined {
	const c = result.content.find((c) => c.type === "text");
	return c?.type === "text" ? c.text : undefined;
}

/**
 * Render tool output text with collapsed truncation + expand hint.
 */
function renderTextResult(
	text: string | undefined,
	expanded: boolean,
	theme: Theme,
	mode: "head" | "tail" = "head",
): Text {
	if (!text || !text.trim()) return new Text("", 0, 0);

	const lines = text.split("\n");

	if (expanded || lines.length <= COLLAPSED_MAX_LINES) {
		const output = lines.map((l) => theme.fg("toolOutput", l)).join("\n");
		return new Text(`\n${output}`, 0, 0);
	}

	const hidden = lines.length - COLLAPSED_MAX_LINES;
	const hint = theme.fg("dim", `… ${hidden} more lines (${keyHint("app.tools.expand", "to expand")})`);

	if (mode === "tail") {
		const visible = lines.slice(-COLLAPSED_MAX_LINES);
		const output = visible.map((l) => theme.fg("toolOutput", l)).join("\n");
		return new Text(`\n${hint}\n${output}`, 0, 0);
	}

	const visible = lines.slice(0, COLLAPSED_MAX_LINES);
	const output = visible.map((l) => theme.fg("toolOutput", l)).join("\n");
	return new Text(`\n${output}\n${hint}`, 0, 0);
}

/** Helper to register a basic tool (ls, read) with pill + collapsed output. */
function wrapBasicTool(
	pi: ExtensionAPI,
	orig: any,
	name: string,
	mkCallText: (args: any, theme: Theme) => string,
	mode: "head" | "tail" = "head",
) {
	pi.registerTool({
		...orig,
		parameters: { ...orig.parameters },
		renderCall(args: any, theme: Theme, _ctx: any) {
			return new Text(pill(name, theme) + " " + mkCallText(args, theme), 0, 0);
		},
		renderResult(result: any, { expanded }: { expanded: boolean }, theme: Theme, _ctx: any) {
			return renderTextResult(getText(result), expanded, theme, mode);
		},
	});
}

export default function (pi: ExtensionAPI) {
	const cwd = process.cwd();

	// ls
	wrapBasicTool(pi, createLsToolDefinition(cwd), "ls", (args, theme) =>
		theme.fg("accent", args.path || "."),
	);

	// read
	wrapBasicTool(pi, createReadToolDefinition(cwd), "read", (args, theme) => {
		let t = theme.fg("accent", args.path);
		if (args.offset || args.limit) {
			const parts: string[] = [];
			if (args.offset) parts.push(`L${args.offset}`);
			if (args.limit) parts.push(`${args.limit}L`);
			t += theme.fg("dim", ` ${parts.join(", ")}`);
		}
		return t;
	});

	// find + grep: handled by pi-fff extension (SIMD-accelerated, own rendering)

	// bash — special: syntax-highlighted command, tail mode
	const origBash = createBashToolDefinition(cwd);
	pi.registerTool({
		...origBash,
		parameters: { ...origBash.parameters },
		renderCall(args: any, theme: Theme, _ctx: any) {
			const cmd = args.command;
			const highlighted = highlightCode(cmd, "bash").join("\n");
			const isMultiLine = cmd.includes("\n") || cmd.length > 80;
			if (isMultiLine) {
				return new Text(pill("bash", theme) + "\n" + highlighted, 0, 0);
			}
			return new Text(pill("bash", theme) + " " + highlighted, 0, 0);
		},
		renderResult(result: any, { expanded }: { expanded: boolean }, theme: Theme, _ctx: any) {
			return renderTextResult(getText(result), expanded, theme, "tail");
		},
	});

	// write + edit — diff renderer with pills, expand/collapse, fallbacks
	registerDiffTools(pi);
}
