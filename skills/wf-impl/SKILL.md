---
name: wf-impl
description: Dirigent jednoho workflow kontraktu ve svém super.engineering worktree — deleguje implementaci na subagenta, mezi fázemi pouští wf-gate, review předá skill wf-review, otevře draft PR (guardovaný), vyřeší komentáře, spustí UAT. Použij, když task session říká, že se má kontrakt provést přes wf-impl.
---

# /wf-impl — dirigent kontraktu (worktree session)

Diriguješ, produkční kód nepíšeš. Každá fáze je delegace a přechod mezi fázemi
se řídí VÝHRADNĚ exit kódy wf-gate — „hotovo" od agenta neznamená nic. Nikdy
nespouštěj `sc worktree create`. Foreground příkazy dávej do `gtimeout <s>`,
dlouhé běhy do `bg_start` — nikdy neomezený foreground watch.

GATE = `node ~/Workspace/pi-ext/wf/wf-gate.mjs`
SPEC = absolutní cesta ke `contract.md` z tvého tasku (kontrakt má vlastní
adresář `~/Workspace/specs/<projekt>/<název>/`, kde vzniknou i jeho ostatní
artefakty). Když tam soubor není, zastav a reportuj — kontrakt si nevymýšlej
a nehledej ho v repu.

Extension `wf-gate` blokuje `gh pr create`, dokud v `.wf/receipts.jsonl` není
průchozí FULL verify, průchozí verify na aktuálním čistém HEADu a review attest
na tomtéž HEADu; `gh pr merge` je tu blokovaný vždy. Guard neobcházej, splň ho —
`reason` ti řekne, který receipt chybí.

## Fáze 0 — orientace (a zároveň resume)

1. Přečti SPEC, spusť `GATE begin SPEC` (nabije guard).
2. `GATE agents SPEC --json` → `impl` a `review`. Modely nikdy neodhaduj z YAML.
3. Hotové fáze odvoď z reality: git log na branchi, `GATE verify SPEC quick`,
   `gh pr view --json state`. Pokračuj od první nedokončené.

## Fáze 1 — implementace

`subagent_spawn` s `harness`, `model` a `reasoning_effort` z `impl`,
`working_dir` = tenhle worktree. Zadání:

> Implementuj kontrakt na `<SPEC>` striktně TDD, ale po **skupinách kritérií**:
> nejdřív si kritéria rozděl na soudržné celky (jeden modul nebo jedno chování,
> typicky 3–5 kritérií, celkem ideálně do osmi skupin) a ten rozpad napiš do
> reportu. Pak na každou skupinu jeden cyklus: RED (jeden test soubor s testy
> celé skupiny, všechny padají ze správného důvodu) → GREEN (minimální kód) →
> refactor jen na zeleném. V RED/GREEN pouštěj **jen dotčený test soubor** a
> tiše (`--test-reporter=dot`); celou sadu nepouštěj vůbec, tu vlastní gate.
> Kontext si drž krátký: nevypisuj soubory, které jsi právě zapsal, a nečti
> znovu to, co už máš v kontextu.
> Z kontraktu si přečti sekce Akceptační kritéria, Strategie testování, Scope,
> Non-goals a Přístup; frontmatter, verify a review plán jsou věc dirigenta.
> Kritérium, které na baseline už
> platí (zachované chování, regrese), RED nemá a mít nemůže: napiš k němu
> charakterizační test, ukaž ho zelený před i po změně a označ ho v reportu
> jako regresní. Nikdy kvůli RED nerozbíjej produkční kód. Drž se sekce Scope, respektuj
> non-goals a vyloučené přístupy. Test nikdy neoslabuj, aby prošel. Commituj po
> každé skupině (Conventional Commits); branch nepřejmenovávej. Žádné review,
> nespouštěj revieweře. **Nikdy `gh pr create` ani `gh pr merge`** — endgame
> vlastní dirigent (u codex harnessu je tahle věta jediná obrana, guard tam
> není). Produktové rozhodnutí, které z kontraktu neodvodíš, nehádej: skonči
> a napiš tu otázku do svého reportu.

Zatímco běží, postup měř na faktech: `git log --oneline` (nové commity) a
`subagent_check`. Uživatel může běh sledovat i převzít přes `/subagents`.

Skončí-li subagent otázkou místo hotové práce, eskaluj (viz Blokace) a další
kolo spusť s odpovědí v zadání.

## Fáze 2 — full gate

`GATE verify SPEC full --json` spouštíš SÁM. Full gaty se napříč worktree
serializují zámkem — „waiting for the full-gate lock" je fronta, ne zásek.

Při failu spusť nového subagenta se zadáním: co přesně padlo (id záznamu +
tail výstupu), co už předchozí pokus udělal a jaké hypotézy vyloučil (vezmi
z jeho reportu), a ať diagnostikuje od nuly — předchozím závěrům nevěří, ověří
je. Max **3 opravná kola**; bez nového signálu čtvrté nespouštěj, zastav
a eskaluj. Warningy a odložené záznamy patří do popisu PR.

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
přeskoč a napiš to; explain běží tak jako tak. `wf-explain` zapíše
`explanation.md` vedle kontraktu — cestu dej do finálního reportu.

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
