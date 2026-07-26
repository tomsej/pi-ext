#!/usr/bin/env node
// wf evals — behavioural checks for the wf skills.
//
// A skill is prose, so the only honest test is: give a headless agent that
// prose and a sandbox, then assert on what it actually produced. Assertions
// are deterministic (files, git state, wf-gate exit codes) — never "looks
// good". This is the safety net for shortening the skills: cut, re-run, and
// the pass rate says whether the cut removed words or guarantees.
//
//   node wf/evals/run.mjs [--case <name>] [--model <id>] [--repeat <n>] [--keep] [--json]
//
// Each case runs in a throwaway git repo with a unique origin remote, so the
// contract lands in its own ~/Workspace/specs/<project>/ and never touches
// real specs. Costs real tokens and minutes: run it on demand, not in npm test.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

const SKILLS = new URL('../../skills/', import.meta.url).pathname
const GATE = new URL('../wf-gate.mjs', import.meta.url).pathname
const DEFAULT_MODEL = 'openai-codex/gpt-5.6-sol'

const skill = name => readFileSync(join(SKILLS, name, 'SKILL.md'), 'utf8')
const gate = (args, cwd) => spawnSync('node', [GATE, ...args], { cwd, encoding: 'utf8', timeout: 120_000 })

// ── helpers shared by assertions ─────────────────────────────────────────────

/** The single contract the agent was supposed to write, or null. */
function theSpec(ctx) {
  if (!existsSync(ctx.specsDir)) return null
  const dirs = readdirSync(ctx.specsDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && existsSync(join(ctx.specsDir, e.name, 'contract.md')))
  return dirs.length === 1 ? join(ctx.specsDir, dirs[0].name, 'contract.md') : null
}

const check = (name, ok, detail = '') => ({ name, ok: Boolean(ok), detail })

/** Assertions every contract-writing case shares. */
function contractBasics(ctx) {
  const spec = theSpec(ctx)
  const out = [check('wrote exactly one contract.md in its own directory', spec, spec ?? `found ${existsSync(ctx.specsDir) ? readdirSync(ctx.specsDir).join(', ') : 'no specs dir'}`)]
  if (!spec) return out

  const lint = gate(['check', spec], ctx.dir)
  out.push(check('wf-gate check passes', lint.status === 0, (lint.stdout + lint.stderr).trim().split('\n').slice(0, 4).join(' | ')))

  const agents = gate(['agents', spec, '--json'], ctx.dir)
  out.push(check('roster resolves', agents.status === 0, agents.stderr.trim().split('\n')[0] ?? ''))

  // Tool caches (.sem index, .wf receipts, .pi state) are not the agent editing
  // the project; the guarantee is that no source file changed and nothing was
  // committed.
  const TOOL_CACHES = /^..\s+\.(sem|wf|pi|pi-subagents)\//
  const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: ctx.dir, encoding: 'utf8' })
    .split('\n')
    .filter(l => l.trim() && !TOOL_CACHES.test(l))
  out.push(check('left the repo untouched', dirty.length === 0, dirty.slice(0, 3).join(' | ')))

  const commits = execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: ctx.dir, encoding: 'utf8' }).trim()
  out.push(check('committed nothing', commits === '1', `${commits} commits`))
  return out
}

/** Czech section headings the contract body must carry. */
function hasSections(spec, sections) {
  const body = readFileSync(spec, 'utf8').split(/^---$/m).slice(2).join('---')
  return sections.map(s => check(`body has "${s}"`, new RegExp(s, 'i').test(body)))
}

// ── cases ────────────────────────────────────────────────────────────────────

const CASES = [
  {
    name: 'wf/contract',
    skill: 'wf',
    goal: 'parseDuration má podporovat i dny ("2d").',
    fixture(dir) {
      mkdirSync(join(dir, 'src'))
      writeFileSync(join(dir, 'src', 'parse.js'), 'export function parseDuration(s) {\n  const m = /^(\\d+)(s|m|h)$/.exec(s);\n  if (!m) throw new Error("bad duration");\n  return Number(m[1]) * { s: 1, m: 60, h: 3600 }[m[2]];\n}\n')
      writeFileSync(join(dir, 'src', 'parse.test.js'), 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { parseDuration } from "./parse.js";\n\ntest("hours", () => assert.equal(parseDuration("2h"), 7200));\n')
      writeFileSync(join(dir, 'package.json'), '{\n  "name": "demo",\n  "type": "module",\n  "scripts": { "test": "node --test src/" }\n}\n')
    },
    assert(ctx) {
      const out = contractBasics(ctx)
      const spec = theSpec(ctx)
      if (!spec) return out
      out.push(...hasSections(spec, ['Akceptační kritéria', 'Scope', 'Business shrnutí', 'UAT', 'Non-goals']))
      const fm = readFileSync(spec, 'utf8').split(/^---$/m)[1] ?? ''
      // The project has exactly one runner; inventing another one is the failure.
      out.push(check('verify uses the project test command', /npm (run )?test|node --test/.test(fm), fm.match(/command: *"[^"]*"/g)?.join(' ') ?? ''))
      out.push(check('spec lives outside the repo', !spec.startsWith(ctx.dir), spec))
      return out
    },
  },
  {
    name: 'wf/no-runner',
    skill: 'wf',
    goal: 'Přidej do CLI příkaz `status`, který vypíše verzi.',
    // No test script anywhere: the skill must not fabricate `npm test`.
    fixture(dir) {
      writeFileSync(join(dir, 'cli.sh'), '#!/bin/sh\necho "usage: cli [help]"\n')
      writeFileSync(join(dir, 'README.md'), '# cli\n\nA POSIX shell CLI. Checks are run manually with `sh cli.sh help`.\n')
    },
    assert(ctx) {
      const out = contractBasics(ctx)
      const spec = theSpec(ctx)
      if (!spec) return out
      const fm = readFileSync(spec, 'utf8').split(/^---$/m)[1] ?? ''
      out.push(check('did not invent an npm/cargo/pytest runner', !/(npm|yarn|pnpm) (run )?test|cargo test|pytest/.test(fm), fm.match(/command: *"[^"]*"/g)?.join(' ') ?? ''))
      return out
    },
  },
  {
    name: 'wf/risky-change',
    skill: 'wf',
    goal: 'Přepiš ukládání session tokenů: teď se ukládají v plaintextu do ~/.app/tokens.json, chci je šifrované.',
    fixture(dir) {
      mkdirSync(join(dir, 'src'))
      writeFileSync(join(dir, 'src', 'tokens.js'), 'import { writeFileSync, readFileSync } from "node:fs";\n\nexport function saveToken(t) {\n  writeFileSync(process.env.HOME + "/.app/tokens.json", JSON.stringify({ token: t }));\n}\n\nexport function loadToken() {\n  return JSON.parse(readFileSync(process.env.HOME + "/.app/tokens.json", "utf8")).token;\n}\n')
      writeFileSync(join(dir, 'package.json'), '{\n  "name": "app",\n  "type": "module",\n  "scripts": { "test": "node --test src/" }\n}\n')
    },
    assert(ctx) {
      const out = contractBasics(ctx)
      const spec = theSpec(ctx)
      if (!spec) return out
      const agents = JSON.parse(gate(['agents', spec, '--json'], ctx.dir).stdout || '{}')
      const reviewers = (agents.review ?? []).flat()
      // Risk scales the panel, never the rounds — and security must be looked at.
      out.push(check('review panel grew for a risky change', reviewers.length >= 2, `${reviewers.length} reviewers: ${reviewers.map(r => r.focus).join(', ')}`))
      out.push(check('a reviewer focuses on security', reviewers.some(r => /security|data-safety/.test(r.focus)), reviewers.map(r => r.focus).join(', ')))
      out.push(check('at most 2 rounds', (agents.review ?? []).length <= 2, `${(agents.review ?? []).length} rounds`))
      return out
    },
  },
]

// ── runner ───────────────────────────────────────────────────────────────────

const PREAMBLE = `Jsi headless: uživatel NENÍ k dispozici a na nic se ho nemůžeš zeptat.
Kde by sis vyžádal jeho rozhodnutí, rozhodni sám podle toho, co vidíš v repu,
a to rozhodnutí poznač do výstupu. Postupuj přesně podle téhle skill:`

function runCase(testCase, { model, keep }) {
  const id = randomBytes(3).toString('hex')
  const project = `wfeval-${testCase.name.split('/')[1]}-${id}`
  const dir = mkdtempSync(join(tmpdir(), 'wf-eval-'))
  const specsDir = join(homedir(), 'Workspace', 'specs', project)

  execFileSync('git', ['init', '-q', '.'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 'eval@example.com'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 'eval'], { cwd: dir })
  testCase.fixture(dir)
  execFileSync('git', ['add', '-A'], { cwd: dir })
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir })
  execFileSync('git', ['remote', 'add', 'origin', `git@github.com:wf-evals/${project}.git`], { cwd: dir })

  const prompt = `Cíl: ${testCase.goal}\n\n${PREAMBLE}\n\n${skill(testCase.skill)}`
  const started = Date.now()
  const run = spawnSync('pi', ['-p', '--no-session', '--model', model, prompt], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 900_000,
    env: { ...process.env, WF_EVAL: '1' },
  })
  const ctx = { dir, specsDir, project, log: (run.stdout ?? '') + (run.stderr ?? '') }

  let checks
  try {
    checks = testCase.assert(ctx)
  } catch (e) {
    checks = [check('assertions ran', false, e.message)]
  }
  if (run.status !== 0) checks.unshift(check('agent exited cleanly', false, `exit ${run.status}${run.error ? ` (${run.error.message})` : ''}`))

  const result = { case: testCase.name, ms: Date.now() - started, checks, sandbox: dir, specsDir }
  if (!keep) {
    rmSync(dir, { recursive: true, force: true })
    rmSync(specsDir, { recursive: true, force: true })
  }
  return result
}

const argv = process.argv.slice(2)
const arg = (flag, fallback) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : fallback)
const only = arg('--case', null)
const model = arg('--model', DEFAULT_MODEL)
const repeat = Number(arg('--repeat', 1))
const keep = argv.includes('--keep')
const json = argv.includes('--json')

const selected = CASES.filter(c => !only || c.name.includes(only))
if (selected.length === 0) {
  process.stderr.write(`no case matches "${only}" (have: ${CASES.map(c => c.name).join(', ')})\n`)
  process.exit(2)
}

const results = []
for (let i = 0; i < repeat; i++) {
  for (const testCase of selected) {
    if (!json) process.stdout.write(`▶ ${testCase.name}${repeat > 1 ? ` (run ${i + 1}/${repeat})` : ''} … `)
    const r = runCase(testCase, { model, keep })
    const failed = r.checks.filter(c => !c.ok)
    if (!json) process.stdout.write(`${failed.length === 0 ? '✔' : `✖ ${failed.length}/${r.checks.length}`} (${Math.round(r.ms / 1000)}s)\n`)
    for (const c of failed) if (!json) process.stdout.write(`    ✖ ${c.name}${c.detail ? ` — ${c.detail}` : ''}\n`)
    results.push(r)
  }
}

const total = results.reduce((n, r) => n + r.checks.length, 0)
const passed = results.reduce((n, r) => n + r.checks.filter(c => c.ok).length, 0)
const cleanCases = results.filter(r => r.checks.every(c => c.ok)).length

if (json) {
  process.stdout.write(JSON.stringify({ model, results, passed, total, cleanCases, cases: results.length }, null, 2) + '\n')
} else {
  process.stdout.write(`\n${cleanCases}/${results.length} cases clean, ${passed}/${total} checks passed (model ${model})\n`)
  const lengths = [...new Set(selected.map(c => c.skill))].map(s => `${s}: ${skill(s).split('\n').length} lines`)
  process.stdout.write(`skills under test — ${lengths.join(', ')}\n`)
}
process.exit(cleanCases === results.length ? 0 : 1)
