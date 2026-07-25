---
name: wf-explain
description: Bohaté české vysvětlení změny kódu (kontrakt/diff/branch/PR) jako samostatný interaktivní HTML soubor — pozadí, intuice, průchod kódem, tabulka kritérií, zaškrtávatelné UAT kroky, kvíz. Volá wf-impl po UAT, nebo ručně se spec cestou, ref range či číslem PR.
---

# wf-explain — vysvětli změnu jako samostatnou HTML stránku

Vstup: cesta ke kontraktu (diff = target branch...HEAD), ref range, nebo číslo
PR. Vůči repozitáři jen pro čtení. Než začneš psát, prozkoumej širší okolí
kódu — vysvětlení musí odpovídat reálnému systému, ne jen diffu.

CELÝ VÝSTUP JE ČESKY.

## Dva režimy

- **Pipeline** (volá wf-impl s kontraktem): dostaneš gate report a wf-uat
  report. Důkazy ke kritériím i ruční UAT kroky vezmi z nich — neodvozuj je
  znovu.
- **Standalone** (ref range, číslo PR, nebo kontrakt, který si otevřeš sám):
  akceptační kritéria dohledej k testům viditelným v diffu a UAT kroky odvoď
  z UAT sekce kontraktu (nebo, bez kontraktu, z diffu). Kritérium, které
  nedokážeš navázat na žádný důkaz, dostane viditelné ⚠️ — nikdy nevymýšlej
  důkazy.

## Sekce (v tomhle pořadí, VŠE ČESKY)

- **Pozadí**: jak dnes funguje část systému, které se změna týká. Dvě hloubky:
  nejdřív širší úvod pro nováčka (označ ho jako přeskočitelný pro znalé), pak
  úzké pozadí přímo ke změně.
- **Intuice**: jádro myšlenky změny — podstata, ne detaily. Konkrétní příklady
  s hračkovými daty; diagramy používej štědře. Vyber malou rodinu tvarů
  diagramů a recykluj ji napříč případy — vždy s ukázkovými daty.
- **Kód**: high-level průchod změnami, seskupený a seřazený pro pochopení
  (nikdy soubor po souboru podle cest).
- **Akceptační kritéria a jejich ověření**: tabulka s jedním řádkem na každé
  akceptační kritérium z kontraktu: srozumitelná parafráze (co uživatel
  dostane, ne technická formulace) a jak přesně to bylo dokázáno — konkrétní
  test (název + soubor), gate záznam, který ho spustil, a/nebo UAT scénář.
  Pipeline: vezmi z gate reportu a wf-uat reportu. Standalone: naváž kritéria
  na testy viditelné v diffu. Kritérium, které nedokážeš navázat na důkaz,
  dostane viditelné ⚠️ — nikdy nevymýšlej důkazy.
- **UAT — jak si to ověřit sám**: číslovaný ruční postup, kterým si uživatel
  změnu převezme: co spustit nebo kam kliknout a co přesně očekávat (jeden
  krok = jedno pozorovatelné chování). Každý krok vyrenderuj jako
  zaškrtávatelnou položku (checkbox, který si čtenář odklikne — inline JS,
  stav nemusí přežít reload). Pipeline: použij ruční kroky z wf-uat reportu,
  který jsi dostal. Standalone: odvoď je z UAT sekce kontraktu (nebo z diffu).
  Nejdřív popiš, jak spustit disposable lokální instanci.
- **Kvíz**: 5 otázek střední obtížnosti, které testují skutečné pochopení
  změny — dost těžké, aby bez porozumění nešly, ale žádné chytáky.
  Interaktivní multiple-choice: po kliknutí se ukáže, jestli byla odpověď
  správně, s vysvětlením proč ano/ne.

## Formát

- Jediný samostatný HTML soubor (CSS i JavaScript inline). Jedna dlouhá
  stránka s nadpisy sekcí a obsahem nahoře — žádné taby v top-level
  struktuře. Základní responzivní styl, ať se to dá číst na telefonu.
- Ulož vedle kontraktu, do stejné složky jako spec:
  `~/Workspace/specs/<project>/<name>.explanation.html` (všechno k jednomu
  spec pohromadě). Když běžíš standalone bez kontraktu (ref range / PR číslo),
  ulož místo toho do `~/Workspace/diffs/YYYY-MM-DD-explanation-<slug>.html`
  (dnešní datum zjisti přes `date +%F`, nikdy nehádej; adresář založ, pokud
  chybí). Na konci soubor otevři přes `open <cesta>` a absolutní cestu vypiš —
  tuhle cestu wf-impl očekává zpět ve svém finálním reportu, vždy ji vrať.
- Piš s jasností a spádem Martina Kleppmanna — poutavě, klasický styl,
  plynulé přechody mezi sekcemi.
- Diagramy: vyber si malou rodinu tvarů a recykluj ji napříč případy. Užitečné
  druhy: zjednodušená verze UI, které uživatel v aplikaci vidí (pro UI změny);
  systémový diagram toku dat / komunikace mezi komponentami — vždy s
  ukázkovými daty. Žádné ASCII diagramy — vždy jednoduché HTML konstrukce,
  seznamy jako HTML seznamy.
- Bloky kódu vždy v `<pre>` tazích. Když použiješ vlastní stylovaný div, MUSÍ
  mít v CSS `white-space: pre-wrap`, jinak prohlížeč slije řádky do jednoho.
  Před uložením projdi každý blok kódu ve zdrojáku a ověř, že jeho CSS
  obsahuje `white-space: pre` nebo `pre-wrap`.
- Callouty pro klíčové koncepty, definice a důležité edge cases.
