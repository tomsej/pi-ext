---
name: wf
description: Vytvoř workflow kontrakt z dosavadní diskuse — zapíše ~/Workspace/specs/<project>/<name>.md (české tělo + strojový frontmatter) a zlintuje ho wf-gate. Použij, když uživatel řekne /wf nebo chce z probraného problému udělat kontrakt. Nikdy neimplementuje.
---

# /wf — tvorba kontraktu

Z předchozí diskuse uděláš kontrakt. Výstupem je JEDEN artefakt a nic jiného —
žádný produkční kód, žádná implementace. Spuštění řeší později `wf-run`
v samostatných worktree.

Kontrakty žijí MIMO repo, v `~/Workspace/specs/<project>/<name>.md`, kde
`<project>` = basename origin remote URL bez `.git` (fallback: název adresáře
repa) a `<name>` = kebab-case odvozený z cíle. Je to záměr: žádné commity do
chráněných branchí, žádné hádanky s viditelností branchí — každý worktree čte
kontrakt absolutní cestou a nikdy se neobjeví v žádném PR diffu.

GATE = `node ~/Workspace/pi-ext/wf/wf-gate.mjs`

## 1. Tělo kontraktu (česky)

Sestav z diskuse a z relevantního kódu a dokumentace. Co lze zjistit z repa,
zjisti z repa; na zbytek se doptej, nehádej. Stručně — odrážky, ne omáčka:

- **Současné chování / reprodukce:** jak to funguje teď; u bugu přesný postup reprodukce
- **Business shrnutí:** 2–4 věty — co a proč, pro netechnického čtenáře;
  pipeline z něj udělá sekci „Why" anglického PR popisu, tak žádná omáčka
- **Akceptační kritéria:** pozorovatelná chování — každé kritérium = jeden budoucí test
- **Strategie testování:** pro každé kritérium typ a úroveň testu
  (unit/integrační/e2e), přes jaké veřejné rozhraní, s jakými daty. Netestovatelné
  kritérium nahlas teď, ne po implementaci
- **Technický handoff (jen pro netriviální změny):** invarianty; změněná
  veřejná rozhraní/typy; současný → navržený call stack; odpovědnosti dotčených
  modulů; rizika a otevřené otázky. Neznámé nevymýšlej
- **Přístup:** preferovaná řešení a co je vyloučené (např. „žádná nová
  závislost") — odvoď z diskuse, jinak se zeptej
- **Non-goals:** co vědomě neřešíme
- **Scope:** povolené soubory/moduly (používá i `wf-run` na detekci kolizí)
- **UAT:** co má uživatel ručně ověřit ze svého pohledu

## 2. Frontmatter (strojová část, anglicky)

```yaml
---
name: <kebab-case>
depends_on: []            # names of specs that must be merged first
uat: auto                 # auto = pipeline runs wf-uat; manual = user runs it

conductor: opus           # pi session in the worktree; omit = pi with its own default model
impl: sol                 # who implements
review:                   # list of rounds; reviewers inside a round run in parallel
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

Role se odkazují jménem z rosteru. Builtin roster (`GATE agents <spec>` ho
vypíše vyřešený, ať nehádáš):

| jméno | harness | model | k čemu |
|---|---|---|---|
| `opus` | pi | anthropic/claude-opus-5 | dirigent, review, judge |
| `sol` | pi | openai-codex/gpt-5.6-sol | default implementace |
| `terra` | pi | openai-codex/gpt-5.6-terra | druhý názor na implementaci |
| `glm` | pi | zai/glm-5.2 | levné mechanické kroky |
| `cc` | claude | fable | Claude Code jako reviewer |
| `codex` | codex | gpt-5.6-sol | Codex CLI jako reviewer |

Vlastního agenta přidej jen když builtin nestačí — `agents:` přepisuje i
doplňuje roster, tvar je stejný jako parametry `subagent_spawn`:

```yaml
agents:
  sol-max: {harness: pi, model: openai-codex/gpt-5.6-sol, effort: max}
impl: sol-max
```

Pravidla (lint je vynucuje, neobcházej je):

- `conductor` musí být pi agent — dirigent JE ta pi session ve worktree
- cross-model review: reviewer nesmí mít stejný `harness`+`model` jako `impl`
  (na jméno v rosteru se nehledí, na pár ano). `same_model_review: allow` je
  výslovná výjimka, jen na přání uživatele
- review plán škáluj podle rizika: triviální změna = 1 kolo × 1 reviewer;
  běžná = 2 kola (smoke + deep); riziková = pořád 2 kola, až 4 revieweři
  v kole 1 — riziko škáluje panel, ne počet kol
- fokusy hloubkových reviewerů vybírej podle toho, na co změna sahá: security
  (auth/vstupy/secrets), architecture (napříč moduly, nová API/závislosti),
  test-quality (velké zásahy do testů), performance (hot paths, N+1),
  data-safety (migrace, destruktivní operace), over-engineering (hodně nového
  kódu/abstrakcí)

### Verify záznamy

Druhy (všechny spouští wf-gate, nikdy agent): `hard` (exit kód rozhoduje —
default), `eval` (příkaz tiskne JSON metriku; `metric` + `min`, volitelně
`warn_below`), `perf` (timing; přidej `requires_idle: true`, ať se na
vytíženém stroji odloží jako warning místo flaky failu), `judge` (bez příkazu;
`rubric` + `min_score` 1–5 a `agent:` z rosteru pro kvalitativní kritéria —
čitelnost docs, kvalita chybových hlášek). Každý záznam může nést
`severity: warning` — reportuje se, neblokuje.

Pravidla pro verify příkazy (zaplacená nočními běhy — nevynechávej je):

- má-li projekt gate skript / task runner (`just gate <name> fast|full` apod.),
  odkazuj na něj — jediný zdroj pravdy pro pipeline, CI i ruční běh; žádné
  inline mega-příkazy
- quick = levná kontrola po review fixech; full = všechno a musí pokrýt všechna
  akceptační kritéria přes veřejná rozhraní; drahé kontroly do quick nepatří
- `timeoutMs` musí přežít **studený start** v čerstvém worktree (deps, build,
  cache) — jinak první plný běh přeteče a shodí celou fázi
- žádné maskování exit kódu: `|| true`, `; true`, `allowFailure` lint zamítne
- testy soupeřící o sdílené zdroje (kontejnery, porty, timing benchmarky) musí
  běžet serializovaně; plné gaty napříč worktree serializuje wf-gate zámkem sám
- gate skript musí logovat po pojmenovaných fázích, aby selhání jmenovalo
  konkrétní stage/test místo „gate failed", a po timeoutu/přerušení zabít celý
  strom svých potomků — orphaný build/test proces otráví každý další pokus
- full nesmí spoléhat na gitignored lokální artefakty (build výstupy) — musí
  si je vyrobit sám, jinak projde lokálně a spadne v CI na čistém checkoutu

## 3. Lint a schválení

1. Zapiš `~/Workspace/specs/<project>/<name>.md` (adresář založ, pokud chybí)
   a spusť `GATE check <ta cesta>`. Oprav každý nález — kontrakt
   s placeholdery/TODO tímhle krokem nesmí projít.
2. Ukaž uživateli: shrnutí kontraktu + review plán (kola, fokusy, agenti) +
   `GATE agents <spec>` tabulku + verify tabulku + plnou cestu k souboru.
   Zeptej se na schválení, dolaď. Žádné git operace — kontrakt je mimo repo.
3. NIC neimplementuj. Řekni uživateli, že spuštění udělá přes `wf-run`.
