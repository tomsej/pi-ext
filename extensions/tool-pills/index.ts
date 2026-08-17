import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function toolPills(pi: ExtensionAPI): void {
	let loading: Promise<void> | undefined;

	pi.on("before_agent_start", async () => {
		loading ??= import("./runtime.js").then(({ default: registerToolPills }) => {
			registerToolPills(pi);
		});
		await loading;
	});
}
