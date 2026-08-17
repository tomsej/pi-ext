---
name: wf-uat
description: UAT fáze workflow kontraktu — odvodí scénáře z UAT sekce a akceptačních kritérií, spustí je proti disposable instanci a dodá české ruční kroky pro uživatele. Volá ji wf-impl při uat auto, nebo uživatel ručně s cestou ke spec.
disable-model-invocation: true
---

# /wf-uat — user acceptance testing

Argument: absolutní cesta ke kontraktu (mimo repo). Nikdy neměň kód, testy ani
konfiguraci repa — vadu nahlas, opravy patří do implementace.

UAT NENÍ druhý běh gatů — gate už kritéria dokázal testy a jejich opakování
(nebo šťouchání do interních API) vyrábí falešnou jistotu, ne novou informaci.
Definice: **pohled uživatele, jeho rozhraním, na běžící instanci** — CLI jak by
ho napsal, UI jak by klikal, API jak by volal.

Samostatná jednotka: pipeline ji volá jako poslední fázi, uživatel na ní
iteruje sám. Vstup = cesta ke spec, výstup = český report.

## Prostředí

- DISPOSABLE lokální instance, spuštěná obvyklým způsobem projektu (docker
  compose, dev server, seedovaná lokální DB) — nikdy sdílené ani produkční
  prostředí.
- Volný ne-default port — paralelně můžou běžet UAT jiných kontraktů.
- Scénáře měnící stav jsou v sandboxu v pořádku — „neměň" platí na repo,
  ne na data sandboxu.
- Všechno timeboxuj, instanci nakonec shoď, nenech běžet watch/dev server.
- Neumí-li projekt disposable instanci, napiš to — ty scénáře jdou do ručního
  seznamu.

## Postup

1. Přečti kontrakt: sekci **UAT** a všechna **akceptační kritéria**.
2. Odvoď scénáře: každé kritérium ≥ 1 scénář, plus explicitní UAT položky.
   Jen uživatelský pohled (co vidí, píše, kam kliká). Scénář, který by jen
   zopakoval gate, přeskoč a označ jako pokrytý gatem.
3. Co umíš, proveď sám proti disposable instanci. Webové UI přes
   `agent-browser` CLI, je-li nainstalované; bez něj jdou UI scénáře do
   ručního seznamu — nikdy nepředstírej průchod.
4. Report CELÝ ČESKY (PR je anglicky, tenhle report je pro uživatele — záměrně):
   - co bylo ověřeno automaticky (scénář → výsledek, přesné příkazy/kroky),
   - co pokrývá gate a UAT to neopakuje (kritérium → test),
   - **Ruční kroky pro uživatele**: číslovaný postup — kde kliknout, co
     spustit, co přesně čekat (jeden krok = jedno pozorovatelné chování),
   - zbytková rizika / co UAT nepokrylo a proč.
5. Report vytiskni (patří do finálního reportu dirigenta), nikdy ho neposílej
   jako komentář na PR. Každé kritérium se v něm musí objevit — nenamapované
   kritérium je nález, ne tiché přeskočení.
