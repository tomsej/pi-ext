---
name: wf-impl
description: Dirigent jednoho workflow kontraktu ve svém super.engineering worktree — spustí implementační engine, mezi fázemi pouští wf-gate, review předá skill wf-review, otevře draft PR (guardovaný), vyřeší komentáře, spustí UAT. Použij, když task session říká, že se má kontrakt provést přes wf-impl.
---

# /wf-impl — dirigent kontraktu (worktree session)

Diriguješ; produkční kód nepíšeš sám. Každá fáze je delegace a přechody mezi
fázemi se dějí VÝHRADNĚ podle exit kódů wf-gate — tvrzení agenta „hotovo"
neznamená nic. Nikdy nespouštěj `sc worktree create`. Každý foreground příkaz
si dej do timeboxu (`gtimeout <s>` z coreutils); dlouhé běhy patří do
`bg_start`, nikdy do neomezeného foreground watche.

Extension `wf-gate` (načtená v tomhle pi) vynucuje endgame deterministicky:
`gh pr create` je blokovaný, dokud v `.wf/receipts.jsonl` neexistuje průchozí
FULL verify, průchozí verify na aktuálním čistém HEADu a review attest na tomhle
HEADu — a `gh pr merge` je tady blokovaný vždy. S guardem neválči, splň ho.
Blok dostaneš jako `reason` přímo v kontextu, včetně chybějícího receiptu.

GATE = `node ~/Workspace/pi-ext/wf/wf-gate.mjs`
SPEC = ABSOLUTNÍ cesta ke kontraktu z tvého tasku (specy jsou mimo repo,
v `~/Workspace/specs/<project>/`). Když soubor na té přesné cestě není, zastav
a reportuj — nikdy si kontrakt nevymýšlej, nikdy ho nehledej v repu.

## Fáze 0 — zorientuj se (a zároveň resume cesta)

1. Přečti SPEC celý, pak spusť `GATE begin SPEC` (označí worktree jako
   wf-dirigovaný; nabije guard).
2. Zjisti agenty: `GATE agents SPEC --json` → `impl` (`{name, harness, model,
   effort}`) a `review` (kola × revieweři s `focus`). Nikdy neodhaduj modely
   z YAML očima.
3. Odvoď z reality, které fáze jsou hotové: git log na téhle branchi,
   `GATE verify SPEC quick`, existence PR (`gh pr view --json state`).
   Pokračuj od první nedokončené fáze.
4. Když je implementace ještě před tebou a `impl.harness` je `pi`:
   - ujisti se, že session id existuje:
     `[ -f .wf/impl-session ] || uuidgen > .wf/impl-session`
   - smoke test klíčů a modelu PŘED dlouhým během (chybějící API klíč nesmí
     vyplavat po hodinách):
     `pi -p --no-session --no-extensions --no-skills --model <impl.model> "Reply with exactly: OK"`

## Fáze 1 — implementuj

Zadání (stejné pro všechny harnessy): implementuj SPEC striktně TDD — jedno
akceptační kritérium po druhém (RED: jeden failující test, ukázaný jak padá ze
správného důvodu → GREEN: minimální kód → refactor jen na zeleném). Zůstaň
uvnitř Scope; respektuj non-goals a vyloučené přístupy. Nikdy neoslabuj test,
aby prošel. Commit po každém kritériu (Conventional Commits) — commity jsou
signál postupu. Branch nikdy nepřejmenovávej. Žádné review, žádní revieweři.

Podle `impl.harness`:

- **`pi`** (default) → headless běh v tomhle worktree jako background task
  (`bg_start`), aby zůstal resumovatelný:

  ```
  pi -p --session-id $(cat .wf/impl-session) --no-extensions --no-skills \
     --model <impl.model>:<impl.effort> "<zadání>" > .wf/impl-run.log 2>&1
  ```

  Do zadání přidej: když narazíš na produktové rozhodnutí, které z kontraktu
  neodvodíš, napiš otázku do `.wf/impl-blocked.md` a skonči; nehádej.

  Zatímco to běží, každých pár minut kontroluj FAKTA — nikdy neparsuj text
  terminálu:
  - `git log --oneline` — nové commity jsou postup;
  - heartbeat session logu — mtime
    `~/.pi/agent/sessions/*/*_$(cat .wf/impl-session).jsonl`;
  - než vyslovíš „zaseklo se": `ps` na živé build/test procesy — tichý
    gate/kompilace je práce, ne hang.

  Když proces skončí: existuje-li `.wf/impl-blocked.md`, eskaluj (viz Blokace),
  pak ten soubor SMAŽ (stará otázka nesmí přežít do dalšího pollu) a pokračuj ve
  STEJNÉ session s odpovědí:
  `pi --session $(cat .wf/impl-session) -p "Answer: <rozhodnutí>. Continue."`

  Uživatel se může kdykoli (když proces neběží) připojit interaktivně:
  `pi --session $(cat .wf/impl-session)` v tomhle worktree.

- **`claude` / `codex`** → `subagent_spawn` s `harness`, `model` a
  `reasoning_effort` z `impl` a se stejným zadáním (bez protokolu
  `.wf/impl-blocked.md` — subagent blokaci reportuje ve svém výsledku). Tyhle
  harnessy nemají resumovatelnou session: opravné kolo = nový subagent, kterému
  předáš předchozí stav.

Každému delegovanému agentovi (impl i reviewerům) do zadání napši: **nikdy
nespouštěj `gh pr create` ani `gh pr merge`** — endgame vlastníš ty. U pi je
guard extension, u Claude PreToolUse hook, ale codex harness žádný guard nemá:
tam je ta věta v zadání jediná obrana.

## Fáze 2 — gate (full)

`GATE verify SPEC full --json` spusť SÁM. Plné gaty se napříč worktree
serializují zámkem per projekt — řádka „waiting for the full-gate lock" je
normální frontění, ne zásek. Při failu vrať výstup padajícího záznamu
implementátorovi — pro pi:
`pi --session $(cat .wf/impl-session) -p "The gate failed: <id + tail>. Diagnose and fix."`

Max 3 opravná kola na hypotézu. Po 3 neúspěšných kolech je session přítěž
(obří kontext, zabetonovaná špatná hypotéza) — místo dalšího patchování rotuj:

1. Vyžádej si handoff od STARÉ session:
   `pi --session $(cat .wf/impl-session) -p "Stop fixing. Write .wf/impl-handoff.md: current state per acceptance criterion, what you tried, the exact failing output, and which hypotheses are ruled out and why. Then stop."`
   Soubor si zkontroluj; dopiš, co vynechal.
2. Rotuj: `uuidgen > .wf/impl-session` (staré id se dá dohledat v session dir).
3. Spusť ČERSTVÝ headless běh (stejný příkaz jako fáze 1) se zadáním: přečti
   `.wf/impl-handoff.md` a SPEC, diagnostikuj znovu od nuly — předchozím
   hypotézám nevěř, ověř je — a dokonči zbylá kritéria.
4. Když i čerstvá session vyčerpá kola, zastav a eskaluj (viz Blokace).
   Nikdy nerotuj dvakrát bez nového signálu.

Warningy a odložené záznamy musí skončit v popisu PR.

## Fáze 3 — review

Načti skill `wf-review` a proveď ji pro SPEC. Odjede review plán z kontraktu
(cross-model), aplikuje fixy, přepustí quick gate a attestuje fázi. Když
reportuje FAILED (nevyřešené legitimní nálezy), zastav a eskaluj — na PR
nepokračuj.

## Fáze 4 — ship (dvě souběžné větve z attestovaného HEADu)

Jak dosedne review attest z fáze 3, endgame se dělí na dvě větve, které nesdílí
zdroj a na sebe nečekají — spusť je souběžně:

- **Větev A (repo/PR):** otevři draft PR → sleduj CI → vyřeš review komentáře,
  které existují teď (nejčastěji Copilot / code scanning; lidi tak rychle
  neodpovídají).
- **Větev B (mimo repo):** UAT → vysvětlení. UAT nesahá na repo (disposable
  instance, ne-default port) a explain zapisuje jen HTML soubor, takže ani
  jedno nekoliduje s git/gh/PR prací větve A.

Když fix komentáře ve větvi A pohne HEADem, větev B běžela proti starému
commitu — to je v pořádku a čekané: `wf-explain` i `wf-uat` jsou idempotentní,
takže je stačí potom spustit znovu.

Větev B: má-li SPEC `uat: auto`, načti skill `wf-uat` a proveď ji pro SPEC, pak
její report předej `wf-explain`. Při `uat: manual` UAT přeskoč (napiš to) a
explain spusť stejně.

Větev A — otevři PR. `gh pr create --draft` — titulek ve stylu Conventional
Commits, z kontraktu. Popis: VŽDY anglicky, KRÁTKÝ (max ~120 slov před
markerem), přesně tohohle tvaru:

```
## Why
<1–2 sentences — the contract's Business shrnutí, translated to English>

## What changed
<2–4 bullets, behavior-level — never a file-by-file narration>

## Verification
<1–3 bullets: full gate PASS, review rounds done, CI; UAT runs alongside and
its manual steps land in the conductor's Czech report, not on the PR>

<!-- wf-spec: <name> -->
```

HTML komentář `<!-- wf-spec: <name> -->` je literál a na GitHubu neviditelný —
`GATE status` podle něj páruje PR se specem, nikdy ho nevynechej ani
nepřeformuluj. Žádná vata („This PR introduces…"), žádný detail, který diff
ukazuje sám. Vyprodukoval-li nějaký gate warningy nebo odložené záznamy (např.
odložený perf gate), přilep sbalený `<details><summary>Gate warnings</summary>`
checklist — nezaškrtnutý, dokud to nedokáže CI nebo idle běh; bez warningů
sekci vynech úplně.

Když guard vytvoření PR zablokuje, jeho `reason` jmenuje chybějící receipt —
běž ho splnit, nikdy ho neobcházej. CI sleduj omezenými polly (`gh pr checks`;
nikdy neomezené `--watch`) a běhy posuzuj VÝHRADNĚ podle
`gh run view <run-id> --json status,conclusion` — exit kód watcheru už hlásil
zeleno na padlých bězích. Červené checky oprav (každý nový commit znamená:
`GATE verify SPEC quick` + `GATE attest review SPEC` znovu, byly-li fixy
netriviální — zopakuj závěrečné kroky wf-review).

Pak vyřeš PR komentáře, které existují teď (boti, code scanning, rychlí lidi):
ověř proti kódu, legitimní oprav, na každý thread odpověz commitem s fixem nebo
zdůvodněním na úrovni kódu. Nikdy nemerguj (guard to vynucuje taky). Další
dávky komentářů přijdou dispatchem z `wf-run` — řeš je stejně. Změnily-li fixy
uživatelsky viditelné chování, uprav bullety „What changed" v popisu PR — popis
nesmí driftovat od diffu. Každý fix komentáře, který pohne HEADem, dělá report
větve B zastaralým — napiš do finálního reportu, ať uživatel spustí
`wf-explain` znovu (a `wf-uat`, změnilo-li se chování).

## Explain (konec větve B)

Načti skill `wf-explain`, proveď ji pro SPEC a předej jí report z `wf-uat`
(ruční kroky + mapování kritérium→scénář) a poslední gate report — zapíše bohaté
české vysvětlení změny jako samostatný HTML soubor vedle kontraktu
(`~/Workspace/specs/<project>/<name>.explanation.html`), včetně tabulky
validace kritérií a zaškrtávatelné sekce „UAT — jak si to ověřit sám"; vrácenou
cestu dej do finálního reportu. Pohnula-li větev A později HEADem, `wf-explain`
je idempotentní — napiš to, ať to uživatel obnoví jedním příkazem.

## Blokace?

Produktové rozhodnutí, které z kontraktu neodvodíš → napiš otázku tam, kde ji
uživatel uvidí (komentář na PR nebo `sc worktree review-add`) a v reportu jasně
řekni, že fáze stojí na jeho odpovědi. Nikdy nehádej, nikdy neumři potichu.

## Finální report (česky)

Dokončené fáze, commity, výsledky gatů včetně warningů, výsledek review
(z wf-review), odkaz na PR, výsledek UAT nebo ruční kroky, cesta k vysvětlení,
cokoliv nevyřešeného.
