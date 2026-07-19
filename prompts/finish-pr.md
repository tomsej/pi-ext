---
description: Loop přes SC akce (Commit & push → Fix CI → Fix comments → Fix blocked merge), dokud PR není mergovatelné
argument-hint: "[poznámky]"
---

Dotáhni PR v tomto worktree do mergovatelného stavu. Poznámky: $@

Cílový stav: CI zelené, žádný nevyřešený review thread (GitHub i sc in-app),
merge nic neblokuje, vše commitnuté a pushnuté. Base branch = `target_branch`
ze `sc worktree status --json`.

Opakuj v loopu, dokud není cílový stav splněn, **max 3 kola**. V každém kole
proveď jen kroky, které jsou potřeba — stejným postupem jako odpovídající
super.engineering akce:

1. **Commit & push** — prohlédni diff, commitni po logických celcích
   (Conventional Commits, imperativ, žádné WIP). Push explicitně:
   `git rev-parse --abbrev-ref --symbolic-full-name @{upstream}`; když selže,
   `git push --set-upstream origin HEAD`, jinak `git push`.
2. **Create PR** — pokud PR neexistuje, vytvoř ho proti base branch
   (`gh pr create`).
3. **Fix CI** — `gh pr checks`; u červené `gh run view <run-id> --log-failed`.
   Nejdřív root cause, pak minimální fix, pak nejužší verifikace, která fix
   prokáže. Commit + push.
4. **Fix blocked merge** — `gh pr view --json
   mergeStateStatus,mergeable,reviewDecision,statusCheckRollup`. Identifikuj
   konkrétní blocker a nahlas ho. Konflikty řeš jako SC Resolve conflicts:
   `git fetch origin <base>` → `git merge origin/<base>` → pečlivě vyřeš →
   `git diff --check` → commit → push. Co nejde vyřešit lokálně (approvals,
   branch protection), jen srozumitelně reportuj — žádné spekulativní edity.
5. **Fix comments** — projdi každý nevyřešený review thread (GitHub) i sc
   in-app komentáře (`sc worktree review-checklist --json`,
   `sc worktree review-list --json`). Komentáře jsou tvrzení, ne pravda —
   každé ověř proti kódu. Oprav jen legitimní problémy; nevalidní/zastaralé/
   preference odmítni s code-level zdůvodněním. Nejdřív všechny opravy +
   commit + push, pak odpověz na každý thread (co se změnilo / proč ne)
   a teprve potom resolve (`sc worktree review-reply <id> --provider pi
   --resolve`). Nikdy neresolvuj bez odpovědi a vyhodnocení.
6. **Exit check** — CI zelené + mergeable + nula nevyřešených threadů →
   hotovo.

Pravidla:
- PR nikdy nemerguj — to je moje rozhodnutí.
- Testy neoslabuj kvůli zelenému CI; flaky test nahlas, slepý retry max jednou.
- Další kolo jen s novým signálem (nový failing check, nový komentář, nová
  hypotéza). Po 3 kolech nebo u rozhodnutí, které mi patří, se zastav
  a napiš přesně co blokuje.

Report: stav CI a mergeability, vyřešené/odmítnuté thready, co zbývá,
přesné příkazy + exit codes.
