import assert from "node:assert/strict";
import { test } from "node:test";
import { buildNotifyPayload, parseHookMeta } from "./sc-slash-status-core.mjs";

test("parseHookMeta reads env and version from the generated hook", () => {
	const src = 'const HOOK_ENV = "release";\nconst HOOK_VERSION = "12";\n';
	assert.deepEqual(parseHookMeta(src), { env: "release", version: "12" });
});

test("parseHookMeta falls back when the hook is missing or unreadable", () => {
	assert.deepEqual(parseHookMeta(""), { env: "release", version: "8" });
	assert.deepEqual(parseHookMeta(undefined), { env: "release", version: "8" });
});

test("buildNotifyPayload mirrors the superconductor hook shape", () => {
	const payload = buildNotifyPayload({
		eventType: "Start",
		eventId: "pi-slash-run:abc",
		turnId: "pi-slash-run:abc",
		hookEventName: "slash_subagent_start",
		meta: { env: "release", version: "12" },
		terminalId: "term-1",
		worktreePath: "/wt/path",
		session: { sessionId: "s1", sessionPath: "/s1.jsonl", piSessionId: "s1" },
	});
	assert.deepEqual(payload, {
		env: "release",
		version: "12",
		terminalId: "term-1",
		worktreePath: "/wt/path",
		eventType: "Start",
		eventId: "pi-slash-run:abc",
		turnId: "pi-slash-run:abc",
		sourcePayload: { hook_event_name: "slash_subagent_start" },
		sessionId: "s1",
		sessionPath: "/s1.jsonl",
		piSessionId: "s1",
	});
});

test("buildNotifyPayload includes tool_name only when provided", () => {
	const withTool = buildNotifyPayload({
		eventType: "ToolActivity",
		hookEventName: "slash_subagent_update",
		toolName: "scout",
		meta: { env: "release", version: "8" },
	});
	assert.deepEqual(withTool.sourcePayload, {
		hook_event_name: "slash_subagent_update",
		tool_name: "scout",
	});

	const withoutTool = buildNotifyPayload({
		eventType: "AfterAgent",
		hookEventName: "slash_subagent_end",
		meta: { env: "release", version: "8" },
	});
	assert.deepEqual(withoutTool.sourcePayload, { hook_event_name: "slash_subagent_end" });
});
