// Boundary tests for the wf pipeline skills. They guard the invariants that
// break silently: a wrong wf-gate path, a phase reaching outside its role, the
// legacy frontmatter creeping back, and the documented agent roster drifting
// away from the one wf-gate actually resolves.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const yaml = createRequire(import.meta.url)("js-yaml");

const skill = (name) => readFileSync(new URL(`./${name}/SKILL.md`, import.meta.url), "utf8");
const GATE = new URL("../wf/wf-gate.mjs", import.meta.url).pathname;

const SKILLS = ["wf", "wf-run", "wf-impl", "wf-review", "wf-uat", "wf-explain", "wf-status"];
const wf = skill("wf");
const wfRun = skill("wf-run");
const wfImpl = skill("wf-impl");
const wfReview = skill("wf-review");

// ── the deterministic core must be reachable from every skill that claims it ──

test("wf-gate exists at the path the skills hand to the model", () => {
	assert.ok(existsSync(GATE), `${GATE} is missing`);
	for (const name of SKILLS) {
		const body = skill(name);
		if (!body.includes("wf-gate")) continue;
		assert.match(body, /node ~\/Workspace\/pi-ext\/wf\/wf-gate\.mjs/, `${name} names a stale wf-gate path`);
		assert.doesNotMatch(body, /\.claude\/wf/, `${name} still points at the Claude Code copy`);
	}
});

// Parsed, not regexed: an unquoted "key: value" inside a description is
// invalid YAML and pi drops the whole skill — silently, mid-pipeline.
test("every wf skill has parsable frontmatter with a matching name and a description", () => {
	for (const name of SKILLS) {
		const fm = skill(name).match(/^---\n([\s\S]*?)\n---/);
		assert.ok(fm, `${name} has no frontmatter`);
		let parsed;
		assert.doesNotThrow(() => {
			parsed = yaml.load(fm[1]);
		}, `${name} frontmatter is not valid YAML — pi will not load the skill`);
		assert.equal(parsed.name, name, `${name} frontmatter name mismatch`);
		assert.ok(parsed.description?.trim(), `${name} has no description`);
	}
});

// ── /wf — contract emitter ───────────────────────────────────────────────────

test("wf writes the spec outside the repo and lints it with wf-gate", () => {
	assert.match(wf, /~\/Workspace\/specs\/<project>\/<name>\.md/);
	assert.match(wf, /GATE check/);
});

test("wf documents the roster frontmatter, not the legacy engines shape", () => {
	assert.match(wf, /^impl: sol\b/m);
	assert.match(wf, /^conductor: opus\b/m);
	assert.match(wf, /^review:/m);
	assert.doesNotMatch(wf, /engines:/);
	assert.doesNotMatch(wf, /review\.rounds|reviewers:/);
});

test("wf keeps the hard-won verify-command rules", () => {
	for (const rule of [
		/studen(ý|ým) start/, // cold start in a fresh worktree
		/serializovaně/, // shared-resource tests never run in parallel
		/strom svých potomků/, // gate kills its process tree on timeout
		/gitignored/, // full check must not rely on local gitignored artifacts
		/konkrétní stage/, // stage-level logging so failures name the test
	]) {
		assert.match(wf, rule);
	}
	assert.match(wf, /`\|\| true`/);
});

test("wf hands execution to wf-run and never implements", () => {
	assert.match(wf, /wf-run/);
	assert.match(wf, /NIC neimplementuj|Nepiš žádný produkční kód/);
});

test("wf puts the business summary immediately after the current state", () => {
	assert.match(
		wf,
		/\*\*Současné chování \/ reprodukce:\*\*[\s\S]*?\n- \*\*Business shrnutí:\*\*[\s\S]*?\n- \*\*Akceptační kritéria:\*\*/,
	);
});

test("the roster documented in wf is the roster wf-gate resolves", () => {
	// Matches any `name` harness/model mention, so the docs can be a table, a
	// list or one dense line — the test pins the facts, not the layout.
	const documented = [...wf.matchAll(/`([a-z0-9-]+)` (pi|claude|codex)\/([^\s·|]+)/g)].map((m) => ({
		name: m[1],
		harness: m[2],
		model: m[3],
	}));
	assert.ok(documented.length >= 4, "no roster documented in the wf skill");

	const dir = mkdtempSync(join(tmpdir(), "wf-roster-"));
	mkdirSync(join(dir, "specs"));
	const file = join(dir, "specs", "roster.md");
	writeFileSync(
		file,
		`---\nname: roster\nimpl: ${documented[0].name}\nreview:\n  - smoke: ${documented[0].name}\nsame_model_review: allow\nverify:\n  quick:\n    - {id: q, kind: hard, command: "true", timeoutMs: 1000}\n  full:\n    - {id: f, kind: hard, command: "true", timeoutMs: 1000}\n---\n\n## Akceptační kritéria\n\n- ok\n`,
	);
	const r = spawnSync("node", [GATE, "agents", file, "--json"], { cwd: dir, encoding: "utf8" });
	assert.equal(r.status, 0, r.stdout + r.stderr);
	const { roster } = JSON.parse(r.stdout);
	for (const doc of documented) {
		assert.ok(roster[doc.name], `wf documents agent "${doc.name}" that wf-gate does not know`);
		assert.equal(roster[doc.name].harness, doc.harness, `harness drift for ${doc.name}`);
		assert.equal(roster[doc.name].model, doc.model, `model drift for ${doc.name}`);
	}
	for (const name of Object.keys(roster)) {
		assert.ok(
			documented.some((d) => d.name === name),
			`wf-gate knows agent "${name}" that the wf skill never documents`,
		);
	}
});

// ── /wf-run — launcher, never an implementer ─────────────────────────────────

test("wf-run launches pi conductors and never a Claude session", () => {
	assert.match(wfRun, /--provider pi/);
	assert.doesNotMatch(wfRun, /--provider claude/);
	assert.match(wfRun, /GATE agents/); // conductor model comes from the roster
});

test("wf-run asks before launching and never implements", () => {
	assert.match(wfRun, /ZEPTEJ|zeptej/); // the user picks what launches
	assert.ok(forbids(wfRun, "nespouštěj nic") || /neimplementuješ/.test(wfRun), "wf-run does not rule out implementing");
});

// ── /wf-impl — conductor boundaries ─────────────────────────────────────────

// Wording-independent: a negation must sit next to the forbidden action (line
// breaks ignored), so shortening the prose cannot quietly drop the prohibition.
function forbids(body, action) {
	const text = body.replace(/\s+/g, " ");
	for (let i = text.indexOf(action); i !== -1; i = text.indexOf(action, i + 1)) {
		if (/[Nn]ikdy|nesmíš|nepoužívej|neotvírej/.test(text.slice(Math.max(0, i - 80), i + 80))) return true;
	}
	return false;
}

test("wf-impl never creates worktrees and never merges", () => {
	assert.ok(forbids(wfImpl, "sc worktree create"), "wf-impl does not forbid creating worktrees");
	assert.ok(forbids(wfImpl, "nemerguj") || forbids(wfImpl, "gh pr merge"), "wf-impl does not forbid merging");
});

test("wf-impl delegates review instead of reviewing itself", () => {
	assert.match(wfImpl, /skill `wf-review`/);
	assert.doesNotMatch(wfImpl, /spusť revieweře|spawn reviewers/i);
});

test("wf-impl gates phase transitions on wf-gate, not on agent claims", () => {
	assert.match(wfImpl, /exit kód\w* wf-gate/i);
	assert.match(wfImpl, /GATE verify SPEC full/);
	assert.match(wfImpl, /GATE begin SPEC/);
});

test("wf-impl satisfies the endgame guard rather than working around it", () => {
	assert.match(wfImpl, /neobcházej|neválči/);
	assert.match(wfImpl, /<!-- wf-spec: <name> -->/); // status discovery marker
});

test("wf-impl resolves the impl engine from the roster and keeps pi resumable", () => {
	assert.match(wfImpl, /GATE agents SPEC --json/);
	assert.match(wfImpl, /--session-id \$\(cat \.wf\/impl-session\)/);
	assert.match(wfImpl, /subagent_spawn/); // claude/codex harnesses
	assert.match(wfImpl, /Max 3 opravná kola/);
});

// ── /wf-review — the cross-model guarantee lives here ────────────────────────

test("wf-review spawns the contract's panel in parallel with fresh contexts", () => {
	assert.match(wfReview, /GATE agents <spec> --json/);
	assert.match(wfReview, /subagent_spawn/);
	assert.match(wfReview, /PARALELNĚ/);
	assert.match(wfReview.replace(/\s+/g, " "), /nikdy je nesesypej na jeden model/); // the cross-model guarantee
});

test("wf-review attests only after a passing quick gate, and never to bypass", () => {
	assert.match(wfReview, /GATE verify <spec> quick/);
	assert.match(wfReview, /GATE attest review <spec>/);
	assert.match(wfReview, /NEATTESTUJ/);
	assert.match(wfReview, /max 2|max 2 kola|Kola — max 2/);
});

// The codex harness has no guard of its own (pi has the extension, Claude the
// PreToolUse hook), so for codex delegates this sentence is the only defence.
test("delegating skills forbid the endgame to every delegated agent", () => {
	for (const [name, body] of [
		["wf-impl", wfImpl],
		["wf-review", wfReview],
	]) {
		assert.match(body, /gh pr create/, `${name} never names the forbidden command`);
		assert.match(body, /gh pr merge/, `${name} never names the forbidden command`);
		assert.match(body, /codex/, `${name} does not say the codex harness is unguarded`);
	}
});

test("wf-review treats findings as claims and owns the fixes", () => {
	const flat = wfReview.replace(/\s+/g, " ");
	assert.match(flat, /nálezy jsou tvrzení|nálezy jsou TVRZENÍ/i);
	assert.match(flat, /revieweři jen reportují/);
});
