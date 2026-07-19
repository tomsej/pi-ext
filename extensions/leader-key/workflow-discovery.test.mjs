import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { discoverWorkflows } from "./workflow-discovery.mjs";

function setup() {
	return mkdtempSync(join(tmpdir(), "wf-discovery-"));
}

test("returns [] for a missing chains dir", () => {
	assert.deepEqual(discoverWorkflows(join(setup(), "nope")), []);
});

test("discovers workflow dirs with contract.md and *.chain.json", () => {
	const root = setup();
	const dir = join(root, "add-auth");
	mkdirSync(dir);
	writeFileSync(join(dir, "contract.md"), "# contract");
	writeFileSync(
		join(dir, "add-auth.chain.json"),
		JSON.stringify({
			name: "add-auth",
			description: "Add user auth",
			chain: [
				{ agent: "implementer", label: "TDD", task: "do it" },
				{ expand: {}, parallel: { agent: "reviewer" } },
				{ agent: "uat", task: "test it" },
			],
		}),
	);

	const found = discoverWorkflows(root);
	assert.equal(found.length, 1);
	assert.equal(found[0].name, "add-auth");
	assert.equal(found[0].description, "Add user auth");
	assert.equal(found[0].dir, dir);
	// only simple agent+task steps, parallel/fanout groups skipped
	assert.deepEqual(
		found[0].steps.map((s) => s.agent),
		["implementer", "uat"],
	);
	assert.equal(found[0].steps[0].label, "TDD");
	assert.equal(typeof found[0].createdMs, "number");
	assert.ok(found[0].createdMs > 0);
});

test("sorts workflows newest first by creation time", () => {
	const root = setup();
	for (const name of ["a", "b", "c"]) {
		const dir = join(root, name);
		mkdirSync(dir);
		writeFileSync(join(dir, "contract.md"), "x");
		writeFileSync(join(dir, `${name}.chain.json`), JSON.stringify({ name, chain: [] }));
	}
	const found = discoverWorkflows(root);
	for (let i = 1; i < found.length; i++) {
		assert.ok(found[i - 1].createdMs >= found[i].createdMs, "descending by createdMs");
	}
});

test("skips dirs missing contract.md or chain.json and unparseable JSON", () => {
	const root = setup();
	// missing chain.json
	mkdirSync(join(root, "no-chain"));
	writeFileSync(join(root, "no-chain", "contract.md"), "x");
	// missing contract.md
	mkdirSync(join(root, "no-contract"));
	writeFileSync(join(root, "no-contract", "a.chain.json"), "{}");
	// bad JSON — pi-subagents would reject the chain, so skip it
	mkdirSync(join(root, "bad-json"));
	writeFileSync(join(root, "bad-json", "contract.md"), "x");
	writeFileSync(join(root, "bad-json", "bad-json.chain.json"), "not json");
	// valid workflow without description
	mkdirSync(join(root, "ok"));
	writeFileSync(join(root, "ok", "contract.md"), "x");
	writeFileSync(join(root, "ok", "ok.chain.json"), JSON.stringify({ name: "ok", chain: [] }));
	// stray file at top level
	writeFileSync(join(root, "README.md"), "x");

	const found = discoverWorkflows(root);
	assert.deepEqual(
		found.map((w) => w.name),
		["ok"],
	);
	assert.equal(found[0].description, undefined);
});
