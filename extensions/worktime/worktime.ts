import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createWorktime, formatDuration } from "./worktime-core.mjs";

/**
 * /worktime — track how long the agent actively worked on the current prompt.
 *
 * Active time = sum of spans between agent_start and agent_end. Resets on each
 * new prompt (input). The value is broadcast via the `worktime:update` event so
 * the custom footer can render it inline after the model/thinking segment.
 */
export const WORKTIME_UPDATE_EVENT = "worktime:update";

export default function (pi: ExtensionAPI) {
	const wt = createWorktime();
	let timer: ReturnType<typeof setInterval> | null = null;

	const emit = () => pi.events.emit(WORKTIME_UPDATE_EVENT, { ms: wt.elapsed(), running: wt.running });

	pi.on("input", async () => {
		wt.reset(); // new prompt → start counting from zero
		emit();
		return { action: "continue" };
	});

	pi.on("agent_start", async () => {
		wt.start();
		if (!timer) timer = setInterval(emit, 1000);
		emit();
	});

	pi.on("agent_end", async () => {
		wt.end();
		if (timer) {
			clearInterval(timer);
			timer = null;
		}
		emit();
	});

	pi.on("session_shutdown", async () => {
		if (timer) {
			clearInterval(timer);
			timer = null;
		}
	});

	pi.registerCommand("worktime", {
		description: "Show how long the agent worked on the current prompt",
		handler: async (_args, ctx) => {
			ctx.ui.notify(`Agent worked ${formatDuration(wt.elapsed())} on this prompt`, "info");
		},
	});
}
