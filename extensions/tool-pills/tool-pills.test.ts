import { describe, expect, mock, test } from "bun:test";

const pendingHighlights: Array<{ code: string; resolve: (value: string) => void }> = [];

mock.module("@shikijs/cli", () => ({
	codeToANSI: (code: string) =>
		new Promise<string>((resolve) => pendingHighlights.push({ code, resolve })),
}));

const { registerDiffTools } = await import("./diff-renderer.ts");

const theme = {
	fg: (_role: string, text: string) => text,
	bold: (text: string) => text,
	inverse: (text: string) => text,
};

function writeRenderer() {
	const tools: any[] = [];
	registerDiffTools({ registerTool: (tool: any) => tools.push(tool) });
	return tools.find((tool) => tool.name === "write");
}

function renderCall(tool: any, args: Record<string, unknown>, ctx: any): string {
	return tool.renderCall(args, theme, ctx).render(200).join("\n");
}

async function waitFor(condition: () => boolean): Promise<void> {
	for (let i = 0; i < 100 && !condition(); i++) await Bun.sleep(1);
	expect(condition()).toBe(true);
}

describe("tool pills", () => {
	test("refreshes a new-file preview when same-length content changes", async () => {
		const tool = writeRenderer();
		const ctx = {
			state: {},
			argsComplete: true,
			expanded: false,
			invalidate() {},
		};
		const path = `/tmp/tool-pills-${process.pid}-${Date.now()}.ts`;

		renderCall(tool, { path, content: "const a = 1;" }, ctx);
		await waitFor(() => pendingHighlights.length === 1);

		renderCall(tool, { path, content: "const b = 2;" }, ctx);
		await waitFor(() => pendingHighlights.length === 2);

		pendingHighlights[1]!.resolve(pendingHighlights[1]!.code);
		await Bun.sleep(0);
		expect(renderCall(tool, { path, content: "const b = 2;" }, ctx)).toContain("const b = 2;");

		pendingHighlights[0]!.resolve(pendingHighlights[0]!.code);
		await Bun.sleep(0);
		const rendered = renderCall(tool, { path, content: "const b = 2;" }, ctx);
		expect(rendered).toContain("const b = 2;");
		expect(rendered).not.toContain("const a = 1;");
	});

	test("loads Shiki only when syntax highlighting is requested", async () => {
		const rendererUrl = new URL("./diff-renderer.ts", import.meta.url).href;
		const script = `
			const { registerDiffTools } = await import(${JSON.stringify(rendererUrl)});
			const shikiModules = () => Object.keys(require.cache).filter((path) => path.includes("shiki")).length;
			const before = shikiModules();
			const tools = [];
			registerDiffTools({ registerTool: (tool) => tools.push(tool) });
			const write = tools.find((tool) => tool.name === "write");
			const theme = { fg: (_role, text) => text, bold: (text) => text, inverse: (text) => text };
			let resolve;
			const highlighted = new Promise((done) => { resolve = done; });
			write.renderCall(
				{ path: "/tmp/tool-pills-lazy-shiki.ts", content: "const lazy = true;" },
				theme,
				{ state: {}, argsComplete: true, expanded: false, invalidate: resolve },
			);
			await highlighted;
			console.log(JSON.stringify({ before, after: shikiModules() }));
		`;
		const process = Bun.spawn([Bun.which("bun")!, "-e", script], {
			cwd: new URL("../..", import.meta.url).pathname,
			stdout: "pipe",
			stderr: "pipe",
		});
		const [exitCode, stdout, stderr] = await Promise.all([
			process.exited,
			new Response(process.stdout).text(),
			new Response(process.stderr).text(),
		]);

		expect(stderr).toBe("");
		expect(exitCode).toBe(0);
		const loaded = JSON.parse(stdout.trim()) as { before: number; after: number };
		expect(loaded.before).toBe(0);
		expect(loaded.after).toBeGreaterThan(0);
	});
});
