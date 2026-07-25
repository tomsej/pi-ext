---
name: wf-uat
description: UAT fáze workflow kontraktu — odvodí scénáře z UAT sekce a akceptačních kritérií, spustí je proti disposable instanci a dodá české ruční kroky pro uživatele. Volá ji wf-impl při uat auto, nebo uživatel ručně s cestou ke spec.
---

# /wf-uat — user acceptance testing

Argument: absolutní cesta ke kontraktu (mimo repo). Nikdy neměň kód, testy ani
konfiguraci repa. Najdeš-li vadu, nahlas ji; opravy patří do implementace.

UAT NENÍ druhý běh gatů. Gate už kritéria dokázal testy; jejich opakování (nebo
šťouchání do interních API) vyrábí falešnou jistotu, ne novou informaci. UAT má
jedinou definici: **pohled uživatele, jeho rozhraním, na běžící instanci** — CLI
jak by ho napsal, UI jak by klikal, API jak by volal.

Skill je záměrně samostatná jednotka: pipeline ji volá jako poslední fázi a
uživatel na ní iteruje sám. Vstup = cesta ke spec, výstup = český report.

## Prostředí

Scénáře pusť proti DISPOSABLE lokální instanci, spuštěné obvyklým způsobem
projektu (docker compose, dev server, seedovaná lokální DB) — nikdy proti
sdílenému nebo produkčnímu prostředí. Vyber volný ne-default port, paralelně
můžou běžet UAT jiných kontraktů. Scénáře měnící stav jsou uvnitř sandboxu
v pořádku — „neměň" platí na repo, ne na data sandboxu. Instanci nakonec shoď,
všechno timeboxuj, nenech běžet watch/dev server. Neumí-li projekt disposable
instanci, napiš to — ty scénáře jdou do ručního seznamu.

## Postup

1. Přečti kontrakt: sekci **UAT** a všechna **akceptační kritéria**.
2. Odvoď scénáře: každé kritérium musí mít aspoň jeden, plus explicitní UAT
   položky. Jen uživatelský pohled (co vidí, píše, kam kliká). Kde by scénář jen
   zopakoval gate, přeskoč ho a označ jako pokrytý gatem.
3. Co umíš, proveď sám proti disposable instanci. Na webové UI použij
   `agent-browser` CLI, je-li nainstalované; bez něj jdou UI scénáře do ručního
   seznamu — nikdy nepředstírej průchod.
4. Report CELÝ ČESKY (PR je anglicky, tenhle report je pro uživatele — záměrně):
   - co bylo ověřeno automaticky (scénář → výsledek, přesné příkazy/kroky),
   - co pokrývá gate a UAT to neopakuje (kritérium → test),
   - **Ruční kroky pro uživatele**: číslovaný postup — kde kliknout, co spustit,
     co přesně čekat (jeden krok = jedno pozorovatelné chování),
   - zbytková rizika / co UAT nepokrylo a proč.
5. Report vytiskni (patří do finálního reportu dirigenta), nikdy ho neposílej
   jako komentář na PR. Každé kritérium se v něm musí objevit — nenamapované
   kritérium je nález, ne něco k tichému přeskočení.
