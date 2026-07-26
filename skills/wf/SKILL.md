---
name: wf
description: Vytvoř workflow kontrakt z dosavadní diskuse — zapíše ~/Workspace/specs/<projekt>/<název>/contract.md (české tělo + strojový frontmatter) a zlintuje ho wf-gate. Použij, když uživatel řekne /wf nebo chce z probraného problému udělat kontrakt. Nikdy neimplementuje.
---

# /wf — tvorba kontraktu

Z diskuse uděláš kontrakt. Výstup je JEDEN soubor a nic jiného — žádný kód,
žádné git operace. Spuštění řeší později `wf-run`.

GATE = `node ~/Workspace/pi-ext/wf/wf-gate.mjs`
Cesta: `~/Workspace/specs/<projekt>/<název>/contract.md`, kde `<projekt>` =
basename origin remote bez `.git` (fallback: název adresáře repa) a `<název>` =
kebab-case. Vlastní adresář, protože vedle kontraktu vzniknou i jeho další
artefakty (`explanation.md`) — archivace je pak jeden přesun. Mimo repo
záměrně: kontrakt se nesmí objevit v žádném commitu ani PR diffu.

## 1. Tělo (česky, odrážky, žádná omáčka)

Co zjistíš z repa, zjisti z repa; na zbytek se doptej, nehádej.

- **Současné chování / reprodukce:** jak to funguje teď; u bugu přesná reprodukce
- **Business shrnutí:** 2–4 věty pro netechnického čtenáře — stane se z toho
  anglická sekce „Why" v PR
- **Akceptační kritéria:** pozorovatelná chování; každé = jeden budoucí test
- **Strategie testování:** ke každému kritériu typ testu (unit/integrační/e2e),
  veřejné rozhraní a data. Netestovatelné kritérium nahlas teď, ne po implementaci
- **Technický handoff** (netriviální změny): invarianty, změněná veřejná
  rozhraní, současný → navržený call stack, rizika. Neznámé nevymýšlej
- **Přístup:** preferovaná řešení a co je vyloučené (např. „žádná nová závislost")
- **Non-goals:** co vědomě neřešíme
- **Scope:** povolené soubory/moduly — `wf-run` z toho detekuje kolize kontraktů
- **UAT:** co má uživatel ověřit ručně, ze svého pohledu

## 2. Frontmatter (anglicky)

```yaml
---
name: <kebab-case>
depends_on: []            # specs that must be merged first
uat: auto                 # auto = pipeline runs wf-uat; manual = user runs it

conductor: opus           # pi session in the worktree; omit = pi default model
impl: sol
review:                   # rounds run in order, reviewers inside a round in parallel
  - correctness-smoke: cc
    bugs-edge-cases: codex
  - re-review-changed-areas: cc

verify:
  quick:
    - {id: fast, kind: hard, command: "<project quick check>", timeoutMs: 600000}
  full:
    - {id: full, kind: hard, command: "<project full check>", timeoutMs: 3600000}
---
```

### Agenti

Role se odkazují jménem z rosteru. Builtiny (autoritativní výpis:
`GATE agents <spec>`):
`opus` pi/anthropic/claude-opus-5 · `sol` pi/openai-codex/gpt-5.6-sol ·
`terra` pi/openai-codex/gpt-5.6-terra · `glm` pi/zai/glm-5.2 ·
`cc` claude/fable · `codex` codex/gpt-5.6-sol

Vlastního agenta přidej, jen když builtin nestačí (tvar = parametry
`subagent_spawn`): `agents: {sol-max: {harness: pi, model: openai-codex/gpt-5.6-sol, effort: max}}`

Lint vynucuje: `conductor` musí být pi agent (dirigent JE ta pi session);
reviewer nesmí mít stejný `harness`+`model` jako `impl` (`same_model_review:
allow` je výjimka jen na přání uživatele).

Review plán škáluj rizikem: triviální = 1 kolo × 1 reviewer; běžná = 2 kola
(smoke + deep); riziková = pořád 2 kola, ale až 4 revieweři v kole 1 — riziko
škáluje panel, ne počet kol. Fokusy podle toho, na co změna sahá: security
(auth/vstupy/secrets), architecture (napříč moduly, nová API), test-quality,
performance (hot paths, N+1), data-safety (migrace, destruktivní operace),
over-engineering.

### Verify

Druhy: `hard` (exit kód rozhoduje — default), `eval` (příkaz tiskne JSON;
`metric` + `min`, volitelně `warn_below`), `perf` (přidej `requires_idle: true`,
ať se na vytíženém stroji odloží místo flaky failu), `judge` (bez příkazu:
`rubric`, `min_score` 1–5, `agent` z rosteru — na kvalitativní kritéria).
`severity: warning` = reportuje se, neblokuje.

Pravidla příkazů (každé zaplacené nočním během):

- má-li projekt gate skript / task runner, odkazuj na něj — jeden zdroj pravdy
  pro pipeline, CI i ruční běh; žádné inline mega-příkazy
- quick = levná kontrola po review fixech; full = všechno a musí pokrýt všechna
  kritéria přes veřejná rozhraní; drahé kontroly do quick nepatří
- `timeoutMs` musí přežít **studený start** ve svěžím worktree (deps, build, cache)
- žádné maskování exit kódu (`|| true`, `; true`, `allowFailure`) — lint zamítne
- testy o sdílené zdroje (kontejnery, porty, benchmarky) musí běžet serializovaně;
  plné gaty napříč worktree serializuje wf-gate sám
- gate skript loguje po pojmenovaných fázích (aby fail jmenoval konkrétní stage,
  ne „gate failed") a po timeoutu zabíjí celý strom svých potomků — orphan
  proces otráví každý další pokus
- full si musí vyrobit i gitignored artefakty, jinak projde lokálně a spadne
  v CI na čistém checkoutu

## 3. Lint a schválení

1. Zapiš spec (adresář založ) a spusť `GATE check <cesta>`. Oprav každý nález —
   kontrakt s placeholdery/TODO neprojde.
2. Ukaž uživateli: shrnutí + `GATE agents <spec>` + verify tabulku + plnou cestu.
   Zeptej se na schválení, dolaď.
3. NIC neimplementuj. Spuštění proběhne přes `wf-run`.
