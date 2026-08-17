---
name: review-guards
description: Codify project review rules as deterministic guards — ast-grep structural rules (with TDD-style rule tests) for mechanical checks, REVIEW_GUIDELINES.md for qualitative ones, wired into the project gate / wf verify. Use when the user wants to define review rules, turn a repeated review finding into a lint/guard, or set up ast-grep in a project.
disable-model-invocation: true
---

# /review-guards — turn review rules into guards

Goal: a review rule stated once should never depend on a reviewer's memory
again. Mechanical rules become ast-grep guards (exit code decides); everything
else becomes written guidance reviewers receive automatically.

## 1. Triage each rule

| Rule kind | Destination |
|---|---|
| Structural / mechanical ("no `console.log` outside logger", "every handler calls auth middleware", "no raw SQL in controllers") | ast-grep rule |
| Type-aware or flow-sensitive | existing linter / tsc config — do NOT emulate a type checker with patterns |
| Qualitative (naming taste, architecture judgement) | `REVIEW_GUIDELINES.md` in repo root — the `/review` extension and review subagents pick it up |

If a rule can't name a concrete AST shape, it is not an ast-grep rule.

## 2. Project setup (once)

```
sgconfig.yml          # ruleDirs: [.ast-grep/rules], testConfigs: [{testDir: .ast-grep/tests}]
.ast-grep/rules/      # one YAML per rule
.ast-grep/tests/      # one test per rule: valid + invalid snippets
```

Requires `ast-grep` on PATH (brew package, already in chezmoi packages).

## 3. Write each rule TDD-style

1. Write the test FIRST: `.ast-grep/tests/<id>-test.yml` with `valid:` (must not
   match) and `invalid:` (must match) snippets — the invalid one is the exact
   code from the review finding that motivated the rule.
2. Write `.ast-grep/rules/<id>.yml`: `id`, `language`, `severity: error`,
   `message` (say WHY, not just what), `rule:` (pattern/kind/inside…).
3. `ast-grep test --skip-snapshot-tests` — must print `Running N tests` with
   your test INCLUDED and pass. Pitfall: a test whose rule id does not exist
   is silently skipped (0 passed, exit 0) — the count is the proof the test
   ran. A wrong rule fails loudly (non-zero exit). Optionally pin snapshots
   with `ast-grep test -U` and drop the flag afterwards.
4. `ast-grep scan` on the repo: every existing hit is either fixed now or the
   rule's scope is narrowed — never ship a guard the codebase already violates.

`severity: error` blocks (scan exits non-zero); `warning` reports only.

## 4. Guard candidates — what is worth codifying

Distilled from the ast-grep catalog, coderabbitai/ast-grep-essentials and
semgrep-rules taxonomies. Offer these when the user asks "what guards should
this project have?":

- **Security (use the pack below first)**: hardcoded secrets (JWT/session/DB
  keys), weak crypto (DES/RC4/ECB, short RSA), cookies missing
  httponly/secure/samesite, JWT decode without verify, bind to 0.0.0.0,
  debug mode in prod code, insecure deserialization, XXE flags.
- **Correctness traps**: `await` inside `Promise.all([...])`, JSX `cond &&
  <X/>` short-circuit with non-boolean, Go `defer f()` evaluating too early,
  empty catch blocks. (Flow/type-sensitive ones — floating promises — belong
  to the typed linter, not patterns.)
- **Project conventions**: console vs logger (allow in catch), layer
  boundaries ("no DB/fetch in handlers/components"), import hygiene (no
  barrel imports, forbidden deep imports), deprecated internal APIs during
  migrations (rule doubles as `ast-grep scan --rewrite` codemod).
- **Agent/LLM code** (this codebase!): secrets interpolated into logs/prompts,
  LLM output flowing into `exec`/`eval`/shell, tool dispatch without
  allowlist, unbounded agent loops without budget.

### Starter packs — vendor before writing

- `coderabbitai/ast-grep-essentials` — security rules for 10+ languages, with
  tests. Plain ast-grep project: clone and `ast-grep scan --config
  <pack>/sgconfig.yml .`, or copy the relevant `rules/<lang>/security/*.yml`
  (MIT) into `.ast-grep/rules/`.
- `raxITlabs/agent-security-review` — 58 rules for AI-agent code (prompt
  injection → sinks, MCP tool poisoning, denial-of-wallet).

Write a custom rule only when no pack covers it.

## 5. Adoption rules — why guards die

Established findings (Tricorder/Google CACM 2018, Facebook CACM 2019, Johnson
et al. ICSE 2013): developers abandon noisy tools — keep effective false
positives under ~10%; findings must arrive at review time, not in batch
reports after merge (fix rates collapse); every finding must be actionable
(message says why + what instead, next to the code).

In practice: `severity: error` only for near-zero-FP rules — everything else
starts as `warning` and is promoted after it survives real diffs without
noise. One noisy guard erodes trust in all of them: fix or delete it the
week it annoys, never "later".

## 6. Wire into the gate

One source of truth: add `ast-grep scan` (and `ast-grep test` if rules exist)
to the project's existing gate script / task runner — CI and wf both call
that. In a wf contract it is just a quick check:

```yaml
verify:
  quick:
    - {id: guards, kind: hard, command: "ast-grep scan", timeoutMs: 60000}
```

## Report

Rules created (id → what it guards), triage of rejected rules (where they went
instead), scan status on the current tree, gate wiring. Verification for the
user: `ast-grep test && ast-grep scan` — exit 0.
