---
description: TDD kontrakt — feature/bugfix začíná failing testem (RED → GREEN)
argument-hint: "<cíl>"
---

Cíl: $@

Než napíšeš jediný řádek kódu, sestav kontrakt. Chybějící body si u mě doptej:

- **Současné chování / reprodukce:** jak to funguje teď; u bugu přesný postup reprodukce
- **Akceptační kritéria:** pozorovatelná chování — každé kritérium = jeden budoucí test
- **Strategie testování:** JEŠTĚ PŘED implementací rozmysli, jak každé kritérium
  otestujeme — typ a úroveň testu (unit/integrační/e2e), přes jaké veřejné
  rozhraní, s jakými daty. Pokud nějaké kritérium nejde rozumně otestovat,
  řekni to nahlas teď, ne až po implementaci
- **Přístup:** preferované řešení a přístupy, které jsou vyloučené
  (např. „žádná nová závislost“, „nepřepisovat veřejné API“) — odvod'
  z diskuse, jinak se zeptej
- **Non-goals:** co vědomě neřešíme
- **Scope:** povolené soubory/moduly
- **Ověření:** příkaz na rychlý cílený test + na kompletní kontrolu

Pak pracuj striktně TDD podle `tdd` skillu, po jednom chování (vertical slices):

1. **RED** — napiš JEDEN test pro další kritérium, spusť ho a ukaž, že selhává ze správného důvodu
2. **GREEN** — minimální implementace, aby test prošel
3. Opakuj pro další kritérium; refactor pouze na zelené
4. Testy nikdy neoslabuj ani neupravuj, aby prošly — špatný test nahlas a zdůvodni
5. Max 3 opravná kola nad jednou hypotézou; bez nového signálu zastav a přehodnoť diagnózu

Hotovo = důkaz, že je to opravdu implementované: každé akceptační kritérium má
test, který PŘED změnou selhával (RED) a TEĎ prochází — plus kompletní
kontrola s exit code 0 spuštěná po poslední změně. Reportuj přesné příkazy
a exit codes; „testy prošly“ bez příkazu a výstupu se nepočítá.
