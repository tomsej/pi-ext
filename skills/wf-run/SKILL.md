---
name: wf-run
description: Řídící pult pro workflow kontrakty — zjisti reálný stav, naplánuj (DAG, kolize, resume), nech uživatele vybrat a spusť jeden super.engineering worktree na každý vybraný kontrakt. Vyvolání téhle skill JE uživatelova výslovná žádost o vytvoření worktree pro vybrané kontrakty.
disable-model-invocation: true
---

# /wf-run — naplánuj a spusť kontrakty

Jsi v HLAVNÍ session: plánuješ, spouštíš worktree, předáváš — nikdy tu nic
neimplementuješ. Před `sc worktree create` si přečti `sc instructions worktree`.

GATE = `node ~/Workspace/pi-ext/wf/wf-gate.mjs`

## 1. Stav

`GATE status --json` (z rootu repa) odvodí stav živě z gitu a gh:

- `done` → po schválení archivuj celý adresář kontraktu:
  `mv <dirname(file)> <specs dir>/_archive/` (cesty z JSONu; specy jsou mimo
  repo, žádný git).
- `pr-open` s nevyřešenými thready → kandidát na „vyřeš komentáře".
- `blocked` → čeká na merged kontrakty z `after`; nespouštěj.
- `cycle` → chybný cyklus v `after`; oprav kontrakty, nespouštěj.
- `launching` → atomický claim drží jiný launcher; nikdy nespouštěj create.
- `running` → právě jeden dirigující worktree; kandidát na resume.
- `duplicate` → více `.wf/active` pro stejný spec; nespouštěj nic — eskaluj
  porovnání a ponechání jediného canonical worktree.

## 2. Plán

- **launch** — `ready`
- **resume** — session najdi přes `sc agents list --output json` (podle
  `worktree`/`branch` ze status JSONu); navrhni follow-up, ne nový worktree.
- **attention** — `pr-open` s nevyřešenými thready

Kolize: přečti `Scope` každého spustitelného kontraktu. Dva specy na stejné
soubory nesmí běžet paralelně — doporuč sekvenci a řekni proč.

Ukaž tabulku s jasným doporučením a ZEPTEJ se, co spustit (`all` / jména /
`recommended`). Bez odpovědi nespouštěj nic.

## 3. Spuštění (pro každý vybraný spec)

1. Absolutní cesta ze `GATE status --json` (`file`) — ověř, že soubor existuje
   a stav je pořád `ready`.
2. `GATE agents <spec> --json` → `conductor` (`null` = pi s default modelem).
3. Připrav task soubor (tmp) přesně tohohle tvaru:

   > Načti `~/Workspace/pi-ext/skills/wf-impl/SKILL.md` a proveď kontrakt na
   > `<absolutní cesta ke contract.md>`.
   > Kontrakt žije mimo repozitář — přečti ho z té přesné cesty. Pracuj jen
   > v tomhle worktree. Nevytvářej worktree. Produktové rozhodnutí, které
   > z kontraktu neodvodíš, napiš jako otázku do PR / review threadu a tu fázi
   > pozastav.

4. Bezprostředně před create: `GATE claim <spec>`. Neprojde-li, znovu načti
   status — `launching`, `running` ani `duplicate` nikdy nepřekrývej.
5. `sc worktree create --from-file <task-file> --provider pi --json`, plus
   `--model <conductor.model>` a `--reasoning <conductor.effort>`, když je
   kontrakt určuje. `--provider pi` je POVINNÉ (přebíjí Session Default
   projektu) — wf-gate extension a její guard žijí jen v pi; claude a codex se
   zapojují delegací zvnitřku dirigenta.
6. Po úspěchu čekej na stav `running`; `GATE begin` v dirigentovi claim
   spotřebuje. Timeout create **nikdy neopakuj** — výsledek je nejednoznačný:
   kontroluj `GATE status`, `git worktree list` a `sc agents list`, dokud se
   launch nepotvrdí nebo claim nevyprší. `GATE release-claim <spec>` až po
   jednoznačně potvrzeném neúspěchu bez worktree/session.
7. Reportuj: worktree, branch, spec.

**Resume:** `sc agent send --to id:<stable_target_id> --prompt "Resume wf-impl
pro <spec>: hotové fáze odvoď z reality (git log, wf-gate verify, existence PR)
a pokračuj od první nedokončené." --queue --output json`. Běžící implementaci
si uživatel prohlédne (a může převzít) přes `/subagents` v session worktree.

**Komentáře:** stejné `sc agent send`, prompt: „PR #<n> má <k> nevyřešených
review threadů. Postupuj podle PR fáze wf-impl: nález ověř proti kódu,
legitimní oprav, odpověz na každý thread, drž CI zelené. Nikdy nemerguj."

## 4. Předání

Česky shrň, co běží kde, a skonči — dál to vlastní worktree sessions. Vlny
závislostí řeší další spuštění `wf-run` po mergích, ne čekání tady.
