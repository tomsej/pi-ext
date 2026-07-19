---
description: Workflow planner — sestav contract.md a vygeneruj workflow chain do .pi/chains/<name>/
argument-hint: "<cíl>"
---

Cíl: $@

Vytvoř workflow artefakty pro tento cíl. Nepiš žádný produkční kód — výstupem
jsou jen artefakty. Implementace poběží později přes `/run-chain`.

## 1. Kontrakt

Sestav kontrakt z naší dosavadní diskuse; chybějící body si u mě doptej:

- **Současné chování / reprodukce:** jak to funguje teď; u bugu přesný postup reprodukce
- **Akceptační kritéria:** pozorovatelná chování — každé kritérium = jeden budoucí test
- **Strategie testování:** pro každé kritérium typ a úroveň testu
  (unit/integrační/e2e), přes jaké veřejné rozhraní, s jakými daty. Netestovatelné
  kritérium nahlas teď, ne po implementaci
- **Přístup:** preferovaná řešení a co je vyloučené (např. „žádná nová
  závislost") — odvoď z diskuse, jinak se zeptej
- **Non-goals:** co vědomě neřešíme
- **Scope:** povolené soubory/moduly
- **Ověření:** příkaz na rychlý cílený test + na kompletní kontrolu
- **Business shrnutí:** 2–4 věty pro popis draft PR — co a proč, pro
  netechnického čtenáře
- **UAT:** co má uživatel ručně ověřit z uživatelského pohledu

## 2. Artefakty

Odvoď kebab-case název `<name>` a zapiš (kontrakt anglicky):

- `.pi/chains/<name>/contract.md` — kontrakt výše
- `.pi/chains/<name>/<name>.chain.json` — z template níže

Template přizpůsob kontraktu:

- doplň `<name>` a skutečnou cestu ke kontraktu do všech tasků
- review fázi uprav podle rizikovosti změny: počet kol, počet reviewerů a
  jejich modely zapiš přímo do task textu review kroku
- fáze, které nedávají smysl, vynech (např. PR fáze u lokálního experimentu)
- per-step `model` nastavuj jen s důvodem, jinak nech dědit default

```json
{
	"name": "<name>",
	"description": "<one-line goal>",
	"chain": [
		{
			"agent": "implementer",
			"phase": "Implement",
			"label": "TDD implementation",
			"task": "Implement the contract at .pi/chains/<name>/contract.md. Work strictly TDD per your instructions; stay inside the contract's scope."
		},
		{
			"agent": "review-loop",
			"phase": "Review",
			"label": "Review loop",
			"task": "Review the implementation against the contract at .pi/chains/<name>/contract.md. Max 2 rounds. Reviewers: one default `reviewer`."
		},
		{
			"agent": "pr-finisher",
			"phase": "PR",
			"label": "Draft PR + green CI",
			"task": "Create a draft PR for this work using the business summary from the contract at .pi/chains/<name>/contract.md, then iterate until CI is green and all review comments are resolved. Never merge."
		},
		{
			"agent": "uat",
			"phase": "UAT",
			"label": "UAT plan + handoff",
			"task": "Run UAT for the contract at .pi/chains/<name>/contract.md: derive scenarios, execute what you can yourself, and finish with manual steps for the user in Czech."
		}
	]
}
```

## 3. Kontrola

Ukaž mi shrnutí kontraktu a vygenerovaný chain.json a zeptej se, jestli chci
něco doladit. Nic nespouštěj — spuštění udělám sám (Ctrl+X → c → r,
`/run-chain <name> -- <task>`).
