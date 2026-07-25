#!/usr/bin/env node
// wf-hook — endgame guard for contract-driven workflow worktrees.
//
// One decision function, two callers:
//   - `guard(command, cwd)` — used by the pi `wf-gate` extension via
//     `pi.on("tool_call")`, which turns a block into a model-visible reason.
//   - this file as a CLI — Claude Code PreToolUse hook (stdin JSON, exit 2 to
//     block), so a delegated Claude subagent is held to the same rules.
//
// It enforces deterministically what the wf-impl skill promises:
//   - `gh pr create` requires a receipt trail in <repo>/.wf/receipts.jsonl:
//       1. a passing FULL wf-gate verify for the active spec,
//       2. a passing verify at the CURRENT clean HEAD (quick or full),
//       3. a review attest at the CURRENT HEAD.
//   - `gh pr merge` is never allowed from a wf-conducted worktree.
// Repos without .wf/active (anything not driven by wf-impl) are untouched.
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

/** True for the two commands the endgame guard cares about. */
export function isGuardedCommand(command) {
  return /\bgh\s+pr\s+(create|merge)\b/.test(command ?? '')
}

/**
 * Decide whether a `gh pr` command may run. Returns a blocking reason string,
 * or null when the command is allowed (including every non-wf repo).
 */
export function guard(command, cwd = process.cwd()) {
  if (!isGuardedCommand(command)) return null

  let root
  try {
    root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch {
    return null // not a git repo — nothing to guard
  }

  const activeFile = join(root, '.wf', 'active')
  if (!existsSync(activeFile)) return null // not a wf-conducted worktree
  const active = readFileSync(activeFile, 'utf8').trim()

  if (/\bgh\s+pr\s+merge\b/.test(command)) {
    return `this worktree is conducted by wf-impl for ${active} and must never merge. Merging is the user's decision.`
  }

  // gh pr create — verify the receipt trail.
  const receiptsFile = join(root, '.wf', 'receipts.jsonl')
  const receipts = existsSync(receiptsFile)
    ? readFileSync(receiptsFile, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
    : []
  const forSpec = receipts.filter(r => r.spec === active)

  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length > 0
  if (dirty) return `working tree has uncommitted changes — commit them, rerun \`wf-gate verify ${active} quick\`, attest review, then create the PR.`

  const ok = r => r.result === 'pass' || r.result === 'pass-with-warnings'
  const fullPassed = forSpec.some(r => r.type === 'verify' && r.mode === 'full' && ok(r))
  const verifiedAtHead = forSpec.some(r => r.type === 'verify' && ok(r) && r.head === head && r.dirty === false)
  const attestedAtHead = forSpec.some(r => r.type === 'attest' && r.phase === 'review' && r.head === head)

  if (!fullPassed) return `no passing FULL verify recorded for ${active}. Run \`wf-gate verify ${active} full\` (phase 2) before creating a PR.`
  if (!verifiedAtHead) return `the last passing verify is stale — it was recorded at a different HEAD than ${head.slice(0, 10)}. Rerun \`wf-gate verify ${active} quick\` on the current commit.`
  if (!attestedAtHead) return `review is not attested at the current HEAD. Finish the wf-review rounds, then run \`wf-gate attest review ${active}\`.`

  return null
}

// ── Claude Code PreToolUse CLI: stdin JSON in, exit 0 allow / 2 block ────────

if (import.meta.url === `file://${process.argv[1]}`) {
  let input
  try {
    input = JSON.parse(readFileSync(0, 'utf8'))
  } catch {
    process.exit(0) // unparsable input — never break unrelated tool calls
  }
  const reason = guard(input?.tool_input?.command ?? '', input?.cwd ?? process.cwd())
  if (reason) {
    process.stderr.write(`wf-hook: BLOCKED — ${reason}\n`)
    process.exit(2)
  }
  process.exit(0)
}
