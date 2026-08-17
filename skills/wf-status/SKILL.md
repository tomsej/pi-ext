---
name: wf-status
description: Show the truthful state of workflow contracts from git, gh, worktrees, and transient launch claims; offer archive, resume, reconciliation, or wf-run actions.
disable-model-invocation: true
---

# /wf-status — contract overview

GATE = `node ~/Workspace/pi-ext/wf/wf-gate.mjs`

1. Run `GATE status --json` from the repo root (human table: without --json).
   States are derived live: ready / blocked (`after`) / cycle / launching
   (claim before worktree begin) / running / duplicate / pr-open / done.
2. Present the table in Czech and add recommended actions:
   - `done` → offer to archive: `mv <adresář kontraktu> <specs dir>/_archive/`
     (each contract is a directory `~/Workspace/specs/<project>/<name>/` holding
     contract.md and its artifacts, outside any repo — no commits or PRs
     involved; derive the directory from the `file` path in the status JSON).
   - `pr-open` with unresolved threads → offer dispatching the worktree
     session via wf-run's resolve-comments action.
   - `blocked` → name unmet prerequisites; `cycle` → require contract repair.
   - `launching` → never retry create; wait for claim transition or expiry.
   - `duplicate` → list every worktree and require reconciliation to one canonical.
   - `running` with an old last commit → flag as possibly stalled; offer resume
     via wf-run. A running implementation can be inspected via `/subagents`.
   - `ready` specs → mention wf-run to launch them.
3. Take no action without the user's approval. This skill reads; it mutates
   only the approved archive commits.
