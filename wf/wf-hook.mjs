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
//       1. a passing FULL wf-gate verify at the CURRENT clean HEAD,
//       2. a review attest at the CURRENT HEAD.
//   - `gh pr merge` is never allowed from a wf-conducted worktree.
// Repos without .wf/active (anything not driven by wf-impl) are untouched.
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

// `gh` takes flags in any position and with attached values (`-Rowner/repo`),
// so pattern matching on "gh pr create" loses an arms race it cannot see. Read
// the tokens instead: the first two non-flag words after `gh` are the command.
const VERBS = { create: 'create', new: 'create', merge: 'merge' } // `pr new` is an alias of `pr create`
// Only flags that consume a following token; everything else stands alone.
const VALUE_FLAGS = new Set(['-R', '--repo', '-H', '--hostname'])

/**
 * The guarded gh verb in a command line, or null. Returns 'create' or 'merge'
 * for `gh [flags] pr [flags] create|new|merge`, and null when the invocation
 * only asks for help (it changes nothing).
 */
export function guardedVerb(command) {
  const tokens = (command ?? '').split(/\s+/).filter(Boolean)
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] !== 'gh' && !tokens[i].endsWith('/gh')) continue
    const words = []
    let help = false
    // Read to the end of this command (a shell separator starts a new one), so
    // a --help anywhere in it is seen even when it trails the subcommand.
    for (let j = i + 1; j < tokens.length && !/^(&&|\|\||;|\|)$/.test(tokens[j]); j++) {
      const t = tokens[j]
      if (!t.startsWith('-')) {
        if (words.length < 2) words.push(t)
        continue
      }
      if (t === '-h' || t === '--help') help = true
      if (VALUE_FLAGS.has(t)) j++ // its value is not a word
    }
    if (help || words[0] !== 'pr') continue
    const verb = VERBS[words[1]]
    if (verb) return verb
  }
  return null
}

function isDirectFullGate(command) {
  for (const segment of String(command ?? '').split(/&&|\|\||[;\n|]/)) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean)
    while (/^[A-Za-z_]\w*=/.test(tokens[0] ?? '')) tokens.shift()
    if (tokens[0] === 'env') {
      tokens.shift()
      while (/^[A-Za-z_]\w*=/.test(tokens[0] ?? '')) tokens.shift()
    }
    if (tokens[0] === 'bash') tokens.shift()
    if (tokens[0] === 'just' && tokens[1] === 'gate' && tokens[2]) {
      if (tokens[3] == null || tokens[3] === 'full' || tokens[3].startsWith('#')) return true
      continue
    }
    if ((tokens[0] ?? '').endsWith('/scripts/gate.sh') || tokens[0] === 'scripts/gate.sh') {
      if (tokens[1] && (tokens[2] == null || tokens[2] === 'full' || tokens[2].startsWith('#'))) return true
    }
  }
  return false
}

/** True for commands the workflow guard cares about. */
export function isGuardedCommand(command) {
  return guardedVerb(command) !== null || isDirectFullGate(command)
}

/**
 * Decide whether a `gh pr` command may run. Returns a blocking reason string,
 * or null when the command is allowed (including every non-wf repo).
 */
export function guard(command, cwd = process.cwd()) {
  const verb = guardedVerb(command)
  const directFull = isDirectFullGate(command)
  if (!verb && !directFull) return null

  let root
  try {
    root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch {
    return null // not a git repo — nothing to guard
  }

  const activeFile = join(root, '.wf', 'active')
  if (!existsSync(activeFile)) return null // not a wf-conducted worktree
  const active = readFileSync(activeFile, 'utf8').trim()

  if (directFull) {
    return `direct full gates bypass the workflow lock and receipts. Run \`wf-gate verify ${active} full\` instead.`
  }

  if (verb === 'merge') {
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
  if (dirty) return `working tree has uncommitted changes — commit them, finish review, rerun \`wf-gate verify ${active} full\`, attest review, then create the PR.`

  const ok = r => r.result === 'pass' || r.result === 'pass-with-warnings'
  const fullPassedAtHead = forSpec.some(r => r.type === 'verify' && r.mode === 'full' && ok(r) && r.head === head && r.dirty === false)
  const attestedAtHead = forSpec.some(r => r.type === 'attest' && r.phase === 'review' && r.head === head)

  if (!fullPassedAtHead) return `the passing FULL verify is missing or stale for HEAD ${head.slice(0, 10)}. Run \`wf-gate verify ${active} full\` on the current clean commit.`
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
