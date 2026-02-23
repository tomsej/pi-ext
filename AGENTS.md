# Adding Extensions

1. Create `extensions/<name>/<name>.ts` (or `index.ts` for multi-file extensions)
2. Add the entry point to `pi.extensions` in `package.json`
3. If the extension has npm dependencies, add a `package.json` in its directory and run `npm install`

Skills go in `skills/<name>/SKILL.md`, themes in `themes/*.json`, prompts in `prompts/*.md`.
