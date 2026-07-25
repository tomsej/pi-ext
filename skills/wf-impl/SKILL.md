---
name: wf-impl
description: Dirigent jednoho workflow kontraktu ve svém super.engineering worktree — spustí implementační engine, mezi fázemi pouští wf-gate, review předá skill wf-review, otevře draft PR (guardovaný), vyřeší komentáře, spustí UAT. Použij, když task session říká, že se má kontrakt provést přes wf-impl.
---

# /wf-impl — dirigent kontraktu (worktree session)

Diriguješ, produkční kód nepíšeš. Každá fáze je delegace a přechod mezi fázemi
se řídí VÝHRADNĚ exit kódy wf-gate — „hotovo" od agenta neznamená nic. Nikdy
nespouštěj `sc worktree create`. Foreground příkazy dávej do `gtimeout <s>`,
dlouhé běhy do `bg_start` — nikdy neomezený foreground watch.

GATE = `node ~/Workspace/pi-ext/wf/wf-gate.mjs`
SPEC = absolutní cesta ke kontraktu z tvého tasku. Když tam soubor není, zastav
a reportuj — kontrakt si nevymýšlej a nehledej ho v repu.

Extension `wf-gate` blokuje `gh pr create`, dokud v `.wf/receipts.jsonl` není
průchozí FULL verify, průchozí verify na aktuálním čistém HEADu a review attest
na tomtéž HEADu; `gh pr merge` je tu blokovaný vždy. Guard neobcházej, splň ho —
`reason` ti řekne, který receipt chybí.

## Fáze 0 — orientace (a zároveň resume)

1. Přečti SPEC, spusť `GATE begin SPEC` (nabije guard).
2. `GATE agents SPEC --json` → `impl` a `review`. Modely nikdy neodhaduj z YAML.
3. Hotové fáze odvoď z reality: git log na branchi, `GATE verify SPEC quick`,
   `gh pr view --json state`. Pokračuj od první nedokončené.
4. Před dlouhým během ověř klíče a model (chybějící API klíč nesmí vyplavat po
   hodinách): `pi -p --no-session --no-extensions --no-skills --model <impl.model> "Reply with exactly: OK"`.
   U `impl.harness: pi` zajisti session id: `[ -f .wf/impl-session ] || uuidgen > .wf/impl-session`

## Fáze 1 — implementace

Zadání (stejné pro každý harness): implementuj SPEC striktně TDD, jedno
kritérium po druhém (RED: jeden failující test, padá ze správného důvodu →
GREEN: minimální kód → refactor jen na zeleném). Drž se Scope, respektuj
non-goals a vyloučené přístupy. Test nikdy neoslabuj, aby prošel. Commit po
každém kritériu (Conventional Commits) — commity jsou signál postupu. Branch
nepřejmenovávej. Žádné review. **Nikdy `gh pr create` ani `gh pr merge`** —
endgame vlastníš ty (u codex harnessu je tahle věta jediná obrana, guard tam
není).

- **`pi`** → `bg_start` v tomhle worktree, ať zůstane resumovatelný:

  ```
  pi -p --session-id $(cat .wf/impl-session) --no-extensions --no-skills \
     --model <impl.model>:<impl.effort> "<zadání>" > .wf/impl-run.log 2>&1
  ```

  Do zadání přidej: produktové rozhodnutí, které z kontraktu neodvodíš, napiš do
  `.wf/impl-blocked.md` a skonči; nehádej.

  Postup sleduj na faktech, ne na textu terminálu: nové commity (`git log
  --oneline`), mtime session logu
  `~/.pi/agent/sessions/*/*_$(cat .wf/impl-session).jsonl`, a než vyslovíš
  „zaseklo se", `ps` na živé build/test procesy — tichá kompilace je práce.

  Po skončení: existuje-li `.wf/impl-blocked.md`, eskaluj (viz Blokace), soubor
  SMAŽ (stará otázka nesmí přežít do dalšího pollu) a pokračuj ve stejné session:
  `pi --session $(cat .wf/impl-session) -p "Answer: <rozhodnutí>. Continue."`
  Uživatel se může připojit přes `pi --session $(cat .wf/impl-session)`, kdykoli
  proces neběží.

- **`claude` / `codex`** → `subagent_spawn` s `harness`/`model`/`reasoning_effort`
  z `impl`. Nemají resumovatelnou session: opravné kolo = nový subagent, kterému
  předáš předchozí stav (blokaci reportují ve výsledku, ne souborem).

## Fáze 2 — full gate

`GATE verify SPEC full --json` spouštíš SÁM. Full gaty se napříč worktree
serializují zámkem — „waiting for the full-gate lock" je fronta, ne zásek. Při
failu vrať výstup padajícího záznamu implementátorovi:
`pi --session $(cat .wf/impl-session) -p "The gate failed: <id + tail>. Diagnose and fix."`

Max 3 opravná kola na hypotézu. Pak je session přítěž (obří kontext,
zabetonovaná hypotéza) — rotuj místo patchování:

1. Handoff ze staré session: `pi --session $(cat .wf/impl-session) -p "Stop
   fixing. Write .wf/impl-handoff.md: current state per acceptance criterion,
   what you tried, the exact failing output, and which hypotheses are ruled out
   and why. Then stop."` Zkontroluj ho a dopiš, co vynechal.
2. `uuidgen > .wf/impl-session` a spusť čerstvý běh se zadáním: přečti
   `.wf/impl-handoff.md` a SPEC, diagnostikuj od nuly — předchozím hypotézám
   nevěř, ověř je — a dokonči zbylá kritéria.
3. Když i čerstvá session vyčerpá kola, zastav a eskaluj. Nikdy nerotuj dvakrát
   bez nového signálu.

Warningy a odložené záznamy patří do popisu PR.

## Fáze 3 — review

Načti skill `wf-review` a proveď ji pro SPEC. Reportuje-li FAILED (nevyřešené
legitimní nálezy), zastav a eskaluj — na PR nepokračuj.

## Fáze 4 — ship (dvě souběžné větve z attestovaného HEADu)

- **A (repo/PR):** draft PR → CI → vyřeš komentáře, které existují teď.
- **B (mimo repo):** UAT → explain. Nesahá na git ani PR thready, takže s A
  nekoliduje.

Pohne-li fix z větve A HEADem, výstup větve B je zastaralý — obě jsou
idempotentní, stačí je spustit znovu. Napiš to do reportu.

Větev B: při `uat: auto` načti skill `wf-uat` pro SPEC, jeho report pak předej
skillu `wf-explain` (spolu s posledním gate reportem). Při `uat: manual` UAT
přeskoč a napiš to; explain běží tak jako tak. `wf-explain` vrátí cestu k HTML
vedle kontraktu — dej ji do finálního reportu.

Větev A: `gh pr create --draft`, titulek ve stylu Conventional Commits. Popis
VŽDY anglicky a krátce (max ~120 slov před markerem):

```
## Why
<1–2 sentences — the contract's Business shrnutí, translated to English>

## What changed
<2–4 bullets, behavior-level — never a file-by-file narration>

## Verification
<1–3 bullets: full gate PASS, review rounds done, CI>

<!-- wf-spec: <name> -->
```

HTML komentář `<!-- wf-spec: <name> -->` je literál a na GitHubu neviditelný —
`GATE status` podle něj páruje PR se specem; nikdy ho nevynechej. Žádná vata,
žádný detail, který diff ukazuje sám. Warningy/odložené gaty přilep jako sbalený
`<details><summary>Gate warnings</summary>` checklist (nezaškrtnutý, dokud to
nedokáže CI nebo idle běh); bez warningů sekci vynech.

CI sleduj omezenými polly (`gh pr checks`, nikdy `--watch`) a posuzuj výhradně
podle `gh run view <run-id> --json status,conclusion` — exit kód watcheru už
hlásil zeleno na padlém běhu. Po každém novém commitu: `GATE verify SPEC quick`,
a byly-li fixy netriviální, i nový `GATE attest review SPEC`.

Komentáře (boti, code scanning, rychlí lidi): ověř proti kódu, legitimní oprav,
na každý thread odpověz commitem nebo zdůvodněním na úrovni kódu. **Nikdy
nemerguj.** Změnily-li fixy viditelné chování, srovnej „What changed" s diffem.
Další dávky komentářů přijdou dispatchem z `wf-run`.

## Blokace?

Produktové rozhodnutí, které z kontraktu neodvodíš → otázka tam, kde ji uživatel
uvidí (komentář na PR nebo `sc worktree review-add`), a v reportu napiš, že fáze
stojí na jeho odpovědi. Nikdy nehádej, nikdy neumři potichu.

## Finální report (česky)

Fáze, commity, výsledky gatů včetně warningů, výsledek review, PR link, UAT nebo
ruční kroky, cesta k vysvětlení, cokoli nevyřešeného.
