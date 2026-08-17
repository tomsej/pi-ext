---
name: wf-explain
description: České vysvětlení změny kódu z kontraktu, ref range nebo PR — pozadí, intuice, průchod kódem, důkazy, UAT a kvíz. Volá wf-impl po UAT nebo uživatel ručně.
disable-model-invocation: true
---

# /wf-explain — vysvětli změnu

CELÝ VÝSTUP JE ČESKY. Repozitář jen čti a před psaním prozkoumej okolí změny.

## Vstup a důkazy
Vstup: `contract.md` (target branch...HEAD), ref range, číslo nebo URL PR.
- **Pipeline:** důkazy a kroky převezmi z gate a wf-uat reportu.
- **Standalone:** kritéria spoj s testy v diffu a UAT s kontraktem; bez důkazu použij ⚠️.
- **PR:** `gh pr view <n> --json title,body,baseRefName,url`, `gh pr diff <n>`, `gh pr checks <n>`.
- HEAD PR čti bez checkoutu: `git fetch origin pull/<n>/head`; soubory přes `git show FETCH_HEAD:<cesta>`.
- Tvrzení z PR popisu potvrď diffem, testem nebo CI; nic nevymýšlej.

## Styl
- Používej jeden název pro jednu věc.
- Piš aktivně a používej krátká běžná slova.
- Jedna věta nebo odrážka obsahuje jednu hlavní myšlenku.
- Vynech výplňové úvodní fráze, opakování a marketingová přídavná jména.
- Stručnost nesmí odstranit podmínku, hranici ani pozorovatelné chování.
- Veď čtenáře plynule od modelu ke kódu.

## Sekce v pořadí
- **Pozadí** — přeskočitelný úvod, potom kontext změny.
- **Intuice** — princip na hračkových datech, bez implementace.
- **Změna shora dolů** — jediný průchod architekturou a kódem.
- **Akceptační kritéria a jejich ověření** — uživatelský výsledek + test, gate nebo UAT.
- **UAT — jak si to ověřit sám** — disposable instance a kroky `- [ ]`; každý ověří jedno chování.
- **Kvíz** — 5 středně těžkých otázek s variantami a vysvětlením.

## Změna shora dolů
Začni problémem, výsledným pravidlem a tabulkou ověřených metrik; neznámé = `—`.
Použij zavřené `<details>` v pořadí: `<code>PRINCIPLE</code>` → `<code>FLOW</code>` → `<code>STEP</code>` → `<code>KEPT</code>` → `<code>VERIFY</code>`.
Každý `<summary>` má štítek, název a jednovětý závěr.
FLOW ukáže komponenty; STEP důležité symboly a soubory.
Ve STEP vnoř jen podstatné soubory; stav je 🟡 `<a href="<diff-url>"><code>MODIFIED</code></a>` nebo 🟢 `<a href="<diff-url>"><code>NEW</code></a>` a vede na PR Files či compare.
Název souboru je odkaz na HEAD řádky (`.../blob/<sha>/<path>#Lx-Ly`). URL nehádej; mechanické změny vynech.
Ukaž krátký blok v jazyce souboru s výsledným kódem, ne raw diff. Celý diff patří jen do odkazu.

## Formát a uložení
Vytvoř `explanation.md` pod `~/Workspace/specs/<projekt>/` (`<projekt>` = basename origin remote bez `.git`):
- kontrakt: `<název>/explanation.md`; PR: `~/Workspace/specs/<projekt>/pr-<n>-<slug>/explanation.md`; ref: `YYYY-MM-DD-<slug>/explanation.md` (`date +%F`).
Používej malé `mermaid` diagramy s ukázkovými daty, žádné ASCII; bloky kódu mají jazyk.
Odpověď kvízu musí být HTML: `<details><summary>Odpověď</summary><p><strong>B.</strong> Proč ano; proč ostatní ne.</p></details>`.
Na konci vypiš absolutní cestu.

## Plannotator
Po zápisu vytvoř share URL bez lokálního serveru; nespouštěj `plannotator annotate`:
```bash
SHARE_URL="$(node -e 'const fs=require("node:fs"),z=require("node:zlib");const p=fs.readFileSync(process.argv[1],"utf8");console.log("https://share.plannotator.ai/#"+z.deflateRawSync(JSON.stringify({p,a:[]})).toString("base64url"))' "$EXPLANATION_PATH")"; printf 'Plannotator: %s\n' "$SHARE_URL"
```
Hash je nešifrovaný; pro citlivý obsah URL nevytvářej. Short link jen se souhlasem.
