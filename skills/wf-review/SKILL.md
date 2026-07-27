---
name: wf-review
description: Review fáze workflow kontraktu — deterministický scope, panel reviewerů z kontraktu (čerstvý kontext, cross-model přes subagent_spawn), ověřené nálezy, fixy, quick gate, attest. Volá ji wf-impl po implementaci, nebo uživatel ručně s cestou ke spec.
---

# /wf-review — review fáze kontraktu

Argument: absolutní cesta ke kontraktu (mimo repo). Vlastníš review: revieweři
jen reportují, ověřuješ, opravuješ a commituješ ty. Stejné, ať volá pipeline
nebo uživatel.

GATE = `node ~/Workspace/pi-ext/wf/wf-gate.mjs`

## 1. Scope — deterministicky, bez LLM

TARGET = `sc worktree status --json` → `target_branch` (fallback `main`).

1. `ocr delegate preview --from TARGET --to HEAD` — soubory, churn, merge_base.
2. OCR vylučuje podle přípony: lockfily a generovaný kód mají zůstat venku, ale
   vylučuje i `.md`, a v některých repech jsou prompty/skills/docs PRODUKT.
   Vyloučený soubor, který kontrakt jmenuje ve Scope nebo který nese smysl
   změny, VRAŤ na seznam (diff: `git diff <merge_base>..HEAD -- <path>`).
3. `ocr delegate rule <soubory>` — pravidla projektu seskupená podle obsahu.
4. `.wf/review-packet.md`: cesta ke kontraktu, refy + merge_base, finální seznam
   souborů, skupiny pravidel. Každý reviewer dostane tenhle jeden packet — scope
   nikdo neodvozuje znovu.

Bez `ocr` slož packet z `git diff --stat TARGET...HEAD` a napiš to do reportu.

## 2. Kola — max 2, tvrdý strop

Plán: `GATE agents <spec> --json` → `review` (kola × revieweři s `focus`,
`harness`, `model`, `effort`). Modely neodhaduj z YAML.

**Kolo 1** — revieweře spusť PARALELNĚ přes `subagent_spawn` s jejich harnessem
a modelem, každý čerstvý kontext. To je ta cross-model garance, nikdy je
nesesypej na jeden model. Každý dostane packet, svůj focus, read-only instrukci
a tenhle reportovací kontrakt:

- reviewer s harnessem **claude**: prompt MUSÍ začínat `/code-review` a hned za
  ním packet + focus + kontrakt — spustí to nativní review mód Claude Code
  (ověřeno: SDK slash command interpretuje a instrukce za ním respektuje).
  U ostatních harnessů žádný slash prefix — codex by `/review` dostal jako
  prostý text, nativní mód se přes subagenta spustit nedá;
- reviewer s harnessem **pi**: do promptu přidej, ať na dopadovou analýzu
  používá `sem_impact` (co nález rozbíjí jinde, dotčené testy) a `sem_context`
  (kompaktní kontext entity místo čtení celých souborů);

- nálezy jsou TVRZENÍ: severita + `file:line` (nálezy na úrovni kontraktu —
  nepokryté kritérium, změna mimo scope — odkazují na kritérium) + co je špatně
  a proč to vadí;
- **Critical/High** = bugy, security, ztráta dat, chybějící nebo oslabené
  pokrytí kritéria. **Medium** = výkon, chybějící error handling — s kontextem.
  **Low** = stylové nitpicky, potichu zahoď, pokud nejsou zjevně cenné;
- skupiny pravidel z packetu jsou jejich checklist;
- read-only znamená i **nikdy `gh pr create` / `gh pr merge`** — endgame vlastní
  wf-impl (u codex harnessu je tahle věta jediná obrana, guard tam není).

Plán smíš ZMENŠIT, je-li diff zjevně menší, než kontrakt čekal (napiš to) —
nikdy pod 1 kolo × 1 reviewer, nikdy víc než 4 revieweři v kole.

Každý nález ověř proti kódu, než podle něj jednáš. Zamítni se zdůvodněním na
úrovni kódu, nebo oprav a commitni. Významné nálezy můžou jít i do threadů
`sc worktree review-add`.

**Kolo 2** — jeden reviewer projde JEN oblasti změněné fixy z kola 1
(`ocr delegate preview --from <HEAD z kola 1> --to HEAD`). Bez fixů kolo 2 celé
přeskoč.

## 3. Gate a attest

1. `GATE verify <spec> quick` musí projít (max 3 opravná kola na hypotézu).
2. `GATE attest review <spec>` — vyžaduje čistý tree. Bez attestu guard odmítne
   `gh pr create`, což je záměr; attest jen kvůli obejití guardu maří celý smysl
   workflow.
3. Zůstanou-li na stropu nevyřešené legitimní nálezy, fáze SELHALA: řekni to,
   NEATTESTUJ, reportuj co zbývá.

## Report

Nálezy opravené (s commity) a zamítnuté (se zdůvodněním), revieweři použití vs.
plánovaní, statistika scope (soubory / vrácená vyloučení), gate, stav attestu.
