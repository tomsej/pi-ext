---
name: wf-review
description: Review a change with an optional workflow contract using deterministic scope, adaptive cross-model reviewers, verified findings, fixes, and a gate. Use standalone or from wf-impl.
disable-model-invocation: true
---

# /wf-review

Argument: optional absolute path to a contract. Without a contract, review the
current diff. You own the review: reviewers only report; verify every finding
and delegate fixes sequentially. Never edit production code yourself.

GATE = `node ~/Workspace/pi-ext/wf/wf-gate.mjs`

## 1. Scope

TARGET = `sc worktree status --json` → `target_branch` (fallback `main`). Run
`ocr delegate preview --from TARGET --to HEAD`, restore excluded product files
such as `.md` when they carry the change or the contract names them, then load
rules with `ocr delegate rule <files>`. Keep lockfiles and generated code out.

Write `.wf/review-packet.md`: contract path or “no contract”, refs, `merge_base`,
final files, diff stats, and rules. Every reviewer gets it. Without `ocr`, use
`git diff --stat TARGET...HEAD` and disclose the fallback.

## 2. Pick the panel

With a contract, use its exact `GATE agents <spec> --json` → `review` plan;
never infer models from YAML. Without a contract, inspect the packet and use:

- docs/tests-only with no runtime behavior or sensitive config: 1 reviewer;
- behavior changes: 2 reviewers for correctness and tests/edge cases;
- security, auth, permissions, secrets, migrations, data integrity, concurrency,
  public APIs, or a large cross-module diff: 3 reviewers for correctness, the
  relevant risk, and impact/tests.

Read `PI_PROVIDER` and `PI_MODEL`. Reviewers must differ by model from the
current session and each other. Prefer `claude`/`fable`,
`codex`/`gpt-5.6-sol`, `pi`/`zai/glm-5.2`, then
`pi`/`anthropic/claude-opus-5`. Skip matching or unavailable models, record the
fallback, and never add reviewers merely because more models exist.

## 3. Review — max 2 rounds

Run each round's reviewers IN PARALLEL with `subagent_spawn`, each in a fresh
context; never collapse them onto one model. Give each the packet, focus,
read-only mode, and these rules:

- with **claude** harness: the prompt MUST start with `/code-review`; codex would
  treat `/review` as plain text, so other harnesses get no slash prefix;
- with **pi** harness: use `sem_impact` for blast radius/tests and `sem_context`;
- findings are CLAIMS: severity, `file:line`, problem, and impact; with a
  contract also cite the violated criterion or scope;
- Critical/High = bug, security, data loss, or uncovered criterion; Medium =
  performance or missing error handling with context; discard Low unless useful;
- project rules are the checklist; read-only means never `gh pr create` or
  `gh pr merge` — for the codex harness this sentence is the only guard.

Save raw outputs to `.wf/reviews/<HEAD>/round-<N>/<focus>.md`; a missing planned
report means incomplete review. Verify every finding against the code and
explain rejections. Batch legitimate findings by **3–5** and delegate them
sequentially; only one agent may edit at a time. Each batch ends with a commit
and targeted test. Send repeatable mechanical findings to `review-guards`;
never edit skills, the workflow pipeline, or AGENTS.md yourself.

Run round 2 only after fixes and only on changed areas. With a contract use its
planned round; standalone use one best-matching reviewer.

## 4. Result

With a contract, `GATE verify <spec> quick` must pass (max 3 repair attempts per
hypothesis). Without a contract, do not run `GATE agents` or `verify`; after
fixes run targeted project tests. An unresolved finding or missing report means
FAILED; otherwise PASS. wf-impl creates the review attest only after its final
full gate; never create it here.

Report fixes with commits, rejections with reasons, planned/used reviewers and
model fallbacks, artifact paths, scope stats, and gate/test results.
