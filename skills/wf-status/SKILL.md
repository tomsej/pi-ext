---
name: wf-status
description: Show the truthful state of all workflow contracts (derived from git + gh, never stored) and offer next actions — archive merged specs, dispatch comment resolution, suggest wf-run. Use when the user asks where their contracts/specs stand.
---

# /wf-status — contract overview

GATE = `node ~/Workspace/pi-ext/wf/wf-gate.mjs`

1. Run `GATE status --json` from the repo root (human table: without --json).
   States are derived live: ready / blocked (with blockers) / running (branch +
   last commit age) / pr-open (PR, draft?, unresolved threads) / done (merged).
2. Present the table in Czech and add recommended actions:
   - `done` → offer to archive: `mv <spec file> <specs dir>/_archive/`
     (specs live in `~/Workspace/specs/<project>/`, outside any repo — no
     commits or PRs involved; use the `file` paths from the status JSON).
   - `pr-open` with unresolved threads → offer dispatching the worktree
     session via wf-run's resolve-comments action.
   - `running` with an old last commit → flag as possibly stalled; offer
     resume via wf-run. Mention that a pi-run implementation can be inspected
     in its worktree via `pi --session $(cat .wf/impl-session)`.
   - `ready` specs → mention wf-run to launch them.
3. Take no action without the user's approval. This skill reads; it mutates
   only the approved archive commits.
