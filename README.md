```
           ██▓███   ██▓              ▓█████ ▒██   ██▒▄▄▄█████▓
          ▓██░  ██▒▓██▒              ▓█   ▀ ▒▒ █ █ ▒░▓  ██▒ ▓▒
          ▓██░ ██▓▒▒██▒   ▄▄▄▄▄     ▒███   ░░  █   ░▒ ▓██░ ▒░
          ▒██▄█▓▒ ▒░██░   ░░░░░     ▒▓█  ▄  ░ █ █ ▒ ░ ▓██▓ ░
          ▒██▒ ░  ░░██░              ░▒████▒▒██▒ ▒██▒  ▒██▒ ░
          ▒▓▒░ ░  ░░▓░              ░░ ▒░ ░▒▒ ░ ░▓ ░  ▒ ░░
          ░▒ ░     ░▒░               ░ ░  ░░░   ░▒ ░    ░
          ░░       ░░                  ░    ░    ░    ░
                                       ░  ░ ░
```


https://github.com/user-attachments/assets/d1e5f848-176f-43cb-85bb-3d518e5b0bdd



A collection of extensions, skills, and themes for [Pi](https://github.com/badlogic/pi), the AI coding agent for the terminal.

Extensions cover everything from UI polish (custom footer, tool pills, leader-key palette) to deep workflow tooling (semantic git review, session archiving, context handoff between sessions, cmux integration). Everything is MIT licensed and designed to be installed together or individually.

> *Leader key palette → fuzzy finder → semantic review → handoff to a fresh session*

## Install

```bash
pi install git:github.com/tomsej/pi-ext
```

Or using the full URL:

```bash
pi install https://github.com/tomsej/pi-ext
```

To install the full package but only load specific extensions or skills, use package filtering in your `settings.json`:

```json
{
  "packages": [
    {
      "source": "git:github.com/tomsej/pi-ext",
      "extensions": ["extensions/leader-key"],
      "skills": []
    }
  ]
}
```

See [Pi Packages docs](https://github.com/badlogic/pi/blob/main/docs/packages.md) for more filtering options.

Requires [Pi](https://github.com/badlogic/pi) v0.37.3+.

## Extensions

### [Leader Key](extensions/leader-key/)

Press `Ctrl+X` to open a floating command palette — like Vim's which-key or Emacs' leader key. Actions are organized into single-character groups (`s` for Session, `m` for Model, `f` for Favourites, `t` for Thinking level, `l` for Labels, `c` for Contracts). Auto-discovers extension commands and merges them with built-in actions.

`c` opens the project's wf contracts, built from `wf-gate status --json`, and offers only what each contract's state allows: launch or delete a `ready` one, resume a `running` one, open the PR or dispatch its comments when a PR is up, archive once merged — plus Review (the contract folder in plannotator) in every state. Deterministic actions run on the spot; the ones needing judgement stage a prompt for the `wf-run` skill.

Includes sub-modules:
- **Model Switcher** — searchable provider → model → thinking level picker
- **Favourite Models** — quick-switch to preset model+thinking combos via `favourite-models.json`
- **Thinking Picker** — adjust reasoning effort (off, minimal, low, medium, high, xhigh)
- **Session / Label Actions** — rename, archive, label, and jump between sessions

### [Custom Footer](extensions/custom-footer/)

Replaces Pi's default footer with a compact powerline-style status bar:

```
~/project (main) │ ↑12k ↓8k $0.42 │ 42%/200k │ ⚡ claude-sonnet-4 • medium
```

Shows working directory, git branch, token usage, cost, context window utilization, and active model — all in a single line.

### [Tool Pills](extensions/tool-pills/)

Compact colored pill labels for built-in tools (`ls`, `read`, `find`, `grep`, `bash`) with collapsed output, plus Shiki-powered syntax-highlighted diffs for `write` and `edit`. Makes long tool outputs scannable without losing detail on demand.

### [Code Review](extensions/review/)

`/review` command with multiple modes: review a GitHub PR (checks it out locally), diff against a base branch, review uncommitted changes, review a specific commit, or provide custom review instructions. Supports project-specific `REVIEW_GUIDELINES.md`.

When `pi-sem` is also loaded, `/review` nudges the agent toward a semantic workflow:
- `sem_diff` for a one-shot overview of changed entities
- `sem_impact` for blast radius / affected tests on risky entities
- `sem_context` for focused understanding of suspicious functions or classes
- raw `git diff` / `read` for final line-level evidence

Derived from [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff) (Apache 2.0).

### [pi-sem](extensions/pi-sem/)

Semantic git tooling powered by [sem](https://github.com/Ataraxy-Labs/sem). Exposes entity-aware tools — `sem_diff`, `sem_impact`, `sem_context`, `sem_log`, `sem_entities`, `sem_blame`, and `sem_eval` — so the agent can reason about functions, classes, and config properties instead of raw line hunks.

Includes a local evaluator to compare `sem diff` vs `git diff` on the same selection:

```bash
npm run sem:evaluate -- --staged
npm run sem:evaluate -- --from origin/main --to HEAD
```

### [pi-vcc](extensions/pi-vcc/)

Vendored copy of [sting8k/pi-vcc](https://github.com/sting8k/pi-vcc) (MIT): algorithmic, LLM-free conversation compaction plus `vcc_recall`. Local addition: Czech-aware goal/preference extraction (diacritics-insensitive, Czech acknowledgements like "ano prosim" are no longer mistaken for the session goal).

### [Tool Trim](extensions/tool-trim/)

Deactivates tools that cost more prompt tokens than they return: `hypa_read`/`hypa_grep`/`hypa_find`/`hypa_ls` (duplicate Pi builtins and pi-fff; `hypa_shell` stays) and `sem_diff`/`sem_eval`/`sem_log`/`sem_blame` (measured 1.23-1.44x more tokens than raw `git diff`; `sem_impact` and `sem_context` stay). MCP aliases are dropped as well.

### [Session Snap](extensions/session-snap/)

Session archiver and cleaner. `/snap` scans all sessions, classifies them (delete trivial ones, archive old ones, keep active ones), and lets you review before executing. `/archive` browses archived sessions with search, restore, and permanent delete.

### [Session Query](extensions/session-query/)

Gives the model a tool to query previous pi sessions for context, decisions, or code changes. Uses an uncapped VCC summary (~9K tokens) by default, with optional `detailed: true` mode (~80K tokens) for queries that need exact file contents or tool output. Works with the handoff extension to let a new session look up details from its parent.

### [Handoff](extensions/handoff/)

`/handoff <goal>` transfers context to a fresh pi session running in a new cmux tab. Uses pi-vcc's algorithmic compaction (no LLM calls) to build a summary, plus algorithmic extraction of git state, working files, and language detection. Includes current tasks from pi-tasks. The new session starts with the summary + goal as its initial prompt.

### [Permissions](extensions/permissions/)

Three-mode permission system: `yolo` (everything allowed), `safe` (rule-based checks, asks for unknown bash commands), `read-only` (no repo/home writes, built-in edits restricted to `/tmp`, bash restricted to safe read-only commands). `/mode [yolo|safe|read-only]` to switch. Rules merge project (`.agents/permissions.json`) → global (`~/.pi/agent/permissions.json`) → built-ins.

### [cmux](extensions/cmux/)

Native integration with [cmux](https://github.com/badlogic/cmux). Context-aware notifications via the cmux socket API, sidebar status pills (model, state, thinking, tokens), and custom tools for the model (browser, workspace, notify). Silent no-op when not running inside cmux.

### [Superconductor](extensions/superconductor/)

Native integration with [Superconductor](https://superconductor.dev) via the `sc` CLI. Footer pill with the Superconductor-owned target branch and diff size, a `superconductor_worktree` tool for the model (status, diff, target branch, list/create worktrees), and commands (`/sc-fork`, `/sc-worktree`). Silent no-op when not running inside Superconductor.

### [Ask User Question](extensions/ask-user-question/)

Registers an `ask_user_question` tool the model uses to ask 1–4 structured clarifying questions (with 2–4 options each) instead of asking in plain text. Interactive UI with optional multi-select and short header labels for a tab bar.

### [wf-gate](extensions/wf-gate/)

Endgame guard for the `wf` contract workflow. In a worktree conducted by the `wf-impl` skill, `gh pr create` is blocked until `.wf/receipts.jsonl` proves a passing full gate, a passing verify at the current clean HEAD, and a review attest at that HEAD; `gh pr merge` is always blocked. The decision lives in [`wf/wf-hook.mjs`](wf/wf-hook.mjs), shared with the Claude Code `PreToolUse` hook so delegated Claude subagents obey the same rules. Repos without `.wf/active` are untouched.

## Workflow (`wf`)

Contract-driven pipeline: discuss → `/wf` writes a contract to `~/Workspace/specs/<project>/<name>/contract.md` (outside any repo, one directory per contract so its explanation and reports sit beside it) → `wf-run` launches one managed worktree per contract → the `wf-impl` conductor delegates implementation, review, PR, UAT and explanation. Phase transitions are decided by exit codes from [`wf/wf-gate.mjs`](wf/wf-gate.mjs), never by an agent's claim.

```
wf-gate check  <spec.md>              lint the contract's frontmatter
wf-gate agents <spec.md> [--json]     resolve the agent roster (impl/conductor/review)
wf-gate verify <spec.md> quick|full   run the verification gates, write receipts
wf-gate status [--dir d] [--json]     derive spec states from git + gh
wf-gate begin|attest review <spec.md> arm the guard / record the review phase
```

Skills are prose, so they get behavioural evals rather than assertions about their wording: `npm run eval:wf` drops a headless agent into a throwaway repo with one skill and checks what it actually produced — a contract that passes `wf-gate check`, written outside the repo, with no code implemented and no invented test runner. It costs real tokens and ~10 minutes, so it runs on demand, not in `npm test`. Its purpose is to make shortening the skills measurable: cut, re-run, and the pass rate says whether words or guarantees were removed.

A contract names agents from a roster instead of repeating models: `impl: sol`, `review: [{security: codex}]`. Builtin names — `opus`, `sol`, `terra`, `glm` (harness pi), `cc` (Claude Code), `codex` (Codex CLI); `agents:` in the frontmatter overrides or extends them. `wf-review` spawns each round's panel in parallel via `subagent_spawn`, and the lint rejects a reviewer sharing the implementer's harness+model.

## Skills

| Skill | Description |
|-------|-------------|
| [commit](skills/commit/) | Conventional Commits-style `git commit` — infers type, scope, and summary from the diff |
| [wf](skills/wf/) | Turn the discussion into a workflow contract (Czech body + machine-readable frontmatter), linted by `wf-gate check` |
| [wf-run](skills/wf-run/) | Reconcile contract state, plan the DAG, launch one pi conductor worktree per selected contract |
| [wf-impl](skills/wf-impl/) | Conductor inside the worktree — implement, gate, review, draft PR, UAT, explain |
| [wf-review](skills/wf-review/) | Cross-model review rounds via `subagent_spawn`, verified findings, quick gate, attest |
| [wf-uat](skills/wf-uat/) | UAT against a disposable instance, Czech manual steps for the user |
| [wf-explain](skills/wf-explain/) | Rich Czech explanation of a change as a standalone interactive HTML file |
| [wf-status](skills/wf-status/) | Truthful state of all contracts (derived from git + gh) plus next actions |
| [sem](skills/sem/) | Entity-aware change analysis workflow — prefer `sem_context` and `sem_impact`, use `sem_diff` selectively for summaries and reviews |
| [session-query](skills/session-query/) | Guide for querying past pi sessions via the `session-query` tool |
| [visit-webpage](skills/visit-webpage/) | Fetch and extract content from a URL as markdown (via Jina Reader), or download images |
| [web-search](skills/web-search/) | Lightweight web search via the Jina Search API — no browser required |

## Themes

| Theme | Description |
|-------|-------------|
| [catppuccin-mocha](themes/catppuccin-mocha.json) | Dark theme based on [Catppuccin Mocha](https://github.com/catppuccin/catppuccin) |

## Configuration

Most extensions work out of the box. Notable config:

- **Leader Key** — edit `extensions/leader-key/favourite-models.json` to set your favourite model presets
- **Permissions** — edit `~/.pi/agent/permissions.json` (global) or `.agents/permissions.json` (project) to add bash rules; use `/mode` to switch modes
- **pi-sem** — `npm install` should fetch the optional `@ataraxy-labs/sem` wrapper automatically; otherwise install `sem` globally with Homebrew or Cargo

## License

[MIT](LICENSE) © tomsej
