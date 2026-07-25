---
name: wf-uat
description: UAT phase for a workflow contract — derives scenarios from the contract's UAT section and acceptance criteria, executes them against a disposable instance, and delivers Czech manual steps for the user. Called automatically by wf-impl (uat: auto) or manually with a spec path.
---

# wf-uat — user acceptance testing

Argument: absolute path to a contract (`~/Workspace/specs/<project>/<name>.md`
— specs live outside the repo). Never modify code, tests, or repo
configuration. If you find a defect, report it; fixing belongs to the
implementation/review phases.

UAT is NOT a re-run of the gates. The gate already proved the acceptance
criteria through tests; re-executing those tests (or poking internal APIs)
produces false confidence, not new information. UAT's single definition:
**the user's perspective, through the user's interface, on a running
instance** — the CLI as the user would type it, the UI as they would click
it, the public API as they would call it.

This skill is deliberately a standalone unit: the pipeline calls it as its
last phase and the user iterates on it independently. Keep its contract
stable — input: spec path; output: Czech UAT report.

## Environment

Run scenarios against a DISPOSABLE local instance, launched the project's
usual way (docker compose, dev server, seeded local DB) — never against a
shared or production environment. Pick a non-default free port — parallel
contracts may be running their own UAT on the same machine. State-changing scenarios (create, update,
delete) are fine inside that sandbox; "never modify" applies to the repo, not
to the sandbox's data. Tear the instance down when done; timebox everything,
no watch/dev-server left running. If the project offers no way to run a
disposable instance, say so — those scenarios go to the manual list.

## Steps

1. Read the contract: the **UAT** section and every **Akceptační kritérium**.
2. Derive UAT scenarios: every acceptance criterion must map to at least one
   scenario, plus the explicit UAT items. User's perspective only (what they
   see, type, and click) — skip execution where the scenario would merely
   repeat what the gate proved, and note it as covered-by-gate instead.
3. Execute what you can yourself against the disposable instance. For web
   UIs use the `agent-browser` CLI when installed (`agent-browser --help`);
   without it, UI scenarios go to the manual list — never fake a pass.
4. Write the report — CELÝ VÝSTUP ČESKY (the PR body is English, but the UAT
   report is for the user and stays Czech — deliberate):
   - co bylo ověřeno automaticky (scénář → výsledek, přesné příkazy/kroky),
   - co pokrývá gate a UAT to neopakuje (kritérium → test),
   - **Ruční kroky pro uživatele**: číslovaný postup — kde kliknout, co
     spustit, co přesně očekávat (jeden krok = jedno pozorovatelné chování),
   - zbytková rizika / co UAT nepokrylo a proč.
5. Deliver: print the report (it belongs in the conductor's final report) —
   never post it as a PR comment. Every criterion must appear —
   an unmapped criterion is a finding, not something to skip silently.
