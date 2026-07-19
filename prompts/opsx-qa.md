---
description: Manual QA for an OpenSpec change — generate qa.md, prep environment, hand off to Plannotator
---

Manual user-testing (QA) step for an OpenSpec change. Position in workflow: propose → apply → review → **qa** → archive.

**Input**: Optionally a change name (e.g., `/opsx-qa add-auth`). If omitted, infer from conversation context; auto-select if only one active change exists; otherwise run `openspec list --json` and use the **AskUserQuestion tool** to let the user select.
**Provided arguments**: $@

**Steps**

1. **Select the change**

   Announce: "QA for change: <name>" and how to override (`/opsx-qa <other>`).

2. **Read context**

   ```bash
   openspec status --change "<name>" --json
   openspec instructions apply --change "<name>" --json
   ```

   Read every file under `contextFiles` (proposal, specs, design, tasks). The delta specs are the source of truth for scenarios — do not invent behavior that is not specced or implemented.

3. **Detect what is being tested**

   From proposal/design/tasks, determine the surface and phrase scenarios accordingly:
   - **web** → "open URL, click, type, expect to see"
   - **CLI** → copy-pasteable commands + expected output
   - **backend/API** → curl commands + expected responses
   - **mixed** → group scenarios by surface

4. **Prepare the environment**

   Build, start dev server (background), seed data, create test accounts, set env vars — whatever a user needs before testing. Verify it actually works (curl health endpoint, run the CLI once). If prep fails, pause and report — do not write a QA doc for a broken environment.

5. **Write `qa.md` into the change directory** (`openspec/changes/<name>/qa.md`)

   ```markdown
   # QA: <change-name>

   ## Prostředí (připraveno)
   - <what is running, where, credentials>
   - reset: `<command>`

   ## Scénář 1: <name, derived from spec scenario>
   - [ ] <user step: what to do>
   - [ ] Očekávej: <observable result>

   ## Poznámky
   (faily a postřehy — piš sem nebo anotuj v Plannotatoru)
   ```

   Rules:
   - Scenarios derived from delta specs (Given/When/Then → user steps + expected outcome). One per spec scenario; edge cases only if specced.
   - Written for a user, not a developer: no code references, no file paths. Concrete values, everything copy-pasteable.
   - Scenario text in Czech; commands, URLs, and identifiers in English.
   - Every expectation must be observable, not internal state.

6. **Hand off to Plannotator (automatic)**

   Call the `plannotator_annotate` tool with the qa.md path:

   ```
   plannotator_annotate(filePath: "openspec/changes/<name>/qa.md")
   ```

   This opens the annotation browser UI and blocks until the user decides. Tell the user briefly before calling: walk through scenarios, annotate failures in the UI, then Approve or submit feedback. If the tool is unavailable, fall back to telling the user to run `/plannotator-annotate openspec/changes/<name>/qa.md`.

7. **Handle the result**

   - **Approved** → QA passed, suggest `openspec archive <name>`
   - **Feedback returned** → for each failed scenario: find the root cause, fix it, update the tasks file if new work emerged, re-verify the environment, update qa.md (uncheck affected items, note the fix), and call `plannotator_annotate` again for a re-run.

**Guardrails**
- Scenarios come from specs, not imagination. If specs have no scenarios, derive from proposal acceptance criteria and say so.
- Keep qa.md short — minutes to complete, not hours.
- Never mark scenarios as passed yourself; only the user checks items off.
- If the environment cannot be prepared (missing services, secrets), list manual prerequisites at the top of qa.md instead of failing silently.
- Background long-running processes; record how to stop/reset them in qa.md.
