---
name: wf-explain
description: Bohaté české vysvětlení změny kódu (kontrakt/diff/branch/PR) jako markdown — pozadí, intuice, průchod kódem, mermaid diagramy, tabulka kritérií, zaškrtávatelné UAT kroky, kvíz. Volá wf-impl po UAT, nebo ruční spuštění se spec cestou, ref range či číslem PR.
---

# /wf-explain — vysvětli změnu

Vstup: cesta ke `contract.md` (diff = target branch...HEAD), ref range, nebo
číslo PR. Vůči repozitáři jen pro čtení. Než začneš psát, prozkoumej okolí kódu —
vysvětlení musí odpovídat reálnému systému, ne jen diffu.

CELÝ VÝSTUP JE ČESKY.

## Dva režimy

- **Pipeline** (volá wf-impl s kontraktem): dostaneš gate report a wf-uat report.
  Důkazy ke kritériím i ruční kroky ber z nich, neodvozuj je znovu.
- **Standalone** (ref range, PR, nebo kontrakt, který si otevřeš sám): kritéria
  naváž na testy viditelné v diffu, UAT kroky odvoď z UAT sekce kontraktu (bez
  kontraktu z diffu). Kritérium bez důkazu dostane viditelné ⚠️ — důkazy nikdy
  nevymýšlej.

## Styl

- Používej jeden název pro jednu věc.
- Piš aktivně a používej krátká běžná slova.
- Jedna věta nebo odrážka obsahuje jednu hlavní myšlenku.
- Vynech výplňové úvodní fráze, opakování a marketingová přídavná jména.
- Stručnost nesmí odstranit podmínku, hranici ani pozorovatelné chování.

## Sekce (v tomhle pořadí)

- **Pozadí** — jak dnes funguje část systému, které se změna týká. Dvě hloubky:
  širší úvod pro nováčka (označ jako přeskočitelný) a pak úzké pozadí ke změně.
- **Intuice** — jádro myšlenky, ne detaily. Konkrétní příklady s hračkovými daty.
- **Kód** — high-level průchod změnami, seskupený a seřazený pro pochopení,
  nikdy soubor po souboru podle cest.
- **Akceptační kritéria a jejich ověření** — tabulka, jeden řádek na kritérium:
  srozumitelná parafráze (co uživatel dostane, ne technická formulace) a jak
  přesně to bylo dokázáno — konkrétní test (název + soubor), gate záznam, který
  ho spustil, a/nebo UAT scénář.
- **UAT — jak si to ověřit sám** — číslovaný postup jako zaškrtávací seznam
  (`- [ ]`), jeden krok = jedno pozorovatelné chování. Nejdřív popiš, jak
  spustit disposable lokální instanci.
- **Kvíz** — 5 otázek střední obtížnosti, které testují skutečné pochopení
  (těžké bez porozumění, ale žádné chytáky). Každá otázka má varianty a
  odpověď schovanou v `<details><summary>Odpověď</summary>`, uvnitř
  s vysvětlením proč ano/ne.

## Formát

- Jediný markdown soubor. Pipeline: `explanation.md` **vedle kontraktu**
  (`~/Workspace/specs/<projekt>/<název>/explanation.md`). Standalone bez
  kontraktu: `~/Workspace/diffs/YYYY-MM-DD-<slug>.md` (datum přes `date +%F`,
  nikdy nehádej; adresář založ). Na konci vypiš absolutní cestu — wf-impl ji
  čeká ve svém reportu.
- Diagramy jako **mermaid** bloky (` ```mermaid `) — vyber malou rodinu tvarů
  a recykluj ji: tok dat mezi komponentami, stavový diagram, zjednodušené UI.
  Vždy s ukázkovými daty. Žádné ASCII diagramy.
- Kód v ohraničených blocích s jazykem. Klíčové koncepty a edge cases jako
  citace (`>`) nebo tučný lead-in.
- Piš s jasností a spádem Martina Kleppmanna — poutavě, plynulé přechody.
