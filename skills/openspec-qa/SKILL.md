---
name: openspec-qa
description: Manual user-testing (QA) step for an OpenSpec change. Use after review, before archive, when the user wants to test the feature manually as a user. Generates a qa.md with user-facing test scenarios, prepares the environment, and hands off to Plannotator for annotation.
license: MIT
compatibility: Requires openspec CLI. Plannotator extension recommended.
metadata:
  author: tomsej
  version: "1.0"
---

Generate a manual QA checklist for an OpenSpec change, prepare the test environment, and let the user walk through scenarios in Plannotator.

**Position in workflow:** propose → apply → review → **qa** → archive.

**Input**: Optionally a change name. If omitted, infer from conversation context; if only one active change exists, auto-select; otherwise list via `openspec list --json` and ask.

**Steps**

1. **Select the change**

   Same pattern as other openspec skills. Announce: "QA for change: <name>".

2. **Read context**

   ```bash
   openspec status --change "<name>" --json
   openspec instructions apply --change "<name>" --json
   ```

   Read every file under `contextFiles` (proposal, specs, design, tasks). The delta specs are the source of truth for scenarios — do not invent behavior that is not specced or implemented.

3. **Detect what is being tested**

   From proposal/design/tasks, determine the surface: web app, CLI, backend/API, extension, etc. This drives environment prep and how scenarios are phrased:
   - **web** → steps are "open URL, click, type, expect to see"
   - **CLI** → steps are copy-pasteable commands + expected output
   - **backend/API** → curl/httpie commands + expected responses
   - **mixed** → group scenarios by surface

4. **Prepare the environment**

   Do whatever a user would need before testing: build, start dev server (background), seed data, create test accounts, set env vars. Verify it actually works (e.g., curl the health endpoint, run the CLI once). If prep fails, pause and report — do not write a QA doc for a broken environment.

5. **Write `qa.md` into the change directory** (`openspec/changes/<name>/qa.md`)

   Structure:

   ```markdown
   # QA: <change-name>

   ## Prostředí (připraveno)
   - <what is running, where, credentials>
   - reset: `<command>`

   ## Scénář 1: <name, derived from spec scenario>
   - [ ] <user step: what to do>
   - [ ] Očekávej: <observable result>

   ## Scénář 2: ...

   ## Poznámky
   (faily a postřehy — piš sem nebo anotuj v Plannotatoru)
   ```

   Rules for scenarios:
   - Derived from delta specs (Given/When/Then → user steps + expected outcome). One scenario per spec scenario; add edge cases only if specced.
   - Written for a user, not a developer: no code references, no file paths. Concrete values (URLs, commands, test accounts) — everything copy-pasteable.
   - Write scenario text in Czech; keep commands, URLs, and identifiers in English.
   - Every expectation must be observable (something the user can see), not internal state.

6. **Hand off to Plannotator (automatic)**

   Call the `plannotator_annotate` tool with the qa.md path:

   ```
   plannotator_annotate(filePath: "openspec/changes/<name>/qa.md")
   ```

   This opens the annotation browser UI and blocks until the user decides. Tell the user briefly before calling: walk through scenarios, annotate failures in the UI, then Approve or submit feedback. If the tool is unavailable, fall back to telling the user to run `/plannotator-annotate openspec/changes/<name>/qa.md`.

7. **Handle the result**

   - **Approved** → QA passed, suggest `openspec archive <name>`
   - **Feedback returned** → for each failed scenario: find the root cause in the code, fix it, update the tasks file if new work emerged, re-verify the environment, update qa.md (uncheck affected items, note the fix), and call `plannotator_annotate` again for a re-run.

**Guardrails**
- Scenarios come from specs, not imagination. If specs have no scenarios, derive from proposal acceptance criteria and say so.
- Keep qa.md short — a user should get through it in minutes, not hours.
- Never mark scenarios as passed yourself; only the user checks items off.
- If the environment cannot be prepared (missing services, secrets), list the manual prerequisites at the top of qa.md instead of failing silently.
- Background long-running processes (dev servers); record how to stop/reset them in qa.md.
