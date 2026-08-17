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

const SKILLS = ["wf", "wf-run", "wf-impl", "wf-review", "wf-uat", "wf-explain", "pr-explain", "wf-status", "wf-quick"];
const MANUAL_ONLY_SKILLS = [...SKILLS, "pr-review-comments", "review-guards"];
const wf = skill("wf");
const wfRun = skill("wf-run");
const wfImpl = skill("wf-impl");
const wfReview = skill("wf-review");

// A skill directory that is not registered in package.json pi.skills never
// reaches the prompt — it fails silently, exactly like invalid frontmatter.
test("every wf skill is registered in package.json pi.skills", () => {
	const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
	for (const name of SKILLS) {
		assert.ok(pkg.pi.skills.includes(`./skills/${name}`), `${name} is missing from pi.skills`);
	}
});

// ── the deterministic core must be reachable from every skill that claims it ──

test("wf-gate exists at the path the skills hand to the model", () => {
	assert.ok(existsSync(GATE), `${GATE} is missing`);
	for (const name of SKILLS) {
		const body = skill(name);
		// Only skills that actually invoke the gate must carry the full path;
		// mentioning wf-gate in prose („žádný wf-gate") is fine without it.
		if (!body.includes("wf-gate.mjs")) continue;
		assert.match(body, /node ~\/Workspace\/pi-ext\/wf\/wf-gate\.mjs/, `${name} names a stale wf-gate path`);
		assert.doesNotMatch(body, /\.claude\/wf/, `${name} still points at the Claude Code copy`);
	}
});

// Parsed, not regexed: an unquoted "key: value" inside a description is
// invalid YAML and pi drops the whole skill — silently, mid-pipeline.
test("explicit workflows have parsable manual-only frontmatter", () => {
	for (const name of MANUAL_ONLY_SKILLS) {
		const fm = skill(name).match(/^---\n([\s\S]*?)\n---/);
		assert.ok(fm, `${name} has no frontmatter`);
		let parsed;
		assert.doesNotThrow(() => {
			parsed = yaml.load(fm[1]);
		}, `${name} frontmatter is not valid YAML — pi will not load the skill`);
		assert.equal(parsed.name, name, `${name} frontmatter name mismatch`);
		assert.ok(parsed.description?.trim(), `${name} has no description`);
		assert.equal(parsed["disable-model-invocation"], true, `${name} must be manual-only`);
	}
});

// ── /wf — contract emitter ───────────────────────────────────────────────────

test("wf writes the spec outside the repo and lints it with wf-gate", () => {
	assert.match(wf, /~\/Workspace\/specs\/<projekt>\/<název>\/contract\.md/);
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

test("wf and wf-explain require concise STE-inspired Czech prose", () => {
	for (const name of ["wf", "wf-explain"]) {
		const body = skill(name);
		assert.match(body, /^- Používej jeden název[^.\n]*jednu věc/im, `${name} permits terminology drift`);
		assert.match(body, /^- Piš aktivně[^.\n]*běžná slova/im, `${name} does not require plain active prose`);
		assert.match(body, /^- Jedna (věta|odrážka)[^.\n]*jednu hlavní myšlenku/im, `${name} permits overloaded prose`);
		assert.match(body, /^- Vynech[^.\n]*výplňové úvodní fráze[^.\n]*opakování[^.\n]*marketingová přídavná jména/im);
		assert.match(body, /^- Stručnost nesmí odstranit[^.\n]*podmínk[^.\n]*hrani[^.\n]*pozorovatelné chování/im);
	}
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

test("every skill points at the per-contract directory layout", () => {
	for (const name of SKILLS) {
		const body = skill(name);
		if (!/Workspace\/specs/.test(body)) continue;
		assert.doesNotMatch(body, /specs\/<(project|projekt)>\/<(name|název)>\.md/, `${name} still uses the flat spec layout`);
	}
	assert.match(wf, /<název>\/contract\.md/); // the contract file inside its directory
});

test("wf-explain takes a PR as input without mutating the checkout", () => {
	const explain = skill("wf-explain");
	assert.match(explain, /gh pr view/, "no PR metadata source");
	assert.match(explain, /gh pr diff/, "no PR diff source");
	assert.match(explain, /pull\/<n>\/head/, "no read-only access to the PR head");
	assert.doesNotMatch(explain, /gh pr checkout/, "checkout would clobber local work");
	// Every explanation lands under the same specs root as contract artifacts.
	assert.match(explain, /specs\/<projekt>\/pr-<n>/, "PR explain does not land under specs");
	assert.doesNotMatch(explain, /Workspace\/diffs/, "a second output root defeats one-place discovery");
});

test("wf-explain writes markdown next to the contract, not a bundled HTML page", () => {
	const explain = skill("wf-explain");
	assert.match(explain, /explanation\.md/);
	assert.doesNotMatch(explain, /explanation\.html/);
	assert.doesNotMatch(explain, /inline JS|CSS|white-space/i); // no page-building ceremony
	assert.match(explain, /mermaid/); // diagrams the viewer renders
	assert.match(explain, /<details>/); // quiz answers stay hidden until opened
	assert.match(explain, /- \[ \]/); // checkable UAT steps
});

test("wf-explain progressively connects intuition to linked code steps", () => {
	const explain = skill("wf-explain");
	const background = explain.indexOf("**Pozadí**");
	const intuition = explain.indexOf("**Intuice**");
	const map = explain.indexOf("**Změna shora dolů**");
	const criteria = explain.indexOf("**Akceptační kritéria");
	assert.ok(background < intuition && intuition < map && map < criteria, "expected background → intuition → change map → evidence");
	assert.doesNotMatch(explain, /\*\*Kód\*\*/, "the change map replaces the duplicate code section");
	assert.match(explain, /<code>PRINCIPLE<\/code>.*<code>FLOW<\/code>.*<code>STEP<\/code>.*<code>KEPT<\/code>.*<code>VERIFY<\/code>/s);
	assert.doesNotMatch(explain, /🟪|🟦|⬜|✅/, "map badges should stay visually quiet");
	assert.match(explain, /🟡[^\n]*<code>MODIFIED<\/code>[^\n]*🟢[^\n]*<code>NEW<\/code>/, "file status needs only a small color cue");
	assert.match(explain, /soubor[^\n]*odkaz[^\n]*#L/i, "source links must target exact lines");
	assert.match(explain, /<a href="<diff-url>"><code>MODIFIED<\/code><\/a>/, "the quiet colored label should link to the diff");
	assert.doesNotMatch(explain, /diff ↗/, "a second link to the same diff is redundant");
	assert.match(explain, /blok[^\n]*jazyk/i, "snippets must use the source language");
	assert.doesNotMatch(explain, /```diff/, "readers need code, not raw diff headers");
	assert.match(explain, /<details><summary>Odpověď<\/summary><p><strong>/, "quiz answer must render markdown semantics inside raw HTML");
	const lines = explain.trimEnd().split("\n").length;
	assert.ok(lines >= 45 && lines <= 60, `wf-explain should stay at 45–60 lines, got ${lines}`);
});

test("pr-explain turns one PR into a compact linked Plannotator explanation", () => {
	const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
	assert.ok(pkg.pi.skills.includes("./skills/pr-explain"), "pr-explain is not registered");
	const explain = skill("pr-explain");
	assert.match(explain, /gh pr view/);
	assert.match(explain, /gh pr diff/);
	assert.match(explain, /gh pr checks/);
	assert.match(explain, /pull\/<n>\/head/);
	assert.doesNotMatch(explain, /gh pr checkout/);
	assert.match(explain, /<a href="<diff-url>"><code>MODIFIED<\/code><\/a>/);
	assert.match(explain, /blob\/<sha>\/<path>#Lx-Ly/);
	assert.match(explain, /language of the source file/i);
	assert.match(explain, /share\.plannotator\.ai/);
	assert.match(explain, /pr-<n>-<slug>\/explanation\.md/);
	assert.ok(explain.trimEnd().split("\n").length <= 50, "pr-explain must stay at 50 lines or fewer");
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

test("wf-run atomically claims a contract and never blindly retries a timed-out create", () => {
	const claim = wfRun.indexOf("GATE claim");
	const create = wfRun.indexOf("sc worktree create --from-file");
	assert.ok(claim !== -1 && claim < create, "wf-run must claim before create");
	assert.match(wfRun.replace(/\s+/g, " "), /timeout.*nikdy.*opak|timeout.*neopak/i);
	assert.match(wfRun, /launching|duplicate/);
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

test("wf-impl reviews before one final full gate and explains only after PR stabilization", () => {
	const review = wfImpl.indexOf("## Fáze 2 — review");
	const full = wfImpl.indexOf("## Fáze 3 — finální full gate");
	const ship = wfImpl.indexOf("## Fáze 4 — ship");
	assert.ok(review !== -1 && review < full && full < ship, "expected review → final full → ship");
	const flat = wfImpl.replace(/\s+/g, " ");
	assert.match(flat, /nikdy.*just gate.*full/i);
	assert.match(flat, /CI.*komentář.*UAT.*explain/i);
});

test("wf-impl satisfies the endgame guard rather than working around it", () => {
	assert.match(wfImpl, /neobcházej|neválči/);
	assert.match(wfImpl, /<!-- wf-spec: <name> -->/); // status discovery marker
});

test("wf-impl delegates implementation through the one spawn mechanism", () => {
	assert.match(wfImpl, /GATE agents SPEC --json/); // engine comes from the roster
	assert.match(wfImpl, /subagent_spawn/);
	assert.match(wfImpl, /harness/);
	assert.match(wfImpl, /Max \*\*3 opravná kola\*\*|Max 3 opravná kola/);
	// One delegation path only: no second, headless-session mechanism.
	assert.doesNotMatch(wfImpl, /impl-session|impl-run\.log|impl-handoff|impl-blocked/);
	assert.doesNotMatch(wfImpl, /pi -p /);
});

// ── /wf-review — the cross-model guarantee lives here ────────────────────────

test("wf-review chooses the smallest cross-model panel from standalone diff risk", () => {
	const flat = wfReview.replace(/\s+/g, " ");
	assert.match(flat, /Argument: optional/i);
	assert.match(flat, /Without (a )?contract.*diff/i);
	assert.match(flat, /docs.*1 reviewer.*behavior.*2 reviewers.*security.*3 reviewers/i);
	assert.match(flat, /PI_PROVIDER.*PI_MODEL/);
	assert.match(flat, /Without (a )?contract.*GATE agents.*verify.*do not run/i);
});

test("wf-review spawns the contract's panel in parallel with fresh contexts", () => {
	assert.match(wfReview, /GATE agents <spec> --json/);
	assert.match(wfReview, /subagent_spawn/);
	assert.match(wfReview, /IN PARALLEL/);
	assert.match(wfReview.replace(/\s+/g, " "), /never collapse them onto one model/); // the cross-model guarantee
});

test("wf-review sends claude reviewers through the native /code-review command", () => {
	const flat = wfReview.replace(/\s+/g, " ");
	assert.match(flat, /with \*\*claude\*\* harness: the prompt MUST start with `\/code-review`/);
	assert.match(flat, /codex would treat `\/review` as plain text/);
	assert.match(flat, /with \*\*pi\*\* harness:.*sem_impact.*sem_context/);
});

test("wf-review passes only after quick gate and leaves attest to the final full phase", () => {
	const flat = wfReview.replace(/\s+/g, " ");
	assert.match(flat, /GATE verify <spec> quick/);
	assert.match(flat, /wf-impl creates the review attest only after/i);
	assert.match(flat, /never create it here/i);
	assert.match(flat, /max 2 rounds/);
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
	assert.match(flat, /findings are CLAIMS/i);
	assert.match(flat, /reviewers only report/);
});

test("wf-review persists complete reports and bounds each fix batch", () => {
	const flat = wfReview.replace(/\s+/g, " ");
	assert.match(flat, /\.wf\/reviews/);
	assert.match(flat, /3–5|3-5/);
	assert.match(flat, /only one agent may edit/i);
});

// ── /wf-quick — small tasks without the ceremony ─────────────────────────

test("wf-quick escalates oversized or risky tasks to the full contract flow", () => {
	const q = skill("wf-quick");
	assert.match(q, /skill `wf`/, "no escalation target");
	assert.match(q.replace(/\s+/g, " "), /víc než 3|> ?3/i, "no criteria limit");
	assert.match(q, /migrace|auth|security/i, "risk triggers not named");
});

test("wf-quick ships a draft PR, never merges, and always ends with explain", () => {
	const q = skill("wf-quick");
	assert.match(q, /gh pr create --draft/);
	assert.ok(forbids(q, "gh pr merge") || forbids(q, "nemerguj"), "wf-quick does not forbid merging");
	assert.match(q, /skill `wf-explain`/, "explain is not part of the endgame");
});

test("wf-quick works test-first with a risk-based cross-model reviewer", () => {
	const q = skill("wf-quick");
	assert.match(q, /skill `tdd`/, "no TDD anchor");
	assert.match(q, /subagent_spawn/, "no reviewer delegation mechanism");
	// [\wà-ž] — plain \w misses Czech diacritics („jiným").
	assert.match(q.replace(/\s+/g, " "), /jin[\wà-ž]+ (model|harness)/i, "reviewer is not cross-model");
});
