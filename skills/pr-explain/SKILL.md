---
name: pr-explain
description: Explain a GitHub pull request as an English Markdown walkthrough and return a Plannotator share link. Use for PR explanations, walkthroughs, or review preparation.
disable-model-invocation: true
---

# PR Explain

Generate an accurate English explanation of one PR. Read the repository; never modify it.

## Read the PR
Input: PR number or URL.
- Metadata: `gh pr view <n> --json title,body,baseRefName,headRefOid,url`.
- Changes and evidence: `gh pr diff <n>` and `gh pr checks <n>`.
- Fetch without checkout: `git fetch origin pull/<n>/head`; inspect files with `git show FETCH_HEAD:<path>`.
- Read callers and surrounding code, not only the diff.
- Treat PR claims as claims: confirm each with code, tests, or CI; mark unsupported claims ⚠️.

## Write the explanation
Save `~/Workspace/specs/<project>/pr-<n>-<slug>/explanation.md`; derive project, number, and slug—never guess them.
Use these sections in order:
1. **Background** — optional newcomer context, then the specific problem.
2. **Intuition** — the core idea with small example data.
3. **Change top to bottom** — one causal architecture/code walkthrough.
4. **Claims and evidence** — claim, user-visible result, exact test/check evidence.
5. **Try it yourself** — disposable setup and observable checklist items `- [ ]`.
6. **Quiz** — five useful multiple-choice questions.

## Change map
Use closed `<details>` blocks: `<code>PRINCIPLE</code>` → `<code>FLOW</code>` → `<code>STEP</code>` → `<code>KEPT</code>` → `<code>VERIFY</code>`.
Each `<summary>` must stand alone: label, short title, one-sentence conclusion.
Inside STEP, include only important files: 🟡 `<a href="<diff-url>"><code>MODIFIED</code></a>` or 🟢 `<a href="<diff-url>"><code>NEW</code></a>`.
Make the file name a permalink to exact HEAD lines: `.../blob/<sha>/<path>#Lx-Ly`.
Show a short final-code snippet fenced with the language of the source file; link to the diff instead of pasting raw diff headers.
Skip lockfiles, generated files, mechanical edits, and repeated prose.

## Format
Write Markdown only. Use small `mermaid` diagrams with example data; no ASCII diagrams.
Use exact symbol, test, and file names. Unknown facts are `—` or ⚠️, never inventions.
Quiz answers must render inside raw HTML: `<details><summary>Answer</summary><p><strong>B.</strong> Why it is right and the others are wrong.</p></details>`.
Print the absolute output path.

## Share
Create and print the Plannotator URL; do not start a local server:
```bash
SHARE_URL="$(node -e 'const fs=require("node:fs"),z=require("node:zlib");const p=fs.readFileSync(process.argv[1],"utf8");console.log("https://share.plannotator.ai/#"+z.deflateRawSync(JSON.stringify({p,a:[]})).toString("base64url"))' "$EXPLANATION_PATH")"; printf 'Plannotator: %s\n' "$SHARE_URL"
```
The hash contains compressed, unencrypted content. Do not create it for sensitive PRs.
