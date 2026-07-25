---
name: wf-run
description: Řídící pult pro workflow kontrakty — zjisti reálný stav, naplánuj (DAG, kolize, resume), nech uživatele vybrat a spusť jeden super.engineering worktree na každý vybraný kontrakt. Vyvolání téhle skill JE uživatelova výslovná žádost o vytvoření worktree pro vybrané kontrakty.
---

# /wf-run — naplánuj a spusť kontrakty

Jsi v HLAVNÍ session. Tady nikdy nic neimplementuješ; plánuješ, spouštíš
worktree a předáváš práci. Před každým `sc worktree create` si přečti
`sc instructions worktree`.

GATE = `node ~/Workspace/pi-ext/wf/wf-gate.mjs`

## 1. Zjisti reálný stav

Spusť `GATE status --json` (z rootu repa). Pro každý spec:

- `done` → nabídni archivaci: `mv <spec file> <specs dir>/_archive/` podle cest
  `file` ze status JSONu — specy jsou mimo repo, žádný git (až po schválení).
- `pr-open` s nevyřešenými thready → kandidát na akci „vyřeš komentáře".
- `running` → kandidát na resume, když session vypadá zaseknutě (starý poslední
  commit); nikdy nespouštěj duplicitní worktree pro běžící spec.

## 2. Naplánuj a doporuč

- **launch** — stav `ready` (všechny `depends_on` mergnuté)
- **blocked** — deps nehotové; ukaž, na co čekají
- **resume** — `running` specy; session najdi přes `sc agents list --output json`
  (podle worktree/branch) a navrhni follow-up místo nového worktree
- **attention** — `pr-open` s nevyřešenými review thready

Kolize scope: přečti sekci `Scope` každého spustitelného kontraktu. Dva specy,
které sahají na stejné soubory/moduly, nesmí běžet paralelně — doporuč
sekvenci a řekni proč.

Plán ukaž jako tabulku s jasnou řádkou doporučení, pak se ZEPTEJ, co spustit:
`all` / konkrétní jména / `recommended`. Bez téhle odpovědi nespouštěj nic.

## 3. Spusť

Pro každý vybraný spec:

1. Zjisti ABSOLUTNÍ cestu ke kontraktu (specy jsou v
   `~/Workspace/specs/<project>/` — vezmi `file` ze `GATE status --json`, nikdy
   nehádej cestu relativní k repu) a ověř, že soubor existuje.
2. Zjisti dirigenta: `GATE agents <spec> --json` → `conductor`
   (`{harness: pi, model, effort}`) nebo `null` (= pi s vlastním default modelem;
   Session Default projektu se přebíjí vždy, viz kroku 4).
3. Napiš task soubor (tmp) přesně tohohle tvaru:

   > Načti skill `wf-impl` a proveď kontrakt na `<absolutní cesta ke spec>`.
   > Kontrakt žije mimo repozitář — přečti ho z té přesné cesty. Pracuj jen
   > v tomhle worktree. Nevytvářej worktree. Když narazíš na produktové
   > rozhodnutí, které z kontraktu neodvodíš, napiš otázku do PR / review
   > threadu a tu fázi pozastav.

4. `sc worktree create --from-file <task-file> --provider pi --json`, a když
   kontrakt určuje dirigenta, přidej `--model <conductor.model>` a
   `--reasoning <conductor.effort>`.
   `--provider pi` je POVINNÉ, nikdy ho nevynechávej: Session Default projektu
   může být jiný agent, ale dirigent musí být pi — wf-impl, wf-review, wf-gate
   extension a jeho PR guard existují tam. Ostatní harnessy (claude, codex) se
   zapojují delegací zvnitřku dirigenta podle rosteru kontraktu, ne jako
   session worktree.
5. Reportuj uživateli: cesta k worktree, branch, spec — u každého spuštění.

Pro **resume**: `sc agent send --to id:<stable_target_id> --prompt "Resume
wf-impl pro <absolutní cesta ke spec>: hotové fáze odvoď z reality (git log,
wf-gate verify, existence PR) a pokračuj od první nedokončené." --queue
--output json`. Tip pro uživatele: implementaci na pi harnessu si může
interaktivně prohlédnout ve worktree přes `pi --session $(cat
.wf/impl-session)` (kdykoliv, když headless běh právě neběží).

Pro **vyřešení komentářů**: stejné `sc agent send`, prompt: "PR #<n> má <k>
nevyřešených review threadů. Postupuj podle PR fáze wf-impl: každý nález ověř
proti kódu, legitimní oprav, odpověz na každý thread, drž CI zelené. Nikdy
nemerguj."

## 4. Předej

Po spuštění česky shrň, co běží kde, a skonči — dál to vlastní worktree
sessions. Vlny závislostí se řeší dalším spuštěním `wf-run` po mergích, ne
čekáním tady.
