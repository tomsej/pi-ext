---
name: wf
description: Vytvoř workflow kontrakt z dosavadní diskuse — zapíše ~/Workspace/specs/<projekt>/<název>/contract.md (české tělo + strojový frontmatter) a zlintuje ho wf-gate. Použij, když uživatel řekne /wf nebo chce z probraného problému udělat kontrakt. Nikdy neimplementuje.
disable-model-invocation: true
---

# /wf — tvorba kontraktu

Z diskuse uděláš kontrakt. Výstup je JEDEN soubor — žádný kód, žádný git.
Spuštění řeší později `wf-run`.

GATE = `node ~/Workspace/pi-ext/wf/wf-gate.mjs`
Cesta: `~/Workspace/specs/<projekt>/<název>/contract.md` — `<projekt>` =
basename origin remote bez `.git` (fallback: adresář repa), `<název>` =
kebab-case. Vlastní adresář — přibudou artefakty (`explanation.md`), archivace
= jeden přesun. Mimo repo záměrně — nesmí se objevit v commitu ani PR diffu.

## 1. Tělo (česky, odrážky)

Co jde zjistit z repa, zjisti z repa; na zbytek se doptej — nehádej.

### Styl

- Používej jeden název pro jednu věc.
- Piš aktivně a používej krátká běžná slova.
- Jedna věta nebo odrážka obsahuje jednu hlavní myšlenku.
- Vynech výplňové úvodní fráze, opakování a marketingová přídavná jména.
- Stručnost nesmí odstranit podmínku, hranici ani pozorovatelné chování.

### Sekce

- **Současné chování / reprodukce:** jak to funguje teď; u bugu přesná reprodukce.
- **Business shrnutí:** 2–4 věty pro netechnického čtenáře — v PR z toho bude
  anglická sekce „Why".
- **Akceptační kritéria:** pozorovatelná chování, každé = jeden budoucí test.
  - Kritérium = největší chování ověřitelné jedním testem; sdílená fixture +
    jiná data = JEDNO kritérium s tabulkou případů.
  - Rozpočet ~12; přes 15 = slučuješ špatně, vrať se k tabulkám. Jemnější
    rozpad stojí jeden TDD cyklus navíc za kus.
  - Pořadí kroků, remíza, hraniční případ: rozhodnutí napiš přímo do kritéria,
    nebo jako otevřenou otázku — nedopsané pravidlo si každý vyloží jinak
    a review to neodhalí.
- **Strategie testování:** ke každému kritériu typ testu (unit/integrační/e2e),
  veřejné rozhraní a data. Netestovatelné kritérium nahlas teď, ne po implementaci.
- **Technický handoff** (netriviální změny): invarianty, změněná veřejná
  rozhraní, současný → navržený call stack, rizika. Neznámé nevymýšlej.
  Invarianty pozorovatelně („stejný vstup dá stejný výstup"), nikdy jako
  mechanismus („stav je immutable") — implementaci volí implementátor.
- **Přístup:** preferovaná řešení a co je vyloučené (např. „žádná nová závislost").
- **Non-goals:** co vědomě neřešíme.
- **Scope:** povolené soubory/moduly — `wf-run` z nich detekuje kolize kontraktů.
- **UAT:** co má uživatel ověřit ručně, ze svého pohledu.

## 2. Frontmatter (anglicky)

```yaml
---
name: <kebab-case>
uat: auto                 # auto = pipeline runs wf-uat; manual = user runs it
# after: [contract-name]  # uncomment only for a real merged prerequisite

conductor: opus           # pi session in the worktree; omit = pi default model
impl: sol
review:                   # rounds run in order, reviewers inside a round in parallel
  - correctness-smoke: cc
    bugs-edge-cases: codex
  - re-review-changed-areas: cc

verify:
  preflight:
    - {id: environment, kind: hard, command: "<cheap disk/runtime/dependency check>", timeoutMs: 60000}
  quick:
    - {id: fast, kind: hard, command: "<project quick check>", timeoutMs: 600000}
  full:
    - {id: functional, kind: hard, command: "<integration + freshness checks>", timeoutMs: 3600000}
    - {id: performance, kind: perf, command: "<timing benchmarks only>", requires_idle: true, timeoutMs: 3600000}
---
```

### Agenti

Role se odkazují jménem z rosteru. Builtiny (autoritativní výpis:
`GATE agents <spec>`):
`opus` pi/anthropic/claude-opus-5 · `sol` pi/openai-codex/gpt-5.6-sol ·
`terra` pi/openai-codex/gpt-5.6-terra · `glm` pi/zai/glm-5.2 ·
`cc` claude/fable · `codex` codex/gpt-5.6-sol

- Vlastní agent jen když builtin nestačí (tvar = parametry `subagent_spawn`):
  `agents: {sol-max: {harness: pi, model: openai-codex/gpt-5.6-sol, effort: max}}`
- Lint vynucuje: `conductor` = pi agent (dirigent JE ta pi session); reviewer
  nesmí mít stejný `harness`+`model` jako `impl` (`same_model_review: allow`
  jen na výslovné přání, nikdy pro rizikový kontrakt).
- Review plán škáluj rizikem: triviální = 1 kolo × 1 reviewer; běžná = 2 kola
  (smoke + deep); riziková = 2 kola, až 4 revieweři v kole 1 — riziko škáluje
  panel, ne počet kol.
- Fokusy podle změny: security (auth/vstupy/secrets), architecture (napříč
  moduly, nová API), test-quality, performance (hot paths, N+1), data-safety
  (migrace, destruktivní operace), over-engineering.

### Verify

Druhy: `hard` (exit kód rozhoduje — default) · `eval` (příkaz tiskne JSON;
`metric` + `min`, volitelně `warn_below`) · `perf` (přidej `requires_idle:
true`, ať se na vytíženém stroji odloží místo flaky failu) · `judge` (bez
příkazu: `rubric`, `min_score` 1–5, `agent` z rosteru — kvalitativní kritéria).
`severity: warning` = reportuje se, neblokuje.

Strukturální pravidla („žádný console.log mimo logger", „handler volá auth") =
`hard` s `ast-grep scan`, ne `judge` — deterministické a zadarmo; pravidla
v projektu zakládá skill `review-guards`.

Pravidla příkazů (každé zaplacené nočním během):

- Má-li projekt gate skript / task runner, odkazuj na něj — jeden zdroj pravdy
  pro pipeline, CI i ruční běh; žádné inline mega-příkazy.
- Nový gate skript jen když projekt task runner nemá **a** full má víc než
  jednu fázi; jinak `verify` míří přímo na existující příkaz (`npm test`,
  `cargo test`, `make check`). Pojmenované fáze, timeouty a kill-tree níž jsou
  požadavky na *existující* gate, ne důvod psát nový.
- quick = levná kontrola po review fixech; full = všechno a pokrývá všechna
  kritéria přes veřejná rozhraní. Drahé kontroly do quick nepatří.
- `timeoutMs` musí přežít **studený start** ve svěžím worktree (deps, build, cache).
- Žádné maskování exit kódu (`|| true`, `; true`, `allowFailure`) — lint zamítne.
- Testy o sdílené zdroje (kontejnery, porty, benchmarky) běží serializovaně;
  plné gaty napříč worktree serializuje wf-gate sám.
- Gate loguje po pojmenovaných fázích (fail jmenuje konkrétní stage) a po
  timeoutu zabíjí celý strom svých potomků — orphan proces otráví další pokusy.
- full si musí vyrobit i gitignored artefakty — jinak projde lokálně a spadne
  v CI na čistém checkoutu.

## 3. Lint a schválení

1. Zapiš spec (adresář založ), spusť `GATE check <cesta>`, oprav každý nález —
   placeholdery/TODO neprojdou.
2. Ukaž uživateli: shrnutí + `GATE agents <spec>` + verify tabulku + plnou
   cestu. Zeptej se na schválení, dolaď.
3. NIC neimplementuj — spuštění proběhne přes `wf-run`.
