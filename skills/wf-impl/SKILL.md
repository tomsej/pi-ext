---
name: wf-impl
description: Dirigent jednoho workflow kontraktu ve svém super.engineering worktree — deleguje implementaci na subagenta, mezi fázemi pouští wf-gate, review předá skill wf-review, otevře draft PR (guardovaný), vyřeší komentáře, spustí UAT. Použij, když task session říká, že se má kontrakt provést přes wf-impl.
disable-model-invocation: true
---

# /wf-impl — dirigent kontraktu (worktree session)

Diriguješ, produkční kód nepíšeš. Každá fáze = delegace; přechody řídí
VÝHRADNĚ exit kódy wf-gate — „hotovo" od agenta neznamená nic. Nikdy
nespouštěj `sc worktree create`. Foreground příkazy v `gtimeout <s>`, dlouhé
běhy přes `bg_start` — nikdy neomezený foreground watch.

GATE = `node ~/Workspace/pi-ext/wf/wf-gate.mjs`
SPEC = absolutní cesta ke `contract.md` z tvého tasku (kontrakt má vlastní
adresář `~/Workspace/specs/<projekt>/<název>/` i pro další artefakty). Když
soubor chybí, zastav a reportuj — kontrakt nevymýšlej ani nehledej v repu.

Extension `wf-gate` blokuje `gh pr create`, dokud v `.wf/receipts.jsonl` není
průchozí FULL verify a review attest na aktuálním čistém HEADu; `gh pr merge`
je blokovaný vždy. Guard neobcházej, splň ho — `reason` říká, který receipt chybí.

## Fáze 0 — orientace (a zároveň resume)

1. Přečti SPEC; spusť `GATE begin SPEC` (nabije guard, spotřebuje launch claim).
2. `GATE agents SPEC --json` → `impl` a `review` — modely nikdy neodhaduj z YAML.
3. `GATE verify SPEC preflight --json` — levná kontrola prostředí; fail zastaví
   práci před buildem. Starší kontrakt bez preflightu jen viditelně přeskoč.
4. Hotové fáze odvoď z reality (git log na branchi, receipts, `gh pr view
   --json state`); pokračuj od první nedokončené.

## Fáze 1 — implementace

Jeden `subagent_spawn` s `harness`, `model` a `reasoning_effort` z `impl`,
`working_dir` = tenhle worktree. Dirigent drží krátký orchestration kontext
a do produkčního kódu nesahá. Zadání:

> Implementuj kontrakt na `<SPEC>` striktně TDD po **skupinách kritérií**:
>
> 1. Z kontraktu čti sekce Akceptační kritéria, Strategie testování, Scope,
>    Non-goals a Přístup; frontmatter, verify a review plán jsou věc dirigenta.
> 2. Rozděl kritéria na soudržné skupiny (jeden modul / jedno chování, typicky
>    3–5 kritérií, ideálně do osmi skupin) a rozpad napiš do reportu.
> 3. Na každou skupinu jeden cyklus: RED (jeden test soubor, testy celé
>    skupiny padají ze správného důvodu) → GREEN (minimální kód) → refactor
>    jen na zeleném. Cíl 1–2 test případy na kritérium (tabulka případů =
>    jeden test); víc jen kde kritérium jinak nepřibiješ.
> 4. Kritérium platné už na baseline (zachované chování, regrese) RED nemá:
>    napiš charakterizační test, ukaž ho zelený před i po změně, v reportu
>    označ jako regresní. Nikdy kvůli RED nerozbíjej produkční kód.
> 5. V RED/GREEN pouštěj jen dotčený test soubor, jedním příkazem krátkým na
>    zeleno i vypovídajícím na červeno (`node --test <soubor> 2>&1 | tail -30`
>    nebo ekvivalent). Stejný test nikdy dvakrát kvůli jinému reporteru —
>    jeden dražší výstup stačí. Celou sadu nepouštěj — tu vlastní gate.
> 6. Kontext drž krátký: nevypisuj právě zapsané soubory, nečti znovu, co už máš.
> 7. Drž se sekce Scope, respektuj non-goals a vyloučené přístupy. Test nikdy
>    neoslabuj, aby prošel.
> 8. Commit po každé skupině (Conventional Commits); branch nepřejmenovávej.
> 9. Žádné review, žádní revieweři. **Nikdy `gh pr create` ani `gh pr merge`** —
>    endgame vlastní dirigent (u codex harnessu je tahle věta jediná obrana,
>    guard tam není).
> 10. Produktové rozhodnutí, které z kontraktu neodvodíš, nehádej: skonči
>     a napiš tu otázku do svého reportu.

Čekej na dokončovací notifikaci — žádné `sleep`/poll smyčky; `subagent_check`
jednou, jen při podezření na zásek. Postup měř přes nové commity; uživatel běh
sleduje přes `/subagents`.

Report subagenta ulož celý do `.wf/impl/<HEAD>.md` — chat není trvalý
checkpoint. Skončí-li subagent otázkou, eskaluj (viz Blokace) a další kolo
spusť s odpovědí v zadání.

## Fáze 2 — review

`GATE verify SPEC quick --json`, pak načti skill `wf-review` z
`~/Workspace/pi-ext/skills/wf-review/SKILL.md` a proveď ji pro SPEC. FAILED (nevyřešené legitimní nálezy) → zastav a eskaluj; na full gate
ani PR nepokračuj.

## Fáze 3 — finální full gate

- Nejdřív: `sc worktree status --json` → target branch, fetchni ji. Posunula-li
  se od merge-base, integruj jednou podle pravidel projektu; konfliktní nebo
  behaviorální fix vrať přes quick gate a review změněných oblastí. Full běží
  až na finálním čistém HEADu.
- `GATE verify SPEC full --json` spouštíš SÁM. **Nikdy nespouštěj `just gate
  ... full` ani `scripts/gate.sh ... full` přímo** — obešlo by to zámek
  a receipt. Full gaty se napříč worktree serializují zámkem; čekání na lock
  je fronta, ne zásek. Logy: `.wf/logs/<HEAD>/`, JSON report: `.wf/verify/<HEAD>/`.
- Po PASS: `GATE attest review SPEC` na témže HEADu.
- Fail → nový subagent: co přesně padlo (id záznamu + tail výstupu), co
  předchozí pokus udělal a jaké hypotézy vyloučil (z jeho reportu), diagnostika
  od nuly. Max **3 opravná kola**; každý fix → quick gate + review změněných
  oblastí → znovu finální full. Bez nového signálu čtvrté kolo nespouštěj.
  Warningy a odložené záznamy patří do popisu PR.

## Fáze 4 — ship

Z attestovaného HEADu otevři draft PR, vyčkej na CI a vyřeš komentáře.
Pohne-li kterýkoli fix HEADem → zpět do fáze 2 (review změn + finální full +
attest). Teprve po stabilním CI a komentářích spusť UAT a potom explain —
žádné zastaralé kopie souběžně s PR fixy.

- `uat: auto` → načti skill `wf-uat` z
  `~/Workspace/pi-ext/skills/wf-uat/SKILL.md` pro SPEC; jeho report předej skillu
  `wf-explain` z `~/Workspace/pi-ext/skills/wf-explain/SKILL.md` spolu s
  posledním gate reportem. `uat: manual` → UAT přeskoč
  a napiš to; explain běží vždy. `wf-explain` zapíše `explanation.md` vedle
  kontraktu — cestu dej do finálního reportu.
- `gh pr create --draft`, titulek ve stylu Conventional Commits. Popis VŽDY
  anglicky a krátce (max ~120 slov před markerem):

  ```
  ## Why
  <1–2 sentences — the contract's Business shrnutí, translated to English>

  ## What changed
  <2–4 bullets, behavior-level — never a file-by-file narration>

  ## Verification
  <1–3 bullets: full gate PASS, review rounds done, CI>

  <!-- wf-spec: <name> -->
  ```

- Marker `<!-- wf-spec: <name> -->` je literál, na GitHubu neviditelný —
  `GATE status` podle něj páruje PR se specem; nikdy ho nevynechej. Žádná vata,
  žádný detail, který diff ukazuje sám. Warningy/odložené gaty jako sbalený
  `<details><summary>Gate warnings</summary>` checklist (nezaškrtnutý, dokud to
  nedokáže CI nebo idle běh); bez warningů sekci vynech.
- CI kontroluj po dokončovací události nebo pár omezenými dotazy (`gh pr
  checks`, nikdy `--watch` ani sleep smyčka); posuzuj přes `gh run view
  <run-id> --json status,conclusion,jobs`. Všechny joby `steps=0` a main padá
  stejně → CI je infrastrukturně blokované; lokálně ho neemuluj bez výslovné
  žádosti. Každý nový commit vrací tok do review změn a finálního full gatu —
  samotný quick ani attest nestačí.
- Komentáře (boti, code scanning, lidi): ověř proti kódu, legitimní oprav, na
  každý thread odpověz commitem nebo zdůvodněním na úrovni kódu. Mechanicky
  vymahatelný nebo opakující se nález zkodifikuj skillem `review-guards`
  (ast-grep pravidlo s testem / řádek v `REVIEW_GUIDELINES.md`) ve stejném
  commitu. **Nikdy nemerguj.** Změnily-li fixy viditelné chování, srovnej
  „What changed" s diffem. Další dávky komentářů přijdou dispatchem z `wf-run`.

## Blokace?

Produktové rozhodnutí, které z kontraktu neodvodíš → otázka tam, kde ji
uživatel uvidí (komentář na PR nebo `sc worktree review-add`), a v reportu
napiš, že fáze stojí na odpovědi. Nikdy nehádej, nikdy neumři potichu.

## Finální report (česky)

Fáze, commity, výsledky gatů včetně warningů, výsledek review, PR link, UAT
nebo ruční kroky, cesta k vysvětlení, cokoli nevyřešeného.
