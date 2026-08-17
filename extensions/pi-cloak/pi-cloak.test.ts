import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cloakText, loadState } from "./index.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("pi-cloak", () => {
	it("masks values read from .env files", () => {
		const directory = mkdtempSync(join(tmpdir(), "pi-cloak-"));
		temporaryDirectories.push(directory);
		const configPath = join(directory, "cloak.json");
		writeFileSync(
			configPath,
			JSON.stringify({
				patterns: [{ filePattern: "**/*.env*", cloakPattern: "(=).+", replace: "$1" }],
			}),
		);

		const state = loadState(configPath);

		expect(cloakText("API_TOKEN=secret", "/project/.env", "/project", state)).toBe(
			"API_TOKEN=******",
		);
	});
});
