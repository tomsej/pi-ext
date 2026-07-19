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

### Review fáze — slož ji podle kontraktu

Template níže obsahuje default pro běžnou změnu (2 kola):

- **kolo 1** (paralelně): rychlý correctness/contract-compliance smoke
  (`openai-codex/gpt-5.6-luna`) + dva hloubkové reviewery na různých
  modelech — `anthropic/claude-opus-4-8` (design + over-engineering) a
  `openai-codex/gpt-5.6-sol` (bugs + edge cases)
- **kolo 2**: jeden reviewer, re-review pouze oblastí změněných fixy
  (`openai-codex/gpt-5.6-sol`)

Default ale slepě nekopíruj — z kontraktu odvoď, kolik reviewerů, jaké
fokusy a kolik kol dává smysl, a fokusy hloubkových reviewerů nahraď/doplň
z tohohle katalogu podle toho, na co změna sahá:

| Fokus | Kdy | Model |
|---|---|---|
| security | auth, vstupy, secrets, trust boundaries | `anthropic/claude-opus-4-8` |
| architecture | změny napříč moduly, nová veřejná API, nové závislosti | `anthropic/claude-opus-4-8` |
| test-quality | velké zásahy do testů — neoslabené asserty, žádné mock-everything | `openai-codex/gpt-5.6-sol` |
| performance | hot paths, dotazy, velká data, N+1 | `openai-codex/gpt-5.6-sol` |
| data-safety | migrace, destruktivní operace, konzistence dat | `anthropic/claude-opus-4-8` |
| over-engineering | hodně nového kódu, nové abstrakce | `anthropic/claude-opus-4-8` |

Řídi se rozsahem: **triviální změna** (pár řádků, žádné nové API) = 1 kolo,
jen luna smoke. **Běžná** = default ± výměna fokusů. **Riziková** = 3 kola
a klidně 3–4 revieweři v kole 1. Víc než 4 reviewery nikdy — překrývají se.

Modely: jen Opus (`anthropic/claude-opus-4-8`) a GPT (`openai-codex/gpt-5.6-sol`,
`openai-codex/gpt-5.5`); luna jen na rychlý smoke.

Složení review mi v kroku Kontrola ukaž (kola, revieweři, fokusy, modely)
a nech si ho odsouhlasit.

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
			"task": "Review the implementation against the contract at .pi/chains/<name>/contract.md. Rounds: max 2. Round 1 — spawn in parallel (fresh context, read-only): reviewer (fast correctness + contract compliance smoke, model openai-codex/gpt-5.6-luna), reviewer (deep review: design, what to delete or simplify, model anthropic/claude-opus-4-8), reviewer (deep review: bugs and edge cases, model openai-codex/gpt-5.6-sol). Round 2 — one reviewer (re-review only the areas changed by the fixes, model openai-codex/gpt-5.6-sol). Verify every finding against the code before fixing; if legitimate findings remain unresolved at the round limit, fail this phase.",
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

Připomenň mi u toho: když gate zastaví chain uprostřed, `/run-chain` znovu
jede od začátku — menší zádrhely je rychlejší dořešit ručně v hlavní session
a zbylé fáze spustit jednotlivě (`/run <agent> -- <task s cestou ke
kontraktu>`).
