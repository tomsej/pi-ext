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
- fáze, které nedávají smysl, vynech (např. PR fáze u lokálního experimentu)
- per-step `model` nastavuj jen s důvodem, jinak nech dědit default

### Acceptance gaty — vyplň je z kontraktu, nikdy je nevynechávej

Gaty jsou to, co brání chainu pokračovat po nepovedené fázi — self-report
„hotovo“ se nepočítá:

- `verified.verify[].command` = **kompletní kontrola z Ověření sekce
  kontraktu** — pi-subagents ji spustí sám po doběhnutí kroku; child-reported
  úspěch se nepočítá. Nenulový exit = krok selže a chain se zastaví
- `criteria` = akceptační kritéria z kontraktu (u implementera všechna;
  u dalších fází kritéria té fáze)
- `evidence` nech jak je v templatu

### Review fáze — slož ji konkrétně, žádné obecné „review“

Do task textu review kroku zapiš explicitně:

- **počet kol**: 1 u triviálních změn, 2 default, 3 u rizikových
- **seznam reviewerů pro každé kolo** — každý řádek = fokus + model:
  - vždy: `reviewer` — correctness + soulad s kontraktem (default model)
  - změna sahá na auth/vstupy/secrets/trust boundaries → přidej reviewera se
    security fokusem
  - nové abstrakce, závislosti nebo hodně nového kódu → přidej reviewera
    s over-engineering fokusem (co smazat/zjednodušit)
  - velké zásahy do testů → přidej test-quality fokus (neoslabené asserty,
    žádné mock-everything)
- **model diversity**: u rizikových změn aspoň jeden reviewer na jiném
  provideru, než běžela implementace (konkrétní model id do task textu;
  když nevíš jaké modely mám enabled, zeptej se mě)

Složení review mi v kroku Kontrola ukaž a nech si ho odsouhlasit.

```json
{
	"name": "<name>",
	"description": "<one-line goal>",
	"chain": [
		{
			"agent": "implementer",
			"phase": "Implement",
			"label": "TDD implementation",
			"task": "Implement the contract at .pi/chains/<name>/contract.md. Work strictly TDD per your instructions; stay inside the contract's scope.",
			"acceptance": {
				"level": "verified",
				"criteria": ["<each acceptance criterion from the contract, one entry per criterion>"],
				"evidence": ["changed-files", "tests-added", "commands-run", "residual-risks"],
				"verify": [
					{ "id": "full-check", "command": "<full verification command from the contract>", "timeoutMs": 600000 }
				]
			}
		},
		{
			"agent": "review-loop",
			"phase": "Review",
			"label": "Review loop",
			"task": "Review the implementation against the contract at .pi/chains/<name>/contract.md. Rounds: max <N>. Spawn these reviewers each round (fresh context, read-only): <one line per reviewer: agent, focus, model — per the review composition rules>. Verify every finding against the code before fixing; if legitimate findings remain unresolved at the round limit, fail this phase.",
			"acceptance": {
				"level": "verified",
				"criteria": ["No unresolved legitimate review findings remain"],
				"evidence": ["changed-files", "commands-run", "residual-risks"],
				"verify": [
					{ "id": "full-check-after-fixes", "command": "<full verification command from the contract>", "timeoutMs": 600000 }
				]
			}
		},
		{
			"agent": "pr-finisher",
			"phase": "PR",
			"label": "Draft PR + green CI",
			"task": "Create a draft PR for this work using the business summary from the contract at .pi/chains/<name>/contract.md, then iterate until CI is green and all review comments are resolved. Never merge.",
			"acceptance": {
				"level": "checked",
				"criteria": ["Draft PR exists with the contract's business summary", "CI is green", "No unresolved review threads"],
				"evidence": ["commands-run", "residual-risks", "no-staged-files"]
			}
		},
		{
			"agent": "uat",
			"phase": "UAT",
			"label": "UAT plan + handoff",
			"task": "Run UAT for the contract at .pi/chains/<name>/contract.md: derive scenarios, execute what you can yourself, and finish with manual steps for the user in Czech.",
			"acceptance": {
				"level": "attested",
				"criteria": ["Every contract acceptance criterion is mapped to a UAT scenario", "Manual steps for the user are written in Czech"]
			}
		}
	]
}
```

## 3. Kontrola

Ukaž mi shrnutí kontraktu a vygenerovaný chain.json a zeptej se, jestli chci
něco doladit. Nic nespouštěj — spuštění udělám sám (Ctrl+X → c → r,
`/run-chain <name> -- <task>`).
