---
name: wf-review
description: Review fáze workflow kontraktu — deterministický scope, panel reviewerů z kontraktu (čerstvý kontext, cross-model přes subagent_spawn), ověřené nálezy, fixy, quick gate, attest. Volá ji wf-impl po implementaci, nebo uživatel ručně s cestou ke spec.
---

# /wf-review — review fáze kontraktu

Argument: absolutní cesta ke kontraktu (`~/Workspace/specs/<project>/<name>.md`
— specy jsou mimo repo). Vlastníš review tohohle kontraktu: revieweři jen
reportují; ověřuješ, opravuješ a commituješ ty. Funguje stejně, ať tě zavolala
pipeline nebo uživatel.

GATE = `node ~/Workspace/pi-ext/wf/wf-gate.mjs`

## 1. Scope — deterministicky, bez LLM

TARGET = target branch (`sc worktree status --json` → `target_branch`; fallback
`main`).

1. `ocr delegate preview --from TARGET --to HEAD` — reviewovatelné soubory,
   churn, merge_base.
2. Kontrola vyloučení: OCR vylučuje podle přípony/patternu. Že lockfily
   a generovaný kód zůstanou venku, je smysl věci — ale vylučuje i `.md`,
   a v některých repech jsou prompty/skills/docs PRODUKT. Každý vyloučený
   soubor, který kontrakt jmenuje ve Scope nebo který zjevně nese smysl změny,
   se VRACÍ na seznam (jeho diff: `git diff <merge_base>..HEAD -- <path>`).
3. `ocr delegate rule <reviewovatelné soubory>` — pravidla projektu seskupená
   podle obsahu (bez rule.json OCR použije svůj rozumný default).
4. Zapiš `.wf/review-packet.md`: cesta ke kontraktu, refy + merge_base, finální
   seznam souborů (včetně vrácených vyloučení), skupiny pravidel. Každý reviewer
   dostane tenhle jeden packet — scope nikdo neodvozuje znovu.

Není-li `ocr` nainstalované, slož packet z `git diff --stat TARGET...HEAD` bez
pravidel a napiš to do reportu.

## 2. Kola — max 2, tvrdý strop

Plán vezmi z `GATE agents <spec> --json` → `review`: seznam kol, v každém
revieweři s `focus`, `harness`, `model`, `effort`. Nikdy neodhaduj modely
z YAML očima.

**Kolo 1** — revieweře prvního kola spusť PARALELNĚ přes `subagent_spawn`
(`harness`, `model`, `reasoning_effort` z plánu, každý svůj čerstvý kontext).
Tohle je ta cross-model garance, nikdy je nesesypej na jeden model. Každý
reviewer dostane: review packet, svůj focus, instrukci read-only a tenhle
reportovací kontrakt:

- nálezy jsou TVRZENÍ: severita + `file:line` (nálezy na úrovni kontraktu —
  nepokryté kritérium, změna mimo scope — odkazují na akceptační kritérium) +
  co je špatně + proč to vadí;
- severita: **Critical/High** = bugy, security, ztráta dat, chybějící nebo
  oslabené pokrytí kritéria — vždy reportuj. **Medium** = výkon,
  chybějící error handling — reportuj s kontextem. **Low** = stylové nitpicky —
  potichu zahoď, pokud nejsou zjevně cenné;
- skupiny pravidel z packetu jsou checklist pro jejich soubory;
- read-only znamení i žádné `gh pr create` / `gh pr merge` — endgame vlastní
  wf-impl (u codex harnessu je tahle věta jediná obrana, guard tam není).

Plán můžeš ZMENŠIT, když je diff zjevně menší, než kontrakt čekal (napiš to do
reportu) — nikdy ne pod 1 kolo × 1 reviewer, nikdy víc než 4 revieweři v kole
(a `subagent_spawn` běží max 4 souběžně).

Každý nález ověř proti kódu, než podle něj něco uděláš — nálezy jsou tvrzení,
ne pravda. Zamítni se zdůvodněním na úrovni kódu, nebo oprav a commitni
(Conventional Commits). Významné nálezy můžou jít i do threadů
`sc worktree review-add` pro uživatele.

**Kolo 2** — jeden reviewer znovu projde JEN oblasti změněné fixy z kola 1;
scope si vem deterministicky: `ocr delegate preview --from <HEAD z kola 1> --to
HEAD`. Když kolo 1 nevyprodukovalo žádný fix, kolo 2 přeskoč celé.

## 3. Gate a attest

1. Po fixech z posledního kola: `GATE verify <spec> quick` — musí projít
   (fix → znovu, max 3 opravná kola na hypotézu).
2. Attestuj fázi: `GATE attest review <spec>` (vyžaduje čistý tree — nejdřív
   všechno commitni). Bez tohohle attestu guard odmítne `gh pr create`, což je
   záměr. Attestuj JEN když kroky 1–2 opravdu proběhly; attest jen kvůli
   obejití guardu maří celý smysl workflow.
3. Zůstanou-li na stropu nevyřešené legitimní nálezy, fáze SELHALA: řekni to
   výslovně, NEATTESTUJ a reportuj, co zbývá.

## Report

Nálezy opravené (s commity), nálezy zamítnuté (se zdůvodněním), revieweři
použití vs. plánovaní, statistika scope (soubory k review / vrácená vyloučení),
výsledek gatu, stav attestu.
