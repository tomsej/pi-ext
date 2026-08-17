#!/usr/bin/env node
// wf-gate — deterministic gate runner for contract-driven workflows.
//
// Subcommands:
//   check  <spec.md>                    lint contract frontmatter
//   agents <spec.md> [--json]           resolve the contract's agent roster
//   claim|release-claim <spec.md>        serialize worktree launch
//   verify <spec.md> preflight|quick|full run verification gates
//   status [--dir specs] [--json]       derive live spec states
//
// The spec is a markdown file with YAML frontmatter; see wf-gate.test.mjs and
// the /wf skill for the schema. This script is the only non-model piece of the
// workflow: exit codes here are authoritative, agent self-reports are not.
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, appendFileSync, rmSync, realpathSync, renameSync, statSync } from 'node:fs'
import { spawn, execFileSync } from 'node:child_process'
import { basename, join, resolve, dirname } from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const yaml = require('js-yaml')

const COMMAND_KINDS = new Set(['hard', 'eval', 'perf'])
const KINDS = new Set(['hard', 'eval', 'perf', 'judge'])
const HARNESSES = new Set(['pi', 'claude', 'codex'])
// Judges run headless and must print JSON on stdout: pi and claude both do,
// verified. Codex is deliberately out until its headless contract is proven.
const JUDGE_HARNESSES = new Set(['pi', 'claude'])
const DEFAULT_JUDGE = 'opus'
const EFFORTS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])

// Builtin agent roster. A contract names agents (`impl: sol`) instead of
// repeating harness/model/effort triples; `agents:` in the frontmatter
// overrides or extends this per contract. Shape matches subagent_spawn's
// parameters so a skill can pass a resolved entry straight through.
const BUILTIN_AGENTS = {
  opus: { harness: 'pi', model: 'anthropic/claude-opus-5', effort: 'high' },
  sol: { harness: 'pi', model: 'openai-codex/gpt-5.6-sol', effort: 'high' },
  terra: { harness: 'pi', model: 'openai-codex/gpt-5.6-terra', effort: 'high' },
  glm: { harness: 'pi', model: 'zai/glm-5.2', effort: 'medium' },
  cc: { harness: 'claude', model: 'fable', effort: 'high' },
  codex: { harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' },
}

/**
 * Resolve the contract's agent roster: builtins overlaid with `agents:`, plus
 * the impl/conductor/review references turned into concrete entries. Unknown
 * references surface as `errors` so both `check` and `agents` report them the
 * same way instead of each guessing.
 */
function resolveAgents(fm) {
  const roster = { ...BUILTIN_AGENTS }
  for (const [name, def] of Object.entries(fm?.agents ?? {})) roster[name] = def
  const errors = []

  const lookup = (name, where, { required = true } = {}) => {
    if (name == null) {
      // A forgotten value (`- smoke:` in YAML) must not silently empty a round.
      if (required) errors.push(`${where}: no agent named — every role and review focus needs one`)
      return null
    }
    if (typeof name !== 'string') {
      errors.push(`${where}: agent reference must be a roster name, got ${JSON.stringify(name)}`)
      return null
    }
    const def = roster[name]
    if (!def) {
      errors.push(`${where}: "${name}" is not in the agent roster (known: ${Object.keys(roster).sort().join(', ')})`)
      return null
    }
    if (!HARNESSES.has(def.harness)) {
      errors.push(`agents.${name}: harness must be one of ${[...HARNESSES].join('/')}, got ${def.harness ?? 'nothing'}`)
      return null
    }
    // pi runs headless with an explicit `--model provider/id`; an inherited
    // model would silently depend on the machine's pi settings.
    if (!def.model) {
      errors.push(`agents.${name}: needs an explicit model (harness ${def.harness} never inherits one)`)
      return null
    }
    if (def.effort && !EFFORTS.has(def.effort)) {
      errors.push(`agents.${name}: effort must be one of ${[...EFFORTS].join('/')}, got ${def.effort}`)
      return null
    }
    return { name, harness: def.harness, model: def.model, ...(def.effort ? { effort: def.effort } : {}) }
  }

  const impl = lookup(fm?.impl, 'impl', { required: fm?.impl !== undefined })
  const conductor = lookup(fm?.conductor, 'conductor', { required: false })
  // The conductor IS the worktree's pi session (sc worktree create --provider
  // pi --model …), so it can only be a pi-harness agent.
  if (conductor && conductor.harness !== 'pi') {
    errors.push(`conductor: "${conductor.name}" runs on harness ${conductor.harness}, but the conductor is the worktree's pi session — pick a pi agent`)
  }

  const rounds = Array.isArray(fm?.review) ? fm.review : []
  const review = rounds.map((round, i) =>
    Object.entries(round ?? {}).map(([focus, name]) => {
      const def = lookup(name, `review[${i}].${focus}`)
      return def ? { focus, ...def } : null
    }).filter(Boolean),
  )

  return { roster, impl, conductor, review, errors, lookup }
}

function fail(msg) {
  process.stderr.write(`wf-gate: ${msg}\n`)
  process.exit(2)
}

function parseSpec(file) {
  const raw = readFileSync(file, 'utf8')
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!m) fail(`${file}: missing YAML frontmatter`)
  let fm
  try {
    fm = yaml.load(m[1])
  } catch (e) {
    fail(`${file}: frontmatter is not valid YAML: ${e.message}`)
  }
  return { fm, fmRaw: m[1], body: raw.slice(m[0].length), file }
}

// One directory per contract: <specs>/<name>/contract.md, so every artifact of
// a contract (explanation, reports) sits next to it and archiving is one move.
const CONTRACT = 'contract.md'

function specName(spec) {
  return spec.fm?.name ?? basename(dirname(resolve(spec.file)))
}

function claimPath(file) {
  const key = createHash('sha256').update(realpathSync(resolve(file))).digest('hex')
  return join(process.env.WF_GATE_CLAIM_DIR ?? join(os.tmpdir(), 'wf-gate-claims'), key)
}

function claimActive(file) {
  const lock = claimPath(file)
  if (!existsSync(lock)) return false
  let createdAt = NaN
  try { createdAt = Date.parse(JSON.parse(readFileSync(join(lock, 'claim.json'), 'utf8')).createdAt) } catch {
    try { createdAt = statSync(lock).mtimeMs } catch {}
  }
  const ttl = Number(process.env.WF_GATE_CLAIM_TTL_MS ?? 10 * 60 * 1000)
  return Number.isFinite(createdAt) && Date.now() - createdAt <= ttl
}

function claim(file) {
  parseSpec(file)
  const lock = claimPath(file)
  mkdirSync(dirname(lock), { recursive: true })
  let acquired = false
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      mkdirSync(lock)
      acquired = true
      break
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      if (!claimActive(file)) {
        const stale = `${lock}.stale-${process.pid}-${Date.now()}`
        try { renameSync(lock, stale) } catch { fail(`claim: ${resolve(file)} changed while reclaiming; retry once`) }
        rmSync(stale, { recursive: true, force: true })
        continue
      }
      fail(`claim: ${resolve(file)} is already launching`)
    }
  }
  if (!acquired) fail(`claim: could not reserve ${resolve(file)} after stale-claim recovery`)
  writeFileSync(join(lock, 'claim.json'), JSON.stringify({ spec: realpathSync(resolve(file)), createdAt: new Date().toISOString() }) + '\n')
  process.stdout.write(`wf-gate claim: reserved ${resolve(file)}\n`)
}

function releaseClaim(file) {
  parseSpec(file)
  rmSync(claimPath(file), { recursive: true, force: true })
}

// ── check ────────────────────────────────────────────────────────────────────

function check(file) {
  const spec = parseSpec(file)
  const { fm, fmRaw } = spec
  const errors = []

  // Placeholders and leftover markers anywhere in the frontmatter.
  if (/<[a-zA-Z][\w -]*>/.test(fmRaw)) errors.push('frontmatter contains a placeholder like <name> — fill in the real value')
  if (/\b(TODO|TBD|FIXME)\b/.test(fmRaw)) errors.push('frontmatter contains TODO/TBD/FIXME — contracts must be complete')

  // Roles, review focuses and judge agents all resolve through this one roster;
  // its lookup errors are collected at the end of the function.
  const agents = resolveAgents(fm)
  const { impl, review } = agents

  const verify = fm?.verify ?? {}
  for (const mode of ['preflight', 'quick', 'full']) {
    const entries = verify[mode]
    if (mode === 'preflight' && entries === undefined) continue
    if (!Array.isArray(entries) || entries.length === 0) {
      errors.push(`verify.${mode} is missing or empty`)
      continue
    }
    for (const e of entries) {
      const label = `verify.${mode}[${e.id ?? '?'}]`
      if (!e.id) errors.push(`${label}: missing id`)
      if (!KINDS.has(e.kind)) errors.push(`${label}: kind must be one of ${[...KINDS].join('/')}`)
      if (COMMAND_KINDS.has(e.kind)) {
        if (!e.command) errors.push(`${label}: missing command`)
        if (!Number.isFinite(e.timeoutMs) || e.timeoutMs <= 0) errors.push(`${label}: missing or invalid timeoutMs`)
        if (e.command && /\|\|\s*true\b|;\s*true\b|\ballowFailure\b/.test(e.command)) {
          errors.push(`${label}: command masks its exit code (|| true / ; true / allowFailure)`)
        }
      }
      if (e.kind === 'eval') {
        if (!e.metric) errors.push(`${label}: eval entry needs a metric`)
        if (!Number.isFinite(e.min)) errors.push(`${label}: eval entry needs a numeric min`)
      }
      if (e.kind === 'judge') {
        if (!e.rubric) errors.push(`${label}: judge entry needs a rubric`)
        if (!Number.isFinite(e.min_score)) errors.push(`${label}: judge entry needs a numeric min_score`)
        if (e.model) errors.push(`${label}: judge takes an \`agent\` from the roster, not a bare \`model\``)
        // Same lookup as every other role, so a judge agent cannot dodge the
        // model/harness/effort validation by being referenced only from verify.
        const judgeName = e.agent ?? DEFAULT_JUDGE
        const judge = agents.lookup(judgeName, label)
        if (judge && !JUDGE_HARNESSES.has(judge.harness)) {
          errors.push(`${label}: judge agent "${judgeName}" runs on harness ${judge.harness}; judges run headless, so use a ${[...JUDGE_HARNESSES].join('/')} agent`)
        }
      }
      if (e.severity && !['blocking', 'warning'].includes(e.severity)) {
        errors.push(`${label}: severity must be blocking or warning`)
      }
    }
  }

  // Legacy shape: fail loudly instead of silently ignoring a whole plan.
  if (fm?.engines || fm?.review?.rounds) {
    errors.push('legacy frontmatter: engines/review.rounds were replaced by an agent roster — use `impl: <agent>`, `conductor: <agent>`, and `review: [{<focus>: <agent>}]` (see the /wf skill)')
  }

  if (!Array.isArray(fm?.review) || fm.review.length === 0 || fm.review.some(r => !r || Object.keys(r).length === 0)) {
    errors.push('review must be a list of rounds, each a non-empty {focus: agent} map')
  }
  if (fm?.impl == null) errors.push('impl is missing — name the agent that implements this contract')

  // Cross-model review guardrail: a reviewer sharing the impl's harness+model
  // reviews its own blind spots. Roster names are irrelevant, the pair is not.
  if (impl && fm?.same_model_review !== 'allow') {
    for (const [i, round] of review.entries()) {
      for (const rev of round) {
        if (rev.harness === impl.harness && rev.model === impl.model) {
          errors.push(`review[${i}] reviewer "${rev.focus}" uses the same model as impl (${impl.harness}/${impl.model}) — pick another agent or set same_model_review: allow`)
        }
      }
    }
  }

  if (fm?.depends_on !== undefined) {
    errors.push('depends_on was replaced by the enforced `after: [contract-name]` field')
  }
  if (fm?.after !== undefined) {
    if (!Array.isArray(fm.after) || fm.after.some(dep => typeof dep !== 'string' || !dep.trim())) {
      errors.push('after must be a list of contract names')
    } else if (fm.after.includes(specName(spec))) {
      errors.push('after cannot name the contract itself')
    }
  }

  if (!/akceptační kritéria/i.test(spec.body)) {
    errors.push('contract body is missing an "Akceptační kritéria" section')
  }

  // Last: roster lookups above (roles, review focuses, judge agents) collect here.
  errors.push(...agents.errors)

  if (errors.length) {
    for (const e of errors) process.stdout.write(`✖ ${e}\n`)
    process.stdout.write(`wf-gate check: ${errors.length} problem(s) in ${file}\n`)
    process.exit(1)
  }
  process.stdout.write(`wf-gate check: OK (${file})\n`)
}

// ── agents ──────────────────────────────────────────────────────────────────
// The skills read this instead of eyeballing YAML: one resolved entry per
// role, shaped like subagent_spawn's parameters.

function agents(file, { json }) {
  const spec = parseSpec(file)
  const { roster, impl, conductor, review, errors } = resolveAgents(spec.fm)
  if (errors.length) {
    for (const e of errors) process.stderr.write(`✖ ${e}\n`)
    process.exit(1)
  }
  if (json) {
    process.stdout.write(JSON.stringify({ roster, impl, conductor, review }, null, 2) + '\n')
    return
  }
  const line = (role, a) => `${role.padEnd(26)}  ${a ? `${a.harness}/${a.model}${a.effort ? ` (${a.effort})` : ''} [${a.name}]` : '— pi default model'}\n`
  process.stdout.write(line('conductor', conductor))
  process.stdout.write(line('impl', impl))
  for (const [i, round] of review.entries()) {
    for (const rev of round) process.stdout.write(line(`review ${i + 1}: ${rev.focus}`, rev))
  }
}

// ── receipts ─────────────────────────────────────────────────────────────────
// Deterministic trail in <repo>/.wf/receipts.jsonl. wf-hook.mjs reads it to
// decide whether `gh pr create` may proceed; wf-gate is the only writer for
// verify results, and `attest` records deliberate phase completions.

function repoRoot(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch {
    return null
  }
}

function gitState(root) {
  let head = null
  try {
    head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch {} // fresh repo without a commit yet
  const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length > 0
  return { head, dirty }
}

function relSpecPath(file, root) {
  const abs = resolve(file)
  return abs.startsWith(root + '/') ? abs.slice(root.length + 1) : abs
}

function appendReceipt(root, receipt) {
  mkdirSync(join(root, '.wf'), { recursive: true })
  appendFileSync(join(root, '.wf', 'receipts.jsonl'), JSON.stringify({ ...receipt, ts: new Date().toISOString() }) + '\n')
}

function begin(file) {
  const root = repoRoot(process.cwd())
  if (!root) fail('begin: not inside a git repository')
  parseSpec(file) // validates the spec exists and parses
  mkdirSync(join(root, '.wf'), { recursive: true })
  writeFileSync(join(root, '.wf', 'active'), relSpecPath(file, root) + '\n')
  releaseClaim(file)
  // Keep .wf/ out of the repo without touching .gitignore. In a linked worktree
  // .git is a file pointing at the real gitdir, so ask git for the path rather
  // than assuming a directory.
  const excludeRel = sh('git', ['rev-parse', '--git-path', 'info/exclude'], { cwd: root })
  if (!excludeRel) fail('begin: cannot resolve .git/info/exclude')
  const exclude = resolve(root, excludeRel)
  mkdirSync(dirname(exclude), { recursive: true })
  const current = existsSync(exclude) ? readFileSync(exclude, 'utf8') : ''
  if (!current.includes('.wf/')) appendFileSync(exclude, (current.endsWith('\n') || current === '' ? '' : '\n') + '.wf/\n')
  process.stdout.write(`wf-gate begin: active spec is ${relSpecPath(file, root)}\n`)
}

function attest(phase, file) {
  if (phase !== 'review') fail(`attest: unknown phase "${phase}" (supported: review)`)
  const root = repoRoot(process.cwd())
  if (!root) fail('attest: not inside a git repository')
  parseSpec(file)
  const { head, dirty } = gitState(root)
  if (dirty) fail('attest: working tree is dirty — commit the review fixes first, then attest')
  appendReceipt(root, { type: 'attest', phase, spec: relSpecPath(file, root), head, dirty })
  process.stdout.write(`wf-gate attest: ${phase} recorded at ${head.slice(0, 10)}\n`)
}

// ── verify ───────────────────────────────────────────────────────────────────

function runCommand(command, { timeoutMs, cwd }) {
  return new Promise(resolvePromise => {
    const child = spawn('/bin/bash', ['-c', command], { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      // Kill the whole process group so no orphaned build/test process
      // survives to hold locks or ports (learned in contexthouse gate.sh).
      try { process.kill(-child.pid, 'SIGTERM') } catch {}
      setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL') } catch {} }, 2000).unref()
    }, timeoutMs)
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { err += d })
    child.on('close', code => {
      clearTimeout(timer)
      resolvePromise({ code: timedOut ? 124 : code, out, err, timedOut })
    })
  })
}

function lastJson(text) {
  const lines = text.trim().split('\n').reverse()
  for (const line of lines) {
    const start = line.indexOf('{')
    if (start === -1) continue
    try { return JSON.parse(line.slice(start)) } catch {}
  }
  return null
}

function machineBusy() {
  const load = process.env.WF_GATE_FAKE_LOAD != null ? Number(process.env.WF_GATE_FAKE_LOAD) : os.loadavg()[0]
  const cores = process.env.WF_GATE_FAKE_CORES != null ? Number(process.env.WF_GATE_FAKE_CORES) : os.cpus().length
  return load > cores * 0.75
}

async function judgeScore(entry, cwd, roster) {
  const prompt = [
    'You are an impartial quality judge inside a verification gate.',
    `Rubric: ${entry.rubric}`,
    'Inspect the repository at the current directory as needed context is provided by the caller.',
    'Reply with ONLY a JSON object: {"score": <integer 1-5>, "reasoning": "<one short paragraph>"}',
  ].join('\n')
  const judge = roster[entry.agent ?? DEFAULT_JUDGE]
  if (!judge) return { error: `judge agent "${entry.agent ?? DEFAULT_JUDGE}" is not in the agent roster — run \`wf-gate check\` on this spec` }
  // Effort is spelled differently per CLI: pi takes a --model id:level suffix,
  // claude a separate --effort flag (a suffixed model id is rejected there).
  const cmd = process.env.WF_GATE_JUDGE_CMD ?? (judge.harness === 'pi'
    ? `pi -p --no-session --no-extensions --no-skills --model ${judge.effort ? `${judge.model}:${judge.effort}` : judge.model}`
    : `claude -p --output-format json --model ${judge.model}${judge.effort ? ` --effort ${judge.effort}` : ''}`)
  // A hung judge would hold the per-project full-gate lock, so it is timeboxed
  // like every command entry — judges just have no timeoutMs of their own.
  const timeoutMs = Number(process.env.WF_GATE_JUDGE_TIMEOUT_MS ?? 10 * 60 * 1000)
  return new Promise(resolvePromise => {
    const child = spawn('/bin/bash', ['-c', cmd], { cwd, detached: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
    }, timeoutMs)
    child.stdout.on('data', d => { out += d })
    child.on('close', () => {
      clearTimeout(timer)
      if (timedOut) return resolvePromise({ error: `judge timed out after ${timeoutMs}ms (process tree killed)` })
      let parsed = lastJson(out)
      // `claude -p --output-format json` wraps the reply in {result: "..."}.
      if (parsed && typeof parsed.result === 'string') parsed = lastJson(parsed.result) ?? (() => { const m = parsed.result.match(/\{[\s\S]*\}/); try { return m ? JSON.parse(m[0]) : null } catch { return null } })()
      resolvePromise(parsed && Number.isFinite(parsed.score) ? parsed : { error: 'judge produced no parsable verdict' })
    })
    child.stdin.end(prompt)
  })
}

// ── full-gate lock ───────────────────────────────────────────────────────────
// Full gates are the machine-hungry part (builds, containers, timing benches);
// two of them in parallel worktrees starve each other and poison perf gates.
// One full gate at a time per project, across all worktrees. quick stays free.

function pidAlive(pid) {
  try { process.kill(pid, 0); return true } catch { return false }
}

async function acquireFullGateLock(cwd) {
  const dir = process.env.WF_GATE_LOCK_DIR ?? join(os.tmpdir(), 'wf-gate-locks')
  const lock = join(dir, `${projectName(cwd)}.lock`)
  const poll = Number(process.env.WF_GATE_LOCK_POLL_MS ?? 5000)
  const timeout = Number(process.env.WF_GATE_LOCK_TIMEOUT_MS ?? 3 * 60 * 60 * 1000)
  const started = Date.now()
  mkdirSync(dir, { recursive: true })
  let announced = false
  for (;;) {
    try {
      mkdirSync(lock) // atomic: only one process wins
      writeFileSync(join(lock, 'pid'), String(process.pid))
      return () => { try { rmSync(lock, { recursive: true, force: true }) } catch {} }
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
    }
    let holder = null
    try { holder = Number(readFileSync(join(lock, 'pid'), 'utf8').trim()) } catch {}
    if (holder && !pidAlive(holder)) {
      try { rmSync(lock, { recursive: true, force: true }) } catch {}
      continue
    }
    if (Date.now() - started > timeout) {
      fail(`verify full: gave up waiting for the full-gate lock at ${lock} (held by pid ${holder ?? 'unknown'})`)
    }
    if (!announced) {
      process.stdout.write(`wf-gate: waiting for the full-gate lock — another worktree is running its full gate (pid ${holder ?? 'unknown'})\n`)
      announced = true
    }
    await new Promise(r => setTimeout(r, poll))
  }
}

async function verify(file, mode, { json }) {
  if (!['preflight', 'quick', 'full'].includes(mode)) fail('verify mode must be preflight, quick or full')
  const spec = parseSpec(file)
  const entries = [...(spec.fm?.verify?.[mode] ?? [])]
  if (mode === 'preflight' && entries.length === 0) {
    const report = { spec: specName(spec), mode, entries: [], skipped: true, result: 'pass' }
    process.stdout.write(json ? JSON.stringify(report, null, 2) + '\n' : 'wf-gate verify[preflight]: SKIPPED (not declared)\n')
    return
  }
  if (entries.length === 0) fail(`verify.${mode} is missing or empty in ${file}`)
  const { roster } = resolveAgents(spec.fm)

  const cwd = process.cwd()
  const root = repoRoot(cwd)
  const testedHead = root ? gitState(root).head : null
  const runId = `${Date.now()}-${process.pid}`
  const logDir = testedHead ? join(root, '.wf', 'logs', testedHead, mode, runId) : null
  if (logDir) mkdirSync(logDir, { recursive: true })
  const releaseLock = mode === 'full' ? await acquireFullGateLock(cwd) : null
  // Every verify run in a git repo ends with a whitespace/diff sanity check.
  if (existsSync(join(cwd, '.git'))) {
    entries.push({ id: 'diff-check', kind: 'hard', command: 'git diff --check', timeoutMs: 120_000 })
  }

  const report = { spec: specName(spec), mode, entries: [] }
  let failed = false
  let warned = false

  for (const entry of entries) {
    const rec = { id: entry.id, kind: entry.kind, status: 'passed' }
    const soft = entry.severity === 'warning'
    const startedAt = Date.now()
    let commandLog = null

    if (entry.kind === 'judge') {
      const verdict = await judgeScore(entry, cwd, roster)
      if (verdict.error) {
        rec.status = 'failed'
        rec.note = verdict.error
      } else {
        rec.score = verdict.score
        rec.reasoning = verdict.reasoning
        rec.status = verdict.score >= entry.min_score ? 'passed' : 'failed'
      }
    } else if (entry.kind === 'perf' && entry.requires_idle && machineBusy()) {
      rec.status = 'deferred'
      rec.note = 'machine busy — perf gate deferred; must be proven by CI or a manual idle run before merge'
    } else {
      const res = await runCommand(entry.command, { timeoutMs: entry.timeoutMs, cwd })
      commandLog = res.out + (res.err ? `\n--- stderr ---\n${res.err}` : '')
      rec.exitCode = res.code
      rec.timedOut = res.timedOut
      if (res.timedOut) {
        rec.status = 'failed'
        rec.note = `timed out after ${entry.timeoutMs}ms (process tree killed)`
      } else if (entry.kind === 'eval') {
        const parsed = lastJson(res.out)
        const value = parsed?.[entry.metric]
        rec.metric = entry.metric
        rec.value = value
        if (res.code !== 0 || !Number.isFinite(value)) {
          rec.status = 'failed'
          rec.note = res.code !== 0 ? `eval command exited ${res.code}` : `metric "${entry.metric}" not found in output`
        } else if (value < entry.min) {
          rec.status = 'failed'
          rec.note = `${entry.metric}=${value} < min ${entry.min}`
        } else if (Number.isFinite(entry.warn_below) && value < entry.warn_below) {
          rec.status = 'warning'
          rec.note = `${entry.metric}=${value} below warn threshold ${entry.warn_below}`
        }
      } else if (res.code !== 0) {
        rec.status = 'failed'
        rec.note = `exit ${res.code}`
        rec.tail = (res.err + res.out).split('\n').slice(-25).join('\n')
      }
    }

    rec.durationMs = Date.now() - startedAt
    if (logDir && commandLog != null) {
      const id = String(entry.id).replace(/[^\w.-]/g, '_')
      writeFileSync(join(logDir, `${id}.log`), commandLog)
    }
    if (rec.status === 'failed' && soft) {
      rec.status = 'warning'
      rec.note = `${rec.note ?? 'failed'} (severity: warning — surfaced, not blocking)`
    }
    if (rec.status === 'deferred' || rec.status === 'warning') warned = true
    if (rec.status === 'failed') failed = true
    report.entries.push(rec)
    if (!json) {
      const mark = { passed: '✔', warning: '⚠', deferred: '⚠', failed: '✖' }[rec.status]
      process.stdout.write(`${mark} [${entry.kind}] ${entry.id}: ${rec.status}${rec.note ? ` — ${rec.note}` : ''}\n`)
      if (rec.status === 'failed' && rec.tail) process.stdout.write(rec.tail + '\n')
    }
    if (failed) break // fail fast; later entries would run against a broken tree
  }

  const finalState = root ? gitState(root) : { head: null, dirty: false }
  if (testedHead && finalState.head !== testedHead) {
    failed = true
    report.entries.push({
      id: 'head-stability', kind: 'hard', status: 'failed', durationMs: 0,
      note: `HEAD changed during verify: tested ${testedHead.slice(0, 10)}, observed ${finalState.head?.slice(0, 10) ?? 'none'}`,
    })
  }
  if (root && finalState.dirty) {
    failed = true
    report.entries.push({ id: 'clean-tree', kind: 'hard', status: 'failed', durationMs: 0, note: 'working tree became dirty during verify' })
  }

  report.result = failed ? 'fail' : warned ? 'pass-with-warnings' : 'pass'
  if (root && testedHead) {
    report.head = testedHead
    report.dirty = finalState.dirty
    if (finalState.head !== testedHead) report.observedHead = finalState.head
    const reportDir = join(root, '.wf', 'verify', testedHead)
    mkdirSync(reportDir, { recursive: true })
    writeFileSync(join(reportDir, `${mode}-${runId}.json`), JSON.stringify(report, null, 2) + '\n')
    appendReceipt(root, {
      type: 'verify', mode, spec: relSpecPath(file, root), result: report.result,
      head: testedHead, dirty: finalState.dirty, ...(finalState.head !== testedHead ? { observedHead: finalState.head } : {}),
    })
  }

  // Keep the full lock until its durable report and receipt are written.
  // A crash leaves a dead pid that the next acquirer removes.
  releaseLock?.()
  if (json) process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  else process.stdout.write(`wf-gate verify[${mode}]: ${report.result.toUpperCase()}\n`)
  process.exit(failed ? 1 : 0)
}

// ── status ───────────────────────────────────────────────────────────────────

function sh(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim()
  } catch {
    return null
  }
}

// Which worktree conducts which contract. Branch names cannot answer this:
// sc derives them from the task text and names the directory with a codename,
// so neither contains the contract slug. `wf-gate begin` writes .wf/active in
// the worktree, so every conducted worktree states its contract outright.
// Same file, different spelling: /tmp vs /private/tmp, a symlinked checkout.
// Comparing raw strings would silently report a conducted contract as ready.
function samePath(a, b) {
  const real = p => { try { return realpathSync(p) } catch { return resolve(p) } }
  return real(a) === real(b)
}

function conductedWorktrees(cwd) {
  const out = sh('git', ['worktree', 'list', '--porcelain'], { cwd })
  const conducted = []
  let path = null
  let branch = null
  const flush = () => {
    if (!path) return
    const activeFile = join(path, '.wf', 'active')
    if (existsSync(activeFile)) {
      const active = readFileSync(activeFile, 'utf8').trim()
      conducted.push({ path, branch, spec: resolve(path, active) })
    }
    path = null
    branch = null
  }
  for (const line of [...(out ?? '').split('\n'), '']) {
    if (line.startsWith('worktree ')) {
      flush()
      path = line.slice('worktree '.length)
    } else if (line.startsWith('branch refs/heads/')) {
      branch = line.slice('branch refs/heads/'.length)
    } else if (!line.trim()) {
      flush()
    }
  }
  return conducted
}

// PRs are tied to a spec by an invisible `<!-- wf-spec: <name> -->` HTML
// comment in the PR body (written by /wf-impl; renders as nothing on GitHub).
// Fetched once with bodies and matched locally — GitHub search does not
// reliably index HTML comments. Specs live OUTSIDE the repo, so a marker
// would never appear in a body naturally.
function allPrs(cwd) {
  const out = sh('gh', ['pr', 'list', '--state', 'all',
    '--json', 'number,state,isDraft,title,headRefName,body', '--limit', '100'], { cwd })
  if (out == null) return null // gh unavailable — degrade gracefully
  try { return JSON.parse(out) } catch { return null }
}

function prsForSpec(name, prs) {
  if (!Array.isArray(prs)) return null
  return prs
    .filter(p => (p.body ?? '').includes(`wf-spec: ${name}`))
    .map(({ body, ...lite }) => lite) // keep status output free of PR bodies
}

// Project identity = origin remote basename (stable across every worktree of
// the repo), falling back to the repo/cwd directory name. Used for the spec
// home and the full-gate lock.
function projectName(cwd) {
  const root = repoRoot(cwd)
  const remote = root ? sh('git', ['remote', 'get-url', 'origin'], { cwd: root }) : null
  return remote ? basename(remote).replace(/\.git$/, '') : basename(root ?? cwd)
}

// Default spec home: ~/Workspace/specs/<project>.
function defaultSpecsDir(cwd) {
  return join(os.homedir(), 'Workspace', 'specs', projectName(cwd))
}

function unresolvedThreads(prNumber, cwd) {
  const query = `query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) { pullRequest(number: $number) {
      reviewThreads(first: 100) { nodes { isResolved } } } } }`
  const out = sh('gh', ['api', 'graphql',
    '-F', 'owner={owner}', '-F', 'repo={repo}', '-F', `number=${prNumber}`,
    '-f', `query=${query}`], { cwd })
  if (out == null) return null
  try {
    const nodes = JSON.parse(out).data.repository.pullRequest.reviewThreads.nodes
    return nodes.filter(n => !n.isResolved).length
  } catch {
    return null
  }
}

function status({ dir, json }) {
  const cwd = process.cwd()
  const specsDir = dir ? resolve(cwd, dir) : defaultSpecsDir(cwd)
  // A contract is a directory holding contract.md; anything else (an _archive
  // dir, stray notes) is ignored rather than reported as a broken spec.
  const files = existsSync(specsDir)
    ? readdirSync(specsDir, { withFileTypes: true })
        .filter(e => e.isDirectory() && existsSync(join(specsDir, e.name, CONTRACT)))
        .map(e => join(e.name, CONTRACT))
        .sort()
    : [] // no specs yet for this project — an empty report, not an error
  const conducted = conductedWorktrees(cwd)
  const fetched = files.length ? allPrs(cwd) : []
  const contracts = files.map(f => {
    const file = join(specsDir, f)
    const spec = parseSpec(file)
    return { file, spec, name: specName(spec) }
  })
  const dependencies = new Map(contracts.map(({ name, spec }) => [name, spec.fm?.after ?? []]))
  const reaches = (name, target, seen = new Set()) => {
    if (seen.has(name)) return false
    seen.add(name)
    return (dependencies.get(name) ?? []).some(dep => dep === target || reaches(dep, target, seen))
  }
  const cycles = new Set(contracts.filter(({ name }) => reaches(name, name)).map(({ name }) => name))

  const specs = []
  for (const { file, spec, name } of contracts) {
    const rec = { name, file }

    const prs = prsForSpec(name, fetched)
    const merged = prs?.find(p => p.state === 'MERGED')
    const open = prs?.find(p => p.state === 'OPEN')
    const worktrees = conducted.filter(w => samePath(w.spec, file))
    const claimed = claimActive(file)
    const blockedBy = (spec.fm?.after ?? []).filter(dep => !prsForSpec(dep, fetched)?.some(p => p.state === 'MERGED'))

    if (merged) {
      rec.state = 'done'
      rec.pr = merged
    } else if (worktrees.length > 1) {
      rec.state = 'duplicate'
      rec.worktrees = worktrees.map(({ path, branch }) => ({ path, branch }))
      if (open) rec.pr = open
    } else if (open) {
      rec.state = 'pr-open'
      rec.pr = open
      rec.unresolvedThreads = unresolvedThreads(open.number, cwd)
    } else if (worktrees.length === 1) {
      const [worktree] = worktrees
      rec.state = 'running'
      rec.branch = worktree.branch
      rec.worktree = worktree.path
      const last = sh('git', ['log', '-1', '--format=%cr'], { cwd: worktree.path })
      if (last) rec.lastCommit = last
    } else if (claimed) {
      rec.state = 'launching'
    } else if (cycles.has(name)) {
      rec.state = 'cycle'
    } else if (blockedBy.length) {
      rec.state = 'blocked'
      rec.blockedBy = blockedBy
    } else {
      rec.state = 'ready'
    }
    if (prs == null) rec.note = 'gh unavailable — PR state unknown'
    specs.push(rec)
  }

  if (json) {
    process.stdout.write(JSON.stringify({ specs }, null, 2) + '\n')
    return
  }
  const pad = (s, n) => String(s ?? '').padEnd(n)
  process.stdout.write(pad('SPEC', 28) + pad('STATE', 12) + 'DETAIL\n')
  for (const s of specs) {
    const detail = s.state === 'done' ? `PR #${s.pr.number} merged — archive the spec`
      : s.state === 'pr-open' ? `PR #${s.pr.number}${s.pr.isDraft ? ' (draft)' : ''}${s.unresolvedThreads ? `, ${s.unresolvedThreads} unresolved thread(s)` : ''}`
      : s.state === 'duplicate' ? `${s.worktrees.length} worktrees — stop and reconcile before continuing`
      : s.state === 'launching' ? 'launcher holds the contract claim — do not retry create'
      : s.state === 'cycle' ? 'invalid after dependency cycle'
      : s.state === 'blocked' ? `waiting for: ${s.blockedBy.join(', ')}`
      : s.state === 'running' ? `${s.branch ?? '(detached)'}${s.lastCommit ? `, last commit ${s.lastCommit}` : ''}`
      : (s.note ?? '')
    process.stdout.write(pad(s.name, 28) + pad(s.state, 12) + detail + '\n')
  }
}

// ── main ─────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
const cmd = argv[0]
const json = argv.includes('--json')

if (cmd === 'check') {
  if (!argv[1]) fail('usage: wf-gate check <spec.md>')
  check(argv[1])
} else if (cmd === 'agents') {
  if (!argv[1]) fail('usage: wf-gate agents <spec.md> [--json]')
  agents(argv[1], { json })
} else if (cmd === 'verify') {
  if (!argv[1] || !argv[2]) fail('usage: wf-gate verify <spec.md> preflight|quick|full [--json]')
  await verify(argv[1], argv[2], { json })
} else if (cmd === 'status') {
  const dirIdx = argv.indexOf('--dir')
  status({ dir: dirIdx !== -1 ? argv[dirIdx + 1] : null, json })
} else if (cmd === 'claim') {
  if (!argv[1]) fail('usage: wf-gate claim <spec.md>')
  claim(argv[1])
} else if (cmd === 'release-claim') {
  if (!argv[1]) fail('usage: wf-gate release-claim <spec.md>')
  releaseClaim(argv[1])
} else if (cmd === 'begin') {
  if (!argv[1]) fail('usage: wf-gate begin <spec.md>')
  begin(argv[1])
} else if (cmd === 'attest') {
  if (!argv[1] || !argv[2]) fail('usage: wf-gate attest review <spec.md>')
  attest(argv[1], argv[2])
} else {
  fail('usage: wf-gate check|agents|verify|status|claim|release-claim|begin|attest …')
}
