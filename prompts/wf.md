---
description: Workflow planner — sestav kontrakt do ~/Workspace/specs/<project>/<name>.md; implementaci spustíš přes /wf-run v Claude Code
argument-hint: "<cíl>"
---

Cíl: $@

Vytvoř workflow kontrakt pro tento cíl. Nepiš žádný produkční kód — výstupem
je jediný soubor. Implementaci, review, PR i UAT řídí Claude Code pipeline;
ty jen připravíš kontrakt.

Kontrakt žije MIMO repo: `~/Workspace/specs/<project>/<name>.md`, kde
`<project>` = basename origin remote URL bez `.git` (fallback: název adresáře
repa) a `<name>` = kebab-case název odvozený z cíle. Nikdy ho necommituj —
záměrně se nesmí objevit v žádném pushi ani PR diffu.

GATE = `node ~/.claude/wf/wf-gate.mjs`

## 1. Tělo kontraktu (česky)

Sestav z naší dosavadní diskuse; chybějící body si u mě doptej, nehádej.
Stručně a výstižně — každý bod pár vět nebo odrážky, žádná omáčka:

- **Současné chování / reprodukce:** jak to funguje teď; u bugu přesný postup reprodukce
- **Akceptační kritéria:** pozorovatelná chování — každé kritérium = jeden budoucí test
- **Strategie testování:** pro každé kritérium typ a úroveň testu
  (unit/integrační/e2e), přes jaké veřejné rozhraní, s jakými daty. Netestovatelné
  kritérium nahlas teď, ne po implementaci
- **Přístup:** preferovaná řešení a co je vyloučené (např. „žádná nová
  závislost") — odvoď z diskuse, jinak se zeptej
- **Non-goals:** co vědomě neřešíme
- **Scope:** povolené soubory/moduly (používá se i na detekci kolizí mezi kontrakty)
- **Business shrnutí:** 2–4 věty pro popis draft PR — co a proč, pro
  netechnického čtenáře
- **UAT:** co má uživatel ručně ověřit z uživatelského pohledu

## 2. Frontmatter (strojová část, anglicky)

```yaml
---
name: <kebab-case>
depends_on: []            # names of specs that must be merged first
uat: auto                 # auto = pipeline runs UAT; manual = user runs it
engines:
  conductor: {model: opus}
  impl: {agent: pi, model: openai-codex/gpt-5.6-sol}   # or {agent: claude, model: sonnet} / {agent: codex, model: <id>}
  uat: {model: opus}
review:
  rounds:
    - reviewers:
        - {focus: correctness-smoke, model: opus}
        - {focus: bugs-edge-cases, model: opus, effort: high}
    - reviewers:
        - {focus: re-review-changed-areas, model: opus}
verify:
  quick:
    - {id: fast, kind: hard, command: "<project quick check>", timeoutMs: 600000}
  full:
    - {id: full, kind: hard, command: "<project full check>", timeoutMs: 3600000}
---
```

Druhy verify záznamů (všechny spouští wf-gate, nikdy agent): `hard` (exit kód
rozhoduje — default), `eval` (příkaz tiskne JSON metriku; `metric` + `min`,
volitelně `warn_below`), `perf` (timing; přidej `requires_idle: true`, ať se
na vytíženém stroji odloží jako warning místo flaky failu), `judge` (bez
příkazu; `rubric` + `min_score` 1–5 pro kvalitativní kritéria). Každý záznam
může nést `severity: warning` — reportuje se, neblokuje.

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

Review plán škáluj podle rizika: triviální změna = 1 kolo × 1 reviewer;
běžná = 2 kola (smoke + deep); riziková = 3 kola, max 4 revieweři v kole 1.
Fokusy hloubkových reviewerů vybírej podle toho, na co změna sahá: security
(auth/vstupy/secrets), architecture (napříč moduly, nová API/závislosti),
test-quality (velké zásahy do testů), performance (hot paths, N+1),
data-safety (migrace, destruktivní operace), over-engineering (hodně nového
kódu/abstrakcí). Cross-model review je vynucené lintem: reviewer nesmí mít
stejný model jako impl (`same_model_review: allow` je explicitní výjimka,
jen na výslovné přání).

## 3. Lint a schválení

1. Zapiš `~/Workspace/specs/<project>/<name>.md` (adresář založ, pokud chybí)
   a spusť `GATE check <ta cesta>`. Oprav každý nález — kontrakt
   s placeholdery/TODO nesmí tímto krokem projít.
2. Ukaž mi: shrnutí kontraktu + review plán (kola, fokusy, modely) + engines +
   verify tabulku + plnou cestu k souboru. Zeptej se, jestli chci něco doladit.
3. Nic neimplementuj a nedělej žádné git operace. Připomeň mi, že spuštění
   udělám přes `/wf-run` v Claude Code.
