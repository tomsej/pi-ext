---
description: Rychlý one-shot workflow — bez kontraktu rovnou spustí implement → review → PR chain
argument-hint: "<cíl>"
---

Cíl: $@

Rychlý workflow bez kontraktu. Pokud je cíl jasný, **hned** spusť chain přes
`subagent` tool (chain mode, `context: "fresh"` u každého kroku). Jen když je
cíl vysloveně nejednoznačný, polož mi jednu krátkou upřesňující otázku a pak
spusť.

Kroky nevolej sám v hlavní session — deleguj celý chain na jedno volání
`subagent` s těmito třemi kroky (cíl vlož doslova do každého tasku, děti nemají
kontrakt ani přístup k této konverzaci):

1. **implementer** — „Neexistuje žádný contract soubor. Tvoje specifikace
   i akceptační kritéria jsou: $@. Přečti si nejdřív kód, kterého se změna
   týká, a vystopuj reálný tok. Pracuj striktně TDD, drž se minimálního
   rozsahu. Po poslední úpravě pusť ověření projektu (testy/typecheck) s exit
   0 a nahlas přesné příkazy a exit kódy. Každý příkaz časově ohranič — žádný
   watch/dev-server/interaktivní režim, dlouhé běhy obal do `timeout <s>`.
   Do not run code review or spawn reviewers; the following review-loop step owns review."

2. **review-loop** — „Žádný contract; specifikace je: $@. Revizuj diff proti
   target branch. Max 1 kolo. Spusť dva `reviewer` subagenty (fresh, read-only):
   jeden rychlý correctness + soulad se specifikací a jeden hloubkový bugs +
   design. Oba zdědí dostupný defaultní model. Nálezy ověř proti kódu, oprav
   jen legitimní, commitni. Každý příkaz časově ohranič — dlouhé běhy obal do
   `timeout <s>`."

3. **pr-finisher** — „Žádný contract; specifikace je: $@. Vytvoř draft PR;
   business shrnutí (co a proč, pro netechnického čtenáře) si odvoď ze změny.
   Iteruj, dokud není CI zelené a review vlákna vyřešená. Nikdy nemerguj.
   Každý příkaz časově ohranič — CI sleduj přes ohraničené dotazy, ne
   nekonečný watch; dlouhé běhy obal do `timeout <s>`."

Bez akceptačních gatů (self-report děti nepočítej — reálnou kontrolou je
review fáze + CI). Když chceš gaty, kontrakt nebo UAT, použij `/wf`.
