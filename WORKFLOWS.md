# Spec-driven workflow: OpenSpec + taskflow

A reproducible pipeline for turning an idea into implemented, verified code inside
Pi. **OpenSpec** owns the spec (propose → specs → tasks → archive); **taskflow**
(`pi-taskflow`) owns the gated implement loop that turns those tasks into code and
only reports back when build/test and an acceptance gate pass.

Both run natively on Pi. The glue is deliberately thin — two OpenSpec CLI calls
(`instructions apply --json`, `validate --strict`) and file pre-reading — so if you
ever drop taskflow, the specs and tasks stay useful and you rewrite only the
orchestration.

## One-time setup

Already done in this repo, but to reproduce elsewhere:

```bash
npm i -g @fission-ai/openspec@latest      # OpenSpec CLI (needs v1.2+ for Pi + JSON)
openspec init --tools pi                  # scaffolds openspec/ + /opsx-* prompts + skills into .pi/
pi install npm:pi-taskflow                # taskflow extension → /tf commands + `taskflow` tool
```

**Install the flows user-wide** so they work in every repo, not just pi-ext
(taskflow resolves saved flows from project `.pi/taskflows/` first, then user
`~/.pi/agent/taskflows/`):

```bash
npm run flows:install     # in pi-ext — copies .pi/taskflows/*.json to ~/.pi/agent/taskflows/
```

Re-run it whenever the flow definitions change here. Two session caveats:
`/tf:<name>` shortcuts register at **session start** — after installing new
flows, `/reload` (or restart) any running Pi session. And the flows shell out to
the `openspec` CLI with the session's cwd, so run them from the repo that
contains the `openspec/` root.

Optionally run `/tf init` in a Pi session to map taskflow's model roles
(`{{fast}}`, `{{strong}}`, …) to specific models — **not required**: agents fall
back to your Pi default model (Opus 4.8 here) when roles are unset.

## The loop, end to end

1. **Propose** — in a Pi session: `/opsx-propose "add a foo command that …"`.
   OpenSpec (via the agent) writes `openspec/changes/<id>/` with `proposal.md`,
   spec deltas under `specs/`, and a `tasks.md` checklist. Review and edit it —
   this is where you spend your judgment. Nothing is phase-locked; edit artifacts
   any time. (`/opsx-*` commands are pure OpenSpec — installed by `openspec init`,
   fully independent of taskflow.)

   **The change id** is the folder name under `openspec/changes/` — the agent
   picks a kebab-case id (e.g. `add-foo-command`) and reports it. `openspec list`
   shows all active changes with task progress if you forget.

2. **Implement** — `/tf:openspec-implement change=<id>` (or the per-group
   `/tf:openspec-implement-loop`). taskflow implements the tasks, runs your
   build/test command, validates the spec, fans out a **multi-angle, multi-model
   review panel**, consolidates it into an arbiter verdict, and on `BLOCK` a
   **fix agent reads the full verdict**, repairs the findings, and re-checks.
   Only the final summary returns to your context — intermediate transcripts
   stay in the runtime.

3. **Human review** — `/plannotator-review` opens the working-tree diff in
   plannotator's code-review UI: annotate lines, switch diff views, send feedback
   back to the agent. This is the human gate before specs get rewritten.

4. **Archive** — when you're satisfied: `openspec archive <id>`. Delta specs
   merge into `openspec/specs/` (the source of truth) and the change moves to
   `openspec/changes/archive/`.

## The two flows

Both live in `.pi/taskflows/` and take the same args.

| | `openspec-implement` | `openspec-implement-loop` |
|---|---|---|
| Shape | One `implement` phase for the whole change, then panel → verdict → informed fix round → re-check | One task **group** per iteration (`## N.` sections in tasks.md), **fresh context each group**, then the same panel → verdict → fix tail — 80 tasks in 10 groups = 10 agents, not 80 |
| Best for | Small/medium changes (a handful of tasks) | Large multi-task changes where one context would degrade |
| Cost cap | `budget.maxUSD: 10` | `budget.maxUSD: 15` |
| Mechanism | verdict→fix chain (the fix agent receives the arbiter's full report via `{steps.verdict.output}`) | `loop` + `reflexion` for the implement stage (each round sees why the last fell short), then the same verdict→fix chain |

**Args (both):**

- `change` (required) — the OpenSpec change id under `openspec/changes/<id>`.
- `verify` (optional) — the shell command for the build/test gate. Default
  `npm run test:pi-sem 2>&1 | tail -30` suits **this** repo. **Override it per
  project**, e.g.:

  ```
  /tf:openspec-implement change=add-foo verify="npx tsc --noEmit && npm test"
  ```

### Phase map (both flows)

```
load (script: openspec instructions apply --json)
      │
implement / task-loop  (executor-code — reads proposal, design, tasks, spec deltas)
      │
      ├── build-test    (script: your verify command)
      ├── spec-validate (script: openspec validate --strict)
      └── diff          (script: git status + git diff HEAD)
                │
      ┌─────────┼──────────────┐            ← review panel, runs in parallel
   spec ×2      kiss ×2         security ×2
(Opus+Sonnet)  (GPT+GLM)     (Opus recall + GPT precision)
      └─────────┼──────────────┘
                │
verdict  (final-arbiter — consolidates all evidence into ONE report,
      │   ends with VERDICT: PASS/BLOCK + numbered fix list)
      │
fix      (executor-code — reads the FULL verdict; on PASS touches nothing,
      │   on BLOCK repairs every listed finding and runs verify until green)
      │
recheck  (script: verify again + git status)
      │
summary  (doc-writer — final; suggests /plannotator-review + openspec archive,
          or a fresh /tf:openspec-review pass if fixes were applied)
```

### Review panel (multi-angle, two models per angle)

dev-loops-style review angles, each run by **two models from different
families**. Model assignments follow a benchmark/practitioner research pass
(2026-07-04); the core finding: reviewer finding-overlap is only ~7%, so a
second model per angle adds real coverage, and model families have measurably
different precision/recall profiles.

| Phase | Angle | Model | Why (evidence) |
|---|---|---|---|
| `review-spec-claude` | spec compliance — every requirement/scenario has implementation evidence (file:line) | `anthropic/claude-opus-4-8` | best evidence-tracking + calibrated refusal to wave flawed work through; Claude judges measurably *under*-rate their own family, so reviewing Opus-written code is not a rubber-stamp risk |
| `review-spec-sonnet` | spec compliance (second opinion) | `anthropic/claude-sonnet-5` | strong reviewer at a lower tier than Opus; same-family risk is acceptable because Claude judges under-rate their own family (Gemini would add family diversity, but isn't available in this setup) |
| `review-kiss-gpt` | KISS/YAGNI/DRY | `openai-codex/gpt-5.5` | only model with published evidence of scope discipline — "focused on the actual failure mode rather than drifting into speculative redesign" (CodeRabbit) |
| `review-kiss-glm` | KISS/YAGNI/DRY (second opinion) | `zai/glm-5.2` | decisive, concise, front-loads hard calls; ~1/6 frontier cost; #1 open-weights model |
| `review-sec-claude` | security, recall-tuned | `anthropic/claude-opus-4-8` | best recall + cross-file reasoning (Anthropic 0-day work: 500+ validated OSS vulns); prompt says "optimize for recall" |
| `review-sec-gpt` | security, precision-tuned | `openai-codex/gpt-5.5` | lowest false-positive rate of the frontier (15% vs Opus 36% white-box FPR); prompt says "optimize for precision" — the pair is the detect-then-verify pattern every source converges on |
| `verdict` | arbiter — consolidates all six reviews + build/test + diff into one report | `openai-codex/gpt-5.5` | best resistance to confident-but-wrong assertions (PARROT: 4% capitulation vs ~11% Claude), low sycophancy at high decisiveness, strict verdict-format compliance — the fix stage keys off the final `VERDICT:` line |
| `fix` | reads the full verdict; repairs confirmed findings, disputes wrong ones, no-op on PASS | pi default (Opus) | needs write access and the same caliber as the implementer; the verdict text is its complete work order |

Kimi K2.7 was dropped from the panel entirely: last place in the one
independent review eval it appeared in, documented lineage sycophancy, no
third-party verification of vendor benchmarks.

Notes:

- **Changing models**: edit the phase's `"model"` field in the flow JSON
  (`provider/model-id` form; the model must work in your pi setup — check
  providers in `~/.pi/agent/auth.json` and `enabledModels` in settings).
- **Adding an angle** (dry, srp, docs, …): copy one `review-*` phase, change the
  id/task/model, and add the new id to the verdict phase's `dependsOn` plus a
  `{steps.<id>.output}` section in the verdict task.
- **Why no taskflow `gate` + `onBlock: retry`?** Verified in taskflow-core
  0.1.5's runtime: on BLOCK the gate re-runs its upstream phases with their
  **original prompts** — the block reasons are *not* injected (the skill docs'
  "re-interpolation" claim has no implementation). A blind re-run of an
  implement phase whose tasks are all checked off is a no-op, so gate-retry
  would just re-bill the panel for nothing. The verdict→fix chain passes
  feedback explicitly through `{steps.verdict.output}` — by construction.
- Review phases are `optional: true` and read-only (`tools: read/grep/ls`): a
  missing/failing model degrades to a skipped review instead of killing the run.
  The arbiter is told to flag skipped reviews, not treat silence as approval,
  and to explicitly adjudicate when the two reviewers of an angle disagree.
- Reviewers get the diff inline; untracked (new) files show only in the status
  list, so reviewer prompts tell them to read those files themselves.
- Model assignments go stale — models ship monthly. Re-check the table when a
  major model in the panel gets replaced by its provider.

## Command reference

**Start with `/spec`** — the `openspec-flow` extension (this repo,
`extensions/openspec-flow/`) fronts the whole pipeline: it lists changes with
task progress, recommends the right implement flow by change size (≤4 tasks →
whole-change, more → per-group loop), and stages the chosen command in the
editor so you can tweak args (e.g. `verify="…"`) before pressing Enter. It also
offers plannotator review, validation, and (for completed changes) archiving.

| Command | What |
|---|---|
| `/spec` | Interactive front-door: pick change → implement / review / validate / archive |
| `/opsx-propose "<idea>"` | Create a change (proposal + specs + tasks) |
| `/opsx-explore "<question>"` | Investigate before proposing |
| `/opsx-apply` | Interactive, agent-driven implement (no gates) — good for tiny changes |
| `/opsx-sync` | Sync spec deltas into main specs |
| `/opsx-archive` | Archive a completed change |
| `/tf:openspec-implement change=<id> [verify="…"]` | Gated implement, whole-change |
| `/tf:openspec-implement-loop change=<id> [verify="…"]` | Gated implement, one task group at a time |
| `/tf:openspec-review change=<id> [verify="…"]` | Gates + fix: tests + panel + verdict + informed fix round on current working tree |
| `/plannotator-review` | Human code-review UI over current git changes (before archive) |
| `/tf verify` | Static-check a flow (cycles, refs, contracts) — zero tokens |
| `/tf runs` / `/tf resume <runId>` | List runs / resume a paused or failed run |
| `/tf peek <runId> [phaseId]` | Inspect a run's intermediate outputs |
| `openspec list [--json]` | List changes + task progress |
| `openspec instructions apply --change <id> --json` | Context files + pending tasks (what `load` runs) |
| `openspec validate <id> --strict` | Structural spec validation |

## When to use which

- **Tiny change, want to watch it live** → `/opsx-apply` in the session. No flow
  overhead, you can steer mid-stream. **Then run `/tf:openspec-review`** — an
  interactive session can get compacted mid-implementation, and whatever
  validation diligence lived in that context silently disappears with it. The
  standalone gate flow doesn't depend on session state at all.
- **Normal change, want it verified unattended** → `/tf:openspec-implement`.
- **Large change, many tasks** → `/tf:openspec-implement-loop`.
- **Gates + fix, no implementation** → `/tf:openspec-review` (`p` in `/spec`):
  tests + spec validation + the same 6-reviewer panel + arbiter verdict against
  the current working tree, then a fix agent repairs confirmed findings (reading
  the full verdict) and re-checks. On a clean PASS nothing is touched. Failing
  tests are a finding for the arbiter, not a reason to abort. For another full
  panel pass after fixes, just run it again.

## Notes & gotchas

- **`verify` default fails on repos without `test:pi-sem`.** It's set for this
  repo. On any other project, pass `verify=` or edit the flow's arg default.
- **The verdict must end with an explicit `VERDICT:` line** — the fix stage keys
  off it (a report without it reads as nothing-to-fix). The arbiter prompt
  demands it and says "if uncertain, BLOCK". A false PASS is the one genuinely
  costly failure mode here; everything else just costs another run.
- **The implement prompt forbids weakening tests** and tells the agent to *stop
  and report* a genuine spec gap rather than silently invent behavior — so the
  spec stays the source of truth, not post-hoc documentation.
- **Detached/headless runs auto-reject `approval` phases.** Neither flow uses
  approval; if you add one, don't run detached.
- **Archiving is manual** (`openspec archive <id>`) — deliberately, so a human
  confirms before specs are rewritten. Run `/plannotator-review` on the diff
  first as the human gate.
- **Runtime state is gitignored, definitions are versioned.** `.pi/taskflows/*.json`,
  `.pi/prompts/opsx-*`, and `.pi/skills/openspec-*` are committed;
  `.pi/taskflows/runs/`, `.pi/tasks/`, sessions, etc. stay ignored (see `.gitignore`).

## Ideas for later

- **Test-first gate**: add a phase before implementation that generates failing
  tests from the change's GIVEN/WHEN/THEN scenarios, plus a `script` gate asserting
  they fail (red) — then the acceptance gate becomes objective (tests are truth,
  not the reviewer's opinion). Add a `git diff --stat` guard so the agent can't
  "pass" by weakening those tests.
- **Batch mode**: `openspec list --json` → queue changes → run flows detached
  overnight → review branches in the morning. Try it only after a few weeks of
  manual runs, once you trust how often the gates lie.
