// Public-behavior tests for wf-gate: every test invokes the CLI as a child
// process and asserts on exit codes and JSON reports, never on internals.
// Mocks used (one line each, per working rules):
// - `gh` PATH shim: tests must not hit the real GitHub API.
// - WF_GATE_JUDGE_CMD: judge tests must not call a live LLM.
// - WF_GATE_FAKE_LOAD: perf idle-detection must be deterministic in CI.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename, dirname } from 'node:path'
import { spawnSync, execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const yaml = createRequire(import.meta.url)('js-yaml')

const GATE = new URL('./wf-gate.mjs', import.meta.url).pathname

function runGate(args, { cwd, env = {} } = {}) {
  return spawnSync('node', [GATE, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 60_000,
  })
}

function tmp() {
  return mkdtempSync(join(tmpdir(), 'wf-gate-'))
}

function baseFrontmatter(over = {}) {
  return {
    name: 'demo-spec',
    uat: 'auto',
    conductor: 'opus',
    impl: 'sol',
    review: [{ 'bugs-edge-cases': 'cc' }],
    verify: {
      quick: [{ id: 'quick', kind: 'hard', command: 'true', timeoutMs: 5000 }],
      full: [{ id: 'full', kind: 'hard', command: 'true', timeoutMs: 5000 }],
    },
    ...over,
  }
}

// One directory per contract: <specs>/<name>/contract.md, with every artifact
// of that contract (explanation, reports) as its sibling.
function writeSpec(dir, fm, { name = fm.name ?? 'demo-spec' } = {}) {
  mkdirSync(join(dir, 'specs', name), { recursive: true })
  const file = join(dir, 'specs', name, 'contract.md')
  const body = '# Kontrakt\n\n## Akceptační kritéria\n\n- chová se správně\n'
  writeFileSync(file, `---\n${yaml.dump(fm)}---\n\n${body}`)
  return file
}

// ── check ────────────────────────────────────────────────────────────────────

test('check: valid spec passes', () => {
  const dir = tmp()
  const file = writeSpec(dir, baseFrontmatter())
  const r = runGate(['check', file], { cwd: dir })
  assert.equal(r.status, 0, r.stdout + r.stderr)
})

test('check: placeholder in command fails', () => {
  const dir = tmp()
  const fm = baseFrontmatter()
  fm.verify.full[0].command = 'just gate <name> full'
  const file = writeSpec(dir, fm)
  const r = runGate(['check', file], { cwd: dir })
  assert.equal(r.status, 1)
  assert.match(r.stdout + r.stderr, /placeholder/i)
})

test('check: TODO in frontmatter fails', () => {
  const dir = tmp()
  const fm = baseFrontmatter()
  fm.verify.full[0].command = 'echo TODO fix me'
  const file = writeSpec(dir, fm)
  const r = runGate(['check', file], { cwd: dir })
  assert.equal(r.status, 1)
})

test('check: exit-code masking (|| true) fails', () => {
  const dir = tmp()
  const fm = baseFrontmatter()
  fm.verify.full[0].command = 'cargo test || true'
  const file = writeSpec(dir, fm)
  const r = runGate(['check', file], { cwd: dir })
  assert.equal(r.status, 1)
  assert.match(r.stdout + r.stderr, /mask/i)
})

test('check: missing timeoutMs on command entry fails', () => {
  const dir = tmp()
  const fm = baseFrontmatter()
  delete fm.verify.full[0].timeoutMs
  const file = writeSpec(dir, fm)
  const r = runGate(['check', file], { cwd: dir })
  assert.equal(r.status, 1)
  assert.match(r.stdout + r.stderr, /timeoutMs/)
})

test('check: reviewer resolving to the same harness+model as impl fails by default', () => {
  const dir = tmp()
  const fm = baseFrontmatter({ review: [{ 'bugs-edge-cases': 'sol' }] }) // == impl agent
  const file = writeSpec(dir, fm)
  const r = runGate(['check', file], { cwd: dir })
  assert.equal(r.status, 1)
  assert.match(r.stdout + r.stderr, /same model/i)
})

test('check: two roster names pointing at one harness+model still count as same model', () => {
  const dir = tmp()
  const fm = baseFrontmatter({
    agents: { twin: { harness: 'pi', model: 'openai-codex/gpt-5.6-sol' } },
    review: [{ 'bugs-edge-cases': 'twin' }],
  })
  const file = writeSpec(dir, fm)
  const r = runGate(['check', file], { cwd: dir })
  assert.equal(r.status, 1)
  assert.match(r.stdout + r.stderr, /same model/i)
})

test('check: impl referencing an unknown agent fails', () => {
  const dir = tmp()
  const file = writeSpec(dir, baseFrontmatter({ impl: 'nosuch' }))
  const r = runGate(['check', file], { cwd: dir })
  assert.equal(r.status, 1)
  assert.match(r.stdout + r.stderr, /impl.*nosuch.*not in the agent roster/i)
})

test('check: reviewer referencing an unknown agent fails', () => {
  const dir = tmp()
  const file = writeSpec(dir, baseFrontmatter({ review: [{ security: 'nosuch' }] }))
  const r = runGate(['check', file], { cwd: dir })
  assert.equal(r.status, 1)
  assert.match(r.stdout + r.stderr, /nosuch.*not in the agent roster/i)
})

test('check: a spec-defined agent overrides the builtin of the same name', () => {
  const dir = tmp()
  const fm = baseFrontmatter({
    agents: { sol: { harness: 'codex', model: 'gpt-5.6-terra', effort: 'high' } },
  })
  const file = writeSpec(dir, fm)
  assert.equal(runGate(['check', file], { cwd: dir }).status, 0)
  const r = runGate(['agents', file, '--json'], { cwd: dir })
  assert.equal(JSON.parse(r.stdout).impl.harness, 'codex')
})

test('check: pi-harness agent without an explicit model fails', () => {
  const dir = tmp()
  const fm = baseFrontmatter({ agents: { bare: { harness: 'pi' } }, impl: 'bare' })
  const file = writeSpec(dir, fm)
  const r = runGate(['check', file], { cwd: dir })
  assert.equal(r.status, 1)
  assert.match(r.stdout + r.stderr, /explicit model/i)
})

test('check: unknown harness fails', () => {
  const dir = tmp()
  const fm = baseFrontmatter({ agents: { weird: { harness: 'cursor', model: 'x' } }, impl: 'weird' })
  const file = writeSpec(dir, fm)
  const r = runGate(['check', file], { cwd: dir })
  assert.equal(r.status, 1)
  assert.match(r.stdout + r.stderr, /harness must be/i)
})

test('check: invalid effort fails', () => {
  const dir = tmp()
  const fm = baseFrontmatter({ agents: { odd: { harness: 'pi', model: 'a/b', effort: 'turbo' } }, impl: 'odd' })
  const file = writeSpec(dir, fm)
  const r = runGate(['check', file], { cwd: dir })
  assert.equal(r.status, 1)
  assert.match(r.stdout + r.stderr, /effort must be/i)
})

test('check: conductor on a non-pi harness fails (the worktree session is pi)', () => {
  const dir = tmp()
  const file = writeSpec(dir, baseFrontmatter({ conductor: 'cc' }))
  const r = runGate(['check', file], { cwd: dir })
  assert.equal(r.status, 1)
  assert.match(r.stdout + r.stderr, /conductor.*pi/i)
})

test('check: legacy engines/review.rounds shape fails with a migration hint', () => {
  const dir = tmp()
  const fm = baseFrontmatter()
  delete fm.impl
  fm.engines = { impl: { agent: 'pi', model: 'openai-codex/gpt-5.6-sol' } }
  fm.review = { rounds: [{ reviewers: [{ focus: 'bugs', model: 'opus' }] }] }
  const file = writeSpec(dir, fm)
  const r = runGate(['check', file], { cwd: dir })
  assert.equal(r.status, 1)
  assert.match(r.stdout + r.stderr, /legacy/i)
})

test('check: same_model_review allow permits equal models', () => {
  const dir = tmp()
  const fm = baseFrontmatter({ same_model_review: 'allow', review: [{ 'bugs-edge-cases': 'sol' }] })
  const file = writeSpec(dir, fm)
  const r = runGate(['check', file], { cwd: dir })
  assert.equal(r.status, 0, r.stdout + r.stderr)
})

// ── agents (deterministic roster resolution for the skills) ─────────────────

test('agents --json resolves impl, conductor and review rounds from the roster', () => {
  const dir = tmp()
  const fm = baseFrontmatter({
    review: [{ 'correctness-smoke': 'cc', security: 'codex' }, { 're-review': 'cc' }],
  })
  const file = writeSpec(dir, fm)
  const r = runGate(['agents', file, '--json'], { cwd: dir })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const out = JSON.parse(r.stdout)
  assert.deepEqual(out.impl, { name: 'sol', harness: 'pi', model: 'openai-codex/gpt-5.6-sol', effort: 'high' })
  assert.equal(out.conductor.harness, 'pi')
  assert.equal(out.conductor.model, 'anthropic/claude-opus-5')
  assert.equal(out.review.length, 2)
  assert.equal(out.review[0].length, 2)
  assert.deepEqual(
    out.review[0].map(rev => rev.focus).sort(),
    ['correctness-smoke', 'security'],
  )
  assert.equal(out.review[0].find(rev => rev.focus === 'security').harness, 'codex')
  assert.equal(out.review[1][0].focus, 're-review')
})

test('agents: omitted conductor resolves to null, not a guess', () => {
  const dir = tmp()
  const fm = baseFrontmatter()
  delete fm.conductor
  const file = writeSpec(dir, fm)
  const r = runGate(['agents', writeSpec(dir, fm) && file, '--json'], { cwd: dir })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(JSON.parse(r.stdout).conductor, null)
})

test('agents: without --json prints a human table naming harness and model', () => {
  const dir = tmp()
  const file = writeSpec(dir, baseFrontmatter())
  const r = runGate(['agents', file], { cwd: dir })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /impl/)
  assert.match(r.stdout, /openai-codex\/gpt-5\.6-sol/)
})

test('check: missing review plan fails', () => {
  const dir = tmp()
  const fm = baseFrontmatter()
  delete fm.review
  const file = writeSpec(dir, fm)
  const r = runGate(['check', file], { cwd: dir })
  assert.equal(r.status, 1)
  assert.match(r.stdout + r.stderr, /review/i)
})

test('check: a review focus without an agent fails instead of emptying the round', () => {
  const dir = tmp()
  // `- smoke:` in YAML — one forgotten value must not silently drop the panel.
  const file = writeSpec(dir, baseFrontmatter({ review: [{ smoke: null }] }))
  const r = runGate(['check', file], { cwd: dir })
  assert.equal(r.status, 1)
  assert.match(r.stdout + r.stderr, /smoke/)
})

test('check: depends_on referencing missing spec fails', () => {
  const dir = tmp()
  const fm = baseFrontmatter({ depends_on: ['does-not-exist'] })
  const file = writeSpec(dir, fm)
  const r = runGate(['check', file], { cwd: dir })
  assert.equal(r.status, 1)
  assert.match(r.stdout + r.stderr, /does-not-exist/)
})

test('check: judge entry naming a roster agent passes', () => {
  const dir = tmp()
  const fm = baseFrontmatter()
  fm.verify.full.push({ id: 'docs', kind: 'judge', agent: 'cc', rubric: 'docs are readable', min_score: 4 })
  const file = writeSpec(dir, fm)
  assert.equal(runGate(['check', file], { cwd: dir }).status, 0)
})

test('check: judge agent missing a model fails like any other roster entry', () => {
  const dir = tmp()
  const fm = baseFrontmatter({ agents: { pj: { harness: 'pi' } } })
  fm.verify.full.push({ id: 'docs', kind: 'judge', agent: 'pj', rubric: 'r', min_score: 4 })
  const file = writeSpec(dir, fm)
  const r = runGate(['check', file], { cwd: dir })
  assert.equal(r.status, 1)
  assert.match(r.stdout + r.stderr, /explicit model/i)
})

test('check: judge entry with an unknown agent fails', () => {
  const dir = tmp()
  const fm = baseFrontmatter()
  fm.verify.full.push({ id: 'docs', kind: 'judge', agent: 'nosuch', rubric: 'r', min_score: 4 })
  const file = writeSpec(dir, fm)
  const r = runGate(['check', file], { cwd: dir })
  assert.equal(r.status, 1)
  assert.match(r.stdout + r.stderr, /nosuch.*roster/i)
})

test('check: judge entry on a codex agent fails (no proven headless JSON contract)', () => {
  const dir = tmp()
  const fm = baseFrontmatter()
  fm.verify.full.push({ id: 'docs', kind: 'judge', agent: 'codex', rubric: 'r', min_score: 4 })
  const file = writeSpec(dir, fm)
  const r = runGate(['check', file], { cwd: dir })
  assert.equal(r.status, 1)
  assert.match(r.stdout + r.stderr, /headless/i)
})

test('check: judge entry with a bare model instead of an agent fails', () => {
  const dir = tmp()
  const fm = baseFrontmatter()
  fm.verify.full.push({ id: 'docs', kind: 'judge', model: 'opus', rubric: 'r', min_score: 4 })
  const file = writeSpec(dir, fm)
  const r = runGate(['check', file], { cwd: dir })
  assert.equal(r.status, 1)
  assert.match(r.stdout + r.stderr, /agent.*roster/i)
})

// ── verify ───────────────────────────────────────────────────────────────────

function verifyJson(r) {
  assert.ok([0, 1].includes(r.status), r.stdout + r.stderr)
  return JSON.parse(r.stdout)
}

test('verify: passing hard entry → exit 0, result pass', () => {
  const dir = tmp()
  const file = writeSpec(dir, baseFrontmatter())
  const r = runGate(['verify', file, 'full', '--json'], { cwd: dir })
  const rep = verifyJson(r)
  assert.equal(r.status, 0)
  assert.equal(rep.result, 'pass')
  assert.equal(rep.entries.find(e => e.id === 'full').status, 'passed')
})

test('verify: failing hard entry → exit 1, result fail', () => {
  const dir = tmp()
  const fm = baseFrontmatter()
  fm.verify.full[0].command = 'exit 3'
  const file = writeSpec(dir, fm)
  const r = runGate(['verify', file, 'full', '--json'], { cwd: dir })
  const rep = verifyJson(r)
  assert.equal(r.status, 1)
  assert.equal(rep.result, 'fail')
})

test('verify: quick mode runs the quick set, not full', () => {
  const dir = tmp()
  const fm = baseFrontmatter()
  fm.verify.full[0].command = 'exit 1' // full would fail
  const file = writeSpec(dir, fm)
  const r = runGate(['verify', file, 'quick', '--json'], { cwd: dir })
  const rep = verifyJson(r)
  assert.equal(r.status, 0)
  assert.ok(rep.entries.every(e => e.id !== 'full'))
})

test('verify: timeout kills the command and fails', () => {
  const dir = tmp()
  const fm = baseFrontmatter()
  fm.verify.full[0] = { id: 'slow', kind: 'hard', command: 'sleep 30', timeoutMs: 300 }
  const file = writeSpec(dir, fm)
  const t0 = Date.now()
  const r = runGate(['verify', file, 'full', '--json'], { cwd: dir })
  const rep = verifyJson(r)
  assert.equal(rep.result, 'fail')
  assert.equal(rep.entries[0].timedOut, true)
  assert.ok(Date.now() - t0 < 10_000, 'must not wait for the full sleep')
})

test('verify: hard entry with severity warning → pass-with-warnings', () => {
  const dir = tmp()
  const fm = baseFrontmatter()
  fm.verify.full.push({ id: 'advisory', kind: 'hard', command: 'exit 1', timeoutMs: 5000, severity: 'warning' })
  const file = writeSpec(dir, fm)
  const r = runGate(['verify', file, 'full', '--json'], { cwd: dir })
  const rep = verifyJson(r)
  assert.equal(r.status, 0)
  assert.equal(rep.result, 'pass-with-warnings')
  assert.equal(rep.entries.find(e => e.id === 'advisory').status, 'warning')
})

test('verify: eval thresholds — pass / warn / fail', () => {
  const dir = tmp()
  const mk = (v) => {
    const fm = baseFrontmatter()
    fm.verify.full = [{
      id: 'relevance', kind: 'eval', command: `echo '{"ndcg": ${v}}'`,
      metric: 'ndcg', min: 0.75, warn_below: 0.8, timeoutMs: 5000,
    }]
    return writeSpec(dir, fm, { name: `eval-${String(v).replace('.', '')}` })
  }
  const pass = verifyJson(runGate(['verify', mk(0.9), 'full', '--json'], { cwd: dir }))
  assert.equal(pass.result, 'pass')
  const warn = verifyJson(runGate(['verify', mk(0.77), 'full', '--json'], { cwd: dir }))
  assert.equal(warn.result, 'pass-with-warnings')
  const fail = verifyJson(runGate(['verify', mk(0.5), 'full', '--json'], { cwd: dir }))
  assert.equal(fail.result, 'fail')
})

test('verify: perf entry defers to warning on a busy machine', () => {
  const dir = tmp()
  const fm = baseFrontmatter()
  fm.verify.full = [{
    id: 'perf', kind: 'perf', command: 'true', timeoutMs: 5000, requires_idle: true,
  }]
  const file = writeSpec(dir, fm)
  const r = runGate(['verify', file, 'full', '--json'], { cwd: dir, env: { WF_GATE_FAKE_LOAD: '99', WF_GATE_FAKE_CORES: '8' } })
  const rep = verifyJson(r)
  assert.equal(r.status, 0)
  assert.equal(rep.result, 'pass-with-warnings')
  assert.equal(rep.entries[0].status, 'deferred')
})

test('verify: perf entry runs normally on an idle machine', () => {
  const dir = tmp()
  const fm = baseFrontmatter()
  fm.verify.full = [{ id: 'perf', kind: 'perf', command: 'true', timeoutMs: 5000, requires_idle: true }]
  const file = writeSpec(dir, fm)
  const r = runGate(['verify', file, 'full', '--json'], { cwd: dir, env: { WF_GATE_FAKE_LOAD: '0.1', WF_GATE_FAKE_CORES: '8' } })
  const rep = verifyJson(r)
  assert.equal(rep.result, 'pass')
  assert.equal(rep.entries[0].status, 'passed')
})

test('verify: judge entry scores via judge command', () => {
  const dir = tmp()
  const mk = (name) => {
    const fm = baseFrontmatter()
    fm.verify.full = [{ id: 'docs', kind: 'judge', rubric: 'Errors must be readable.', min_score: 4 }]
    return writeSpec(dir, fm, { name })
  }
  const pass = runGate(['verify', mk('judge-pass'), 'full', '--json'], {
    cwd: dir,
    env: { WF_GATE_JUDGE_CMD: `cat >/dev/null; echo '{"score": 5, "reasoning": "clear"}'` },
  })
  assert.equal(verifyJson(pass).result, 'pass')
  const fail = runGate(['verify', mk('judge-fail'), 'full', '--json'], {
    cwd: dir,
    env: { WF_GATE_JUDGE_CMD: `cat >/dev/null; echo '{"score": 2, "reasoning": "confusing"}'` },
  })
  assert.equal(verifyJson(fail).result, 'fail')
})

// PATH shims instead of a live LLM: they record how wf-gate invoked the judge.
function judgeArgs(harnessBinary, agent) {
  const dir = tmp()
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  const log = join(dir, 'judge-cmd.txt')
  writeFileSync(
    join(bin, harnessBinary),
    `#!/bin/sh\ncat > /dev/null\necho "$@" > ${log}\necho '{"score": 5, "reasoning": "ok"}'\n`,
    { mode: 0o755 },
  )
  const fm = baseFrontmatter({ agents: { j: agent } })
  fm.verify.full = [{ id: 'docs', kind: 'judge', agent: 'j', rubric: 'readable', min_score: 4 }]
  const file = writeSpec(dir, fm)
  const r = runGate(['verify', file, 'full', '--json'], { cwd: dir, env: { PATH: `${bin}:${process.env.PATH}` } })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  return readFileSync(log, 'utf8')
}

test('verify: pi judge takes its effort as the model thinking suffix', () => {
  const args = judgeArgs('pi', { harness: 'pi', model: 'zai/glm-5.2', effort: 'low' })
  assert.match(args, /--model zai\/glm-5\.2:low/)
  assert.match(args, /-p\b/)
})

test('verify: claude judge takes its effort as a separate flag, never in --model', () => {
  const args = judgeArgs('claude', { harness: 'claude', model: 'fable', effort: 'high' })
  assert.match(args, /--model fable\b/)
  assert.doesNotMatch(args, /fable:high/) // claude --model rejects a suffix
  assert.match(args, /--effort high/)
})

test('verify: judge without an effort passes a bare model', () => {
  const args = judgeArgs('pi', { harness: 'pi', model: 'zai/glm-5.2' })
  assert.match(args, /--model zai\/glm-5\.2(\s|$)/)
  assert.doesNotMatch(args, /--effort/)
})

test('verify: judge entry naming an unknown agent fails the entry, never crashes', () => {
  const dir = tmp()
  const fm = baseFrontmatter()
  fm.verify.full = [{ id: 'docs', kind: 'judge', agent: 'ghost', rubric: 'r', min_score: 4 }]
  const file = writeSpec(dir, fm)
  const r = runGate(['verify', file, 'full', '--json'], { cwd: dir })
  assert.equal(r.status, 1)
  assert.doesNotMatch(r.stderr, /TypeError/)
  const rec = JSON.parse(r.stdout).entries[0]
  assert.equal(rec.status, 'failed')
  assert.match(rec.note, /ghost/)
})

test('verify: a hanging judge times out instead of holding the full-gate lock forever', () => {
  const dir = tmp()
  const fm = baseFrontmatter()
  fm.verify.full = [{ id: 'docs', kind: 'judge', agent: 'cc', rubric: 'r', min_score: 4 }]
  const file = writeSpec(dir, fm)
  const r = runGate(['verify', file, 'full', '--json'], {
    cwd: dir,
    env: { WF_GATE_JUDGE_CMD: 'sleep 30', WF_GATE_JUDGE_TIMEOUT_MS: '1500' },
  })
  assert.equal(r.status, 1)
  const rec = JSON.parse(r.stdout).entries[0]
  assert.equal(rec.status, 'failed')
  assert.match(rec.note, /timed out/i)
})

test('verify: implicit diff-check runs in a git repo', () => {
  const dir = tmp()
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
  const file = writeSpec(dir, baseFrontmatter())
  const r = runGate(['verify', file, 'full', '--json'], { cwd: dir })
  const rep = verifyJson(r)
  assert.ok(rep.entries.some(e => e.id === 'diff-check'))
})

// ── status ───────────────────────────────────────────────────────────────────

function gitRepo() {
  const dir = tmp()
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
  execFileSync('git', ['-C', dir, 'config', 'user.email', 't@t.t'])
  execFileSync('git', ['-C', dir, 'config', 'user.name', 't'])
  return dir
}

function commitAll(dir) {
  execFileSync('git', ['-C', dir, 'add', '-A'])
  execFileSync('git', ['-C', dir, 'commit', '-qm', 'specs'])
}

// gh shim: replays fixtures from GH_FIXTURE so status tests never hit GitHub.
function ghShim(dir, fixture) {
  const bin = join(dir, 'shim-bin')
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, 'gh'), `#!/usr/bin/env node
const fs = require('fs')
const fx = JSON.parse(fs.readFileSync(process.env.GH_FIXTURE, 'utf8'))
const args = process.argv.slice(2)
if (args[0] === 'pr' && args[1] === 'list') {
  console.log(JSON.stringify(fx.prs ?? []))
} else if (args[0] === 'api') {
  const m = args.join(' ').match(/number=(\\d+)/)
  const n = m ? m[1] : '0'
  const count = (fx.unresolved ?? {})[n] ?? 0
  console.log(JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: {
    nodes: Array.from({ length: count }, () => ({ isResolved: false })) } } } } }))
} else { process.exit(1) }
`)
  writeFileSync(join(dir, 'fixture.json'), JSON.stringify(fixture))
  execFileSync('chmod', ['+x', join(bin, 'gh')])
  return { PATH: `${bin}:${process.env.PATH}`, GH_FIXTURE: join(dir, 'fixture.json') }
}

function statusJson(dir, env, extra = ['--dir', 'specs']) {
  const r = runGate(['status', '--json', ...extra], { cwd: dir, env })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  return JSON.parse(r.stdout)
}

test('status: spec with no branch and no PR is ready', () => {
  const dir = gitRepo()
  writeSpec(dir, baseFrontmatter({ name: 'alpha' }), { name: 'alpha' })
  commitAll(dir)
  const env = ghShim(dir, { prs: [] })
  const rep = statusJson(dir, env)
  assert.equal(rep.specs.find(s => s.name === 'alpha').state, 'ready')
})

test('status: spec whose dependency is not done is blocked', () => {
  const dir = gitRepo()
  writeSpec(dir, baseFrontmatter({ name: 'alpha' }), { name: 'alpha' })
  writeSpec(dir, baseFrontmatter({ name: 'beta', depends_on: ['alpha'] }), { name: 'beta' })
  commitAll(dir)
  const env = ghShim(dir, { prs: [] })
  const rep = statusJson(dir, env)
  const beta = rep.specs.find(s => s.name === 'beta')
  assert.equal(beta.state, 'blocked')
  assert.deepEqual(beta.blockedBy, ['alpha'])
})

// Branch names are chosen by sc from the task text (`feat/permissions-single-table`)
// and worktree dirs are codenames (`sc-zero-perovskite-654b`), so neither carries
// the contract slug. The conducted worktree announces itself in .wf/active instead.
test('status: a worktree conducting the contract is running, whatever its branch is called', () => {
  const dir = gitRepo()
  const file = writeSpec(dir, baseFrontmatter({ name: 'alpha' }), { name: 'alpha' })
  commitAll(dir)
  const wt = join(dir, 'sc-zero-perovskite-654b')
  execFileSync('git', ['-C', dir, 'worktree', 'add', '-q', '-b', 'feat/unrelated-name', wt])
  runGate(['begin', file], { cwd: wt })
  const rep = statusJson(dir, ghShim(dir, { prs: [] }))
  const rec = rep.specs.find(s => s.name === 'alpha')
  assert.equal(rec.state, 'running')
  assert.ok(rec.worktree.endsWith('sc-zero-perovskite-654b'), rec.worktree)
})

test('status: a worktree conducting another contract does not mark this one running', () => {
  const dir = gitRepo()
  writeSpec(dir, baseFrontmatter({ name: 'alpha' }), { name: 'alpha' })
  const other = writeSpec(dir, baseFrontmatter({ name: 'beta' }), { name: 'beta' })
  commitAll(dir)
  const wt = join(dir, 'wt-beta')
  execFileSync('git', ['-C', dir, 'worktree', 'add', '-q', '-b', 'feat/beta', wt])
  runGate(['begin', other], { cwd: wt })
  const rep = statusJson(dir, ghShim(dir, { prs: [] }))
  assert.equal(rep.specs.find(s => s.name === 'alpha').state, 'ready')
  assert.equal(rep.specs.find(s => s.name === 'beta').state, 'running')
})

test('status: open PR carrying the invisible wf-spec comment → pr-open with unresolved count', () => {
  const dir = gitRepo()
  writeSpec(dir, baseFrontmatter({ name: 'alpha' }), { name: 'alpha' })
  commitAll(dir)
  const env = ghShim(dir, {
    prs: [{ number: 7, state: 'OPEN', isDraft: true, title: 'alpha', headRefName: 'feat-alpha', body: 'Short body.\n\n<!-- wf-spec: alpha -->' }],
    unresolved: { 7: 2 },
  })
  const rep = statusJson(dir, env)
  const alpha = rep.specs.find(s => s.name === 'alpha')
  assert.equal(alpha.state, 'pr-open')
  assert.equal(alpha.pr.number, 7)
  assert.equal(alpha.unresolvedThreads, 2)
})

test('status: without --dir resolves ~/Workspace/specs/<project> from the origin remote', () => {
  const dir = gitRepo()
  writeFileSync(join(dir, 'README.md'), 'x\n')
  commitAll(dir)
  execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', 'git@github.com:acme/rocket-proj.git'])
  const home = tmp()
  const specsDir = join(home, 'Workspace', 'specs', 'rocket-proj')
  mkdirSync(join(specsDir, 'alpha'), { recursive: true })
  writeFileSync(join(specsDir, 'alpha', 'contract.md'),
    `---\n${'name: alpha\n'}---\n\n# Kontrakt\n\n## Akceptační kritéria\n\n- ok\n`)
  const env = { ...ghShim(dir, { prs: [] }), HOME: home }
  const rep = statusJson(dir, env, [])
  assert.equal(rep.specs.find(s => s.name === 'alpha').state, 'ready')
})

test('status: missing specs dir yields an empty list, not an error', () => {
  const dir = gitRepo()
  writeFileSync(join(dir, 'README.md'), 'x\n')
  commitAll(dir)
  const env = { ...ghShim(dir, { prs: [] }), HOME: tmp() }
  const rep = statusJson(dir, env, [])
  assert.deepEqual(rep.specs, [])
})

// ── receipts (begin / verify / attest) ──────────────────────────────────────

function head(dir) {
  return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
}

function receipts(dir) {
  return readFileSync(join(dir, '.wf', 'receipts.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l))
}

test('begin: records the active spec and git-excludes .wf/', () => {
  const dir = gitRepo()
  writeSpec(dir, baseFrontmatter({ name: 'alpha' }), { name: 'alpha' })
  commitAll(dir)
  const r = runGate(['begin', 'specs/alpha/contract.md'], { cwd: dir })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(readFileSync(join(dir, '.wf', 'active'), 'utf8').trim(), 'specs/alpha/contract.md')
  assert.match(readFileSync(join(dir, '.git', 'info', 'exclude'), 'utf8'), /\.wf\//)
})

test('begin works inside a linked worktree, where .git is a file', () => {
  const dir = gitRepo()
  const file = writeSpec(dir, baseFrontmatter({ name: 'alpha' }), { name: 'alpha' })
  commitAll(dir)
  const wt = join(dir, 'sc-linked-worktree')
  execFileSync('git', ['-C', dir, 'worktree', 'add', '-q', '-b', 'feat/linked', wt])
  const r = runGate(['begin', file], { cwd: wt })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.ok(existsSync(join(wt, '.wf', 'active')))
  // .wf/ must be ignored there too, or every gate run dirties the tree.
  const porcelain = execFileSync('git', ['status', '--porcelain'], { cwd: wt, encoding: 'utf8' })
  assert.doesNotMatch(porcelain, /\.wf/, porcelain)
})

test('verify in a git repo appends a receipt with HEAD and result', () => {
  const dir = gitRepo()
  writeSpec(dir, baseFrontmatter({ name: 'alpha' }), { name: 'alpha' })
  commitAll(dir)
  runGate(['begin', 'specs/alpha/contract.md'], { cwd: dir })
  const r = runGate(['verify', 'specs/alpha/contract.md', 'full', '--json'], { cwd: dir })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const rec = receipts(dir).at(-1)
  assert.equal(rec.type, 'verify')
  assert.equal(rec.mode, 'full')
  assert.equal(rec.result, 'pass')
  assert.equal(rec.head, head(dir))
  assert.equal(rec.dirty, false)
})

test('attest review appends an attest receipt at HEAD', () => {
  const dir = gitRepo()
  writeSpec(dir, baseFrontmatter({ name: 'alpha' }), { name: 'alpha' })
  commitAll(dir)
  runGate(['begin', 'specs/alpha/contract.md'], { cwd: dir })
  const r = runGate(['attest', 'review', 'specs/alpha/contract.md'], { cwd: dir })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const rec = receipts(dir).at(-1)
  assert.equal(rec.type, 'attest')
  assert.equal(rec.phase, 'review')
  assert.equal(rec.head, head(dir))
})

// ── wf-hook (PreToolUse gh pr guard) ─────────────────────────────────────────

const HOOK = new URL('./wf-hook.mjs', import.meta.url).pathname

function runHook(command, dir) {
  return spawnSync('node', [HOOK], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: dir }),
    encoding: 'utf8',
    timeout: 30_000,
  })
}

function wfRepo() {
  const dir = gitRepo()
  writeSpec(dir, baseFrontmatter({ name: 'alpha' }), { name: 'alpha' })
  commitAll(dir)
  runGate(['begin', 'specs/alpha/contract.md'], { cwd: dir })
  return dir
}

test('hook: repo without .wf/active → pr create allowed', () => {
  const dir = gitRepo()
  writeSpec(dir, baseFrontmatter({ name: 'alpha' }), { name: 'alpha' })
  commitAll(dir)
  assert.equal(runHook('gh pr create --draft', dir).status, 0)
})

test('hook: active spec without receipts → pr create blocked', () => {
  const dir = wfRepo()
  const r = runHook('gh pr create --draft', dir)
  assert.equal(r.status, 2)
  assert.match(r.stderr, /verify/i)
})

test('hook: full verify + review attest at HEAD → pr create allowed', () => {
  const dir = wfRepo()
  runGate(['verify', 'specs/alpha/contract.md', 'full'], { cwd: dir })
  runGate(['attest', 'review', 'specs/alpha/contract.md'], { cwd: dir })
  assert.equal(runHook('gh pr create --draft --title x', dir).status, 0)
})

test('hook: commits after the receipts → pr create blocked as stale', () => {
  const dir = wfRepo()
  runGate(['verify', 'specs/alpha/contract.md', 'full'], { cwd: dir })
  runGate(['attest', 'review', 'specs/alpha/contract.md'], { cwd: dir })
  writeFileSync(join(dir, 'later.txt'), 'change after gates\n')
  commitAll(dir)
  const r = runHook('gh pr create --draft', dir)
  assert.equal(r.status, 2)
  assert.match(r.stderr, /HEAD|stale/i)
})

test('hook: gh pr merge is always blocked in a wf worktree', () => {
  const dir = wfRepo()
  runGate(['verify', 'specs/alpha/contract.md', 'full'], { cwd: dir })
  runGate(['attest', 'review', 'specs/alpha/contract.md'], { cwd: dir })
  const r = runHook('gh pr merge 7 --squash', dir)
  assert.equal(r.status, 2)
  assert.match(r.stderr, /merge/i)
})

test('hook: unrelated gh pr command passes through', () => {
  const dir = wfRepo()
  assert.equal(runHook('gh pr view 7 --json state', dir).status, 0)
  assert.equal(runHook("gh pr list --search 'create merge'", dir).status, 0)
})

test('hook: flags and aliases around the subcommand do not slip past the guard', () => {
  const dir = wfRepo()
  for (const command of [
    'gh -R owner/repo pr create --draft',
    'gh --repo=owner/repo pr create',
    'gh -Rowner/repo pr create --draft', // attached short-option value
    'gh pr -Rowner/repo merge 7',        // flag after the pr subcommand
    'gh pr new --title x',              // documented alias of pr create
    'gh -R owner/repo pr merge 7 --squash',
    'cd /tmp && gh pr create --draft',
    '/opt/homebrew/bin/gh pr merge 7',  // absolute path
  ]) {
    assert.equal(runHook(command, dir).status, 2, `not blocked: ${command}`)
  }
})

test('hook: commands the conductor legitimately needs are not blocked', () => {
  const dir = wfRepo()
  for (const command of [
    'gh pr view 7 --json state',
    'gh pr checks',
    "gh pr list --search 'create merge'",
    'gh pr comment 3 --body "fixed; merge after CI is green"', // prose mentioning merge
    'gh pr merge --help', // help output changes nothing
    'gh pr create -h',
    'git commit -m "create the merge helper"',
  ]) {
    assert.equal(runHook(command, dir).status, 0, `wrongly blocked: ${command}`)
  }
})

test('hook: dirty working tree blocks pr create even with complete receipts', () => {
  const dir = wfRepo()
  runGate(['verify', 'specs/alpha/contract.md', 'full'], { cwd: dir })
  runGate(['attest', 'review', 'specs/alpha/contract.md'], { cwd: dir })
  writeFileSync(join(dir, 'uncommitted.txt'), 'work in progress\n')
  const r = runHook('gh pr create --draft', dir)
  assert.equal(r.status, 2)
  assert.match(r.stderr, /uncommitted/i)
})

test('status: a contract directory carries its artifacts and archives as one move', () => {
  const dir = gitRepo()
  const file = writeSpec(dir, baseFrontmatter({ name: 'alpha' }), { name: 'alpha' })
  // Everything a contract produces lives beside it, so nothing is orphaned.
  writeFileSync(join(dirname(file), 'explanation.md'), '# Vysvětlení\n')
  commitAll(dir)
  const rep = statusJson(dir, ghShim(dir, { prs: [] }), ['--dir', 'specs'])
  const rec = rep.specs.find(s => s.name === 'alpha')
  assert.equal(rec.state, 'ready')
  assert.ok(rec.file.endsWith(join('specs', 'alpha', 'contract.md')), rec.file)
  assert.equal(basename(dirname(rec.file)), 'alpha')
  assert.ok(existsSync(join(dirname(rec.file), 'explanation.md')))
})

test('status: ignores directories without a contract.md, including _archive', () => {
  const dir = gitRepo()
  writeSpec(dir, baseFrontmatter({ name: 'alpha' }), { name: 'alpha' })
  mkdirSync(join(dir, 'specs', '_archive', 'old'), { recursive: true })
  writeFileSync(join(dir, 'specs', '_archive', 'old', 'contract.md'), '---\nname: old\n---\n\n## Akceptační kritéria\n- ok\n')
  mkdirSync(join(dir, 'specs', 'notes'), { recursive: true })
  writeFileSync(join(dir, 'specs', 'notes', 'scratch.md'), 'just notes\n')
  commitAll(dir)
  const rep = statusJson(dir, ghShim(dir, { prs: [] }), ['--dir', 'specs'])
  assert.deepEqual(rep.specs.map(s => s.name), ['alpha'])
})

test('status: merged PR → done, and unblocks dependents', () => {
  const dir = gitRepo()
  writeSpec(dir, baseFrontmatter({ name: 'alpha' }), { name: 'alpha' })
  writeSpec(dir, baseFrontmatter({ name: 'beta', depends_on: ['alpha'] }), { name: 'beta' })
  commitAll(dir)
  const env = ghShim(dir, {
    prs: [{ number: 7, state: 'MERGED', isDraft: false, title: 'alpha', headRefName: 'feat-alpha', body: '<!-- wf-spec: alpha -->' }],
  })
  const rep = statusJson(dir, env)
  assert.equal(rep.specs.find(s => s.name === 'alpha').state, 'done')
  assert.equal(rep.specs.find(s => s.name === 'beta').state, 'ready')
})

// ── full-gate lock ───────────────────────────────────────────────────────────
// Full gates from parallel worktrees must not contend for the machine
// (containers, timing benches). quick stays lock-free.

function lockEnv(dir, over = {}) {
  return { WF_GATE_LOCK_DIR: join(dir, 'locks'), WF_GATE_LOCK_POLL_MS: '50', ...over }
}

function holdLock(dir, pid) {
  const lock = join(dir, 'locks', `${basename(dir)}.lock`)
  mkdirSync(lock, { recursive: true })
  writeFileSync(join(lock, 'pid'), String(pid))
  return lock
}

test('verify full: waits on a live lock and fails after the lock timeout', () => {
  const dir = tmp()
  const file = writeSpec(dir, baseFrontmatter())
  holdLock(dir, process.pid) // this test process is alive → lock is genuinely held
  const r = runGate(['verify', file, 'full'], { cwd: dir, env: lockEnv(dir, { WF_GATE_LOCK_TIMEOUT_MS: '400' }) })
  assert.notEqual(r.status, 0)
  assert.match(r.stdout + r.stderr, /lock/i)
})

test('verify full: removes a stale lock (dead pid) and proceeds', () => {
  const dir = tmp()
  const file = writeSpec(dir, baseFrontmatter())
  const dead = spawnSync('/bin/bash', ['-c', 'echo $$']).stdout.toString().trim()
  holdLock(dir, dead) // that shell has exited → pid is dead → lock is stale
  const r = runGate(['verify', file, 'full'], { cwd: dir, env: lockEnv(dir) })
  assert.equal(r.status, 0, r.stdout + r.stderr)
})

test('verify full: releases the lock after the run', () => {
  const dir = tmp()
  const file = writeSpec(dir, baseFrontmatter())
  const r = runGate(['verify', file, 'full'], { cwd: dir, env: lockEnv(dir) })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(existsSync(join(dir, 'locks', `${basename(dir)}.lock`)), false)
})

test('verify quick: ignores the full-gate lock', () => {
  const dir = tmp()
  const file = writeSpec(dir, baseFrontmatter())
  holdLock(dir, process.pid)
  const r = runGate(['verify', file, 'quick'], { cwd: dir, env: lockEnv(dir, { WF_GATE_LOCK_TIMEOUT_MS: '400' }) })
  assert.equal(r.status, 0, r.stdout + r.stderr)
})
