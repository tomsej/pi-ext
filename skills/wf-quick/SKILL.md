---
name: wf-quick
description: Malý task bez kontraktu — 1–3 akceptační kritéria v chatu, TDD v aktuální session, risk-based review, vždy branch + draft PR a explain dokument. Použij pro drobné fixy a malé featury; větší nebo rizikové tasky eskaluje na /wf.
disable-model-invocation: true
---

# /wf-quick — malý task bez ceremonie

Celý cyklus v TÉHLE session — žádný soubor kontraktu, žádný worktree, žádný
wf-gate. Chat je kontrakt. Endgame: draft PR + explain. Nikdy `gh pr merge`.

## Eskalační ventil

Překročí-li task kterýkoli limit, zastav a napiš „tohle je /wf case" —
kontrakt vytvoří skill `wf` z `~/Workspace/pi-ext/skills/wf/SKILL.md`:

- víc než 3 akceptační kritéria,
- víc než ~5 dotčených souborů,
- migrace, destruktivní operace, auth/security, nové veřejné API.

Ventil platí i v průběhu — když task přeroste pod rukama, zastav a eskaluj,
nedojížděj ho quick režimem.

## Postup

1. **Kritéria:** navrhni 1–3 pozorovatelná kritéria (styl jako ve /wf) a nech
   si je v chatu odsouhlasit — bez souhlasu nezačínej.
2. **Branch:** nová branch z čisté default branche (`git switch -c
   <type>/<slug>`). Jsi-li na feature branchi s rozdělanou prací, zeptej se.
3. **Implementace:** načti skill `tdd` — jeden failing test na kritérium →
   minimální kód → refactor na zeleném. Test nikdy neoslabuj.
4. **Review (risk-based):** default žádné. Sahá-li změna na auth/vstupy/data
   nebo o to uživatel požádá → jeden read-only reviewer přes `subagent_spawn`
   s jiným modelem nebo harnessem, než má tahle session — cross-model, jinak
   nemá cenu. Nálezy jsou tvrzení (severita + `file:line`); ověř je proti
   kódu, legitimní oprav sám.
5. **Check:** existující quick příkaz projektu (`npm test`, `make check` …) —
   žádný nový gate skript.
6. **Ship:** commit dle skillu `commit`; `gh pr create --draft`, titulek
   Conventional Commits, popis anglicky a krátce: Why / What changed /
   Verification (bez wf-spec markeru — quick nemá spec).
7. **Explain:** načti skill `wf-explain` z
   `~/Workspace/pi-ext/skills/wf-explain/SKILL.md` standalone s ref range
   `<target>...HEAD` — zapíše
   `~/Workspace/specs/<projekt>/YYYY-MM-DD-<slug>/explanation.md`.

## Report (česky)

Kritéria → testy, review (kdo / žádné a proč), výsledek checku, PR link,
cesta k explain dokumentu.
