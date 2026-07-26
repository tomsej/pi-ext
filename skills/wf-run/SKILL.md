---
name: wf-run
description: Řídící pult pro workflow kontrakty — zjisti reálný stav, naplánuj (DAG, kolize, resume), nech uživatele vybrat a spusť jeden super.engineering worktree na každý vybraný kontrakt. Vyvolání téhle skill JE uživatelova výslovná žádost o vytvoření worktree pro vybrané kontrakty.
---

# /wf-run — naplánuj a spusť kontrakty

Jsi v HLAVNÍ session: plánuješ, spouštíš worktree, předáváš. Nikdy tu nic
neimplementuješ. Před `sc worktree create` si přečti `sc instructions worktree`.

GATE = `node ~/Workspace/pi-ext/wf/wf-gate.mjs`

## 1. Stav

`GATE status --json` (z rootu repa) odvodí stav živě z gitu a gh:

- `done` → nabídni archivaci celého adresáře kontraktu:
  `mv <dirname(file)> <specs dir>/_archive/` (cesty z JSONu; specy jsou mimo
  repo, žádný git) — až po schválení
- `pr-open` s nevyřešenými thready → kandidát na „vyřeš komentáře"
- `running` → worktree, který kontrakt diriguje (hlásí se sám přes `.wf/active`,
  ne podle jména branche); kandidát na resume, když poslední commit zestárl.
  Duplicitní worktree pro běžící spec nikdy

## 2. Plán

- **launch** — `ready`
- **resume** — session najdi přes `sc agents list --output json` (podle
  `worktree`/`branch` ze status JSONu) a navrhni follow-up místo nového worktree
- **attention** — `pr-open` s nevyřešenými thready

Kolize: přečti `Scope` každého spustitelného kontraktu. Dva specy na stejné
soubory nesmí běžet paralelně — doporuč sekvenci a řekni proč.

Ukaž tabulku s jasným doporučením a ZEPTEJ se, co spustit (`all` / jména /
`recommended`). Bez odpovědi nespouštěj nic.

## 3. Spuštění

Pro každý vybraný spec:

1. Absolutní cesta ze `GATE status --json` (`file`) — ověř, že soubor existuje.
2. `GATE agents <spec> --json` → `conductor` (nebo `null` = pi s vlastním
   default modelem).
3. Task soubor (tmp) přesně tohohle tvaru:

   > Načti skill `wf-impl` a proveď kontrakt na `<absolutní cesta ke contract.md>`.
   > Kontrakt žije mimo repozitář — přečti ho z té přesné cesty. Pracuj jen
   > v tomhle worktree. Nevytvářej worktree. Když narazíš na produktové
   > rozhodnutí, které z kontraktu neodvodíš, napiš otázku do PR / review
   > threadu a tu fázi pozastav.

4. `sc worktree create --from-file <task-file> --provider pi --json`, plus
   `--model <conductor.model>` a `--reasoning <conductor.effort>`, když je
   kontrakt určuje. `--provider pi` je POVINNÉ (přebíjí Session Default
   projektu): dirigent musí být pi, protože tam žije wf-gate extension a její
   guard. Claude a codex se zapojují delegací zvnitřku dirigenta, ne jako
   session worktree.
5. Reportuj: worktree, branch, spec.

**Resume:** `sc agent send --to id:<stable_target_id> --prompt "Resume wf-impl
pro <spec>: hotové fáze odvoď z reality (git log, wf-gate verify, existence PR)
a pokračuj od první nedokončené." --queue --output json`. Běžící implementaci si
uživatel prohlédne (a může ji převzít) přes `/subagents` v session toho
worktree.

**Komentáře:** stejné `sc agent send`, prompt: „PR #<n> má <k> nevyřešených
review threadů. Postupuj podle PR fáze wf-impl: nález ověř proti kódu, legitimní
oprav, odpověz na každý thread, drž CI zelené. Nikdy nemerguj."

## 4. Předání

Česky shrň, co běží kde, a skonči — dál to vlastní worktree sessions. Vlny
závislostí řeší další spuštění `wf-run` po mergích, ne čekání tady.
