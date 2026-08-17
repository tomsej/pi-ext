import { expect, test } from "bun:test";
import toolPills from "./index.ts";

test("registers tool overrides lazily before the first agent turn", async () => {
	let beforeAgentStart: (() => Promise<void>) | undefined;
	const registeredTools: string[] = [];
	const pi = {
		on(event: string, handler: () => Promise<void>) {
			if (event === "before_agent_start") beforeAgentStart = handler;
		},
		registerTool(tool: { name: string }) {
			registeredTools.push(tool.name);
		},
	};

	toolPills(pi as never);

	expect(registeredTools).toEqual([]);
	expect(beforeAgentStart).toBeDefined();
	await beforeAgentStart!();
	expect(registeredTools.sort()).toEqual(["bash", "edit", "ls", "read", "write"]);

	await beforeAgentStart!();
	expect(registeredTools).toHaveLength(5);
});
