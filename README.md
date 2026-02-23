```
           ██▓███   ██▓              ▓█████ ▒██   ██▒▄▄▄█████▓
          ▓██░  ██▒▓██▒              ▓█   ▀ ▒▒ █ █ ▒░▓  ██▒ ▓▒
          ▓██░ ██▓▒▒██▒   ▄▄▄▄▄     ▒███   ░░  █   ░▒ ▓██░ ▒░
          ▒██▄█▓▒ ▒░██░   ░░░░░     ▒▓█  ▄  ░ █ █ ▒ ░ ▓██▓ ░
          ▒██▒ ░  ░░██░              ░▒████▒▒██▒ ▒██▒  ▒██▒ ░
          ▒▓▒░ ░  ░░▓░              ░░ ▒░ ░▒▒ ░ ░▓ ░  ▒ ░░
          ░▒ ░     ░▒░               ░ ░  ░░░   ░▒ ░    ░
          ░░       ░░                  ░    ░    ░    ░
                                       ░  ░ ░
```

A collection of extensions, skills, and themes for [Pi](https://github.com/badlogic/pi), the AI coding agent for the terminal.

Extensions range from visual UI enhancements (custom footer, leader key palette, session switcher) to deep integrations (web search, code review, Ghostty terminal support). Everything is MIT licensed and designed to be installed together or individually.

<video src="https://github.com/tomsej/pi-ext/releases/download/v0.1.0/demo.mp4" controls autoplay muted loop width="100%"></video>

> *Leader key palette → model switcher → session picker → code review*

## Install

```bash
pi install github:tomsej/pi-ext
```

Or install individual extensions:

```bash
pi install github:tomsej/pi-ext/extensions/leader-key
```

Requires [Pi](https://github.com/badlogic/pi) v0.37.3+.

## Extensions

### [Leader Key](extensions/leader-key/)

Press `Ctrl+Space` to open a floating command palette — like Vim's which-key or Emacs' leader key. Actions are organized into single-character groups (`s` for Session, `m` for Model, `f` for Favourites, `t` for Thinking level). Auto-discovers extension commands and merges them with built-in actions.

Includes sub-modules:
- **Model Switcher** — searchable provider → model → thinking level picker
- **Favourite Models** — quick-switch to preset model+thinking combos via `favourite-models.json`
- **Thinking Picker** — adjust reasoning effort (off, minimal, low, medium, high, xhigh)

### [Session Switcher](extensions/session-switch/)

Split-panel session picker with Pi's native session selector on the left and a live conversation preview on the right. Search, rename, delete, and resume sessions without leaving the TUI.

### [Model Switcher](extensions/model-switcher/)

Standalone multi-step model selector with searchable lists: pick a provider, pick a model, pick a thinking level. Available as `/switch` command or `Ctrl+Shift+M`. Also used internally by the leader key extension.

### [Custom Footer](extensions/custom-footer/)

Replaces Pi's default footer with a compact powerline-style status bar:

```
~/project (main) │ ↑12k ↓8k $0.42 │ 42%/200k │ ⚡ claude-sonnet-4 • medium
```

Shows working directory, git branch, token usage, cost, context window utilization, and active model — all in a single line.

### [Pi Web Access](extensions/pi-web-access/)

Web search, content extraction, and video understanding. Zero config if you're signed into Google in Chrome, or bring your own Perplexity/Gemini API keys. Based on [pi-web-access](https://github.com/nicobailon/pi-web-access) by [Nico Bailon](https://github.com/nicobailon).

**Tools:** `web_search`, `fetch_content`, `get_search_content`

Capabilities: Perplexity & Gemini search, GitHub repo cloning, YouTube video understanding, local video analysis, PDF extraction, blocked-page fallbacks, interactive search curator UI.

See the [full README](extensions/pi-web-access/README.md) for details.

### [Code Review](extensions/review/)

`/review` command with multiple modes: review a GitHub PR (checks it out locally), diff against a base branch, review uncommitted changes, review a specific commit, or provide custom review instructions. Supports project-specific `REVIEW_GUIDELINES.md`. Derived from [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff) (Apache 2.0).

### [Todos](extensions/todos/)

File-based todo management stored in `.pi/todos/`. Each todo is a standalone markdown file with JSON front matter. Supports claiming (lock files), tagging, status tracking, and automatic GC of closed items. Comes with both a `/todos` TUI and LLM-facing tools (`todo` tool) for natural language task management. Derived from [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff) (Apache 2.0).

### [Context](extensions/context/)

`/context` command showing what's loaded in the current session: extensions, skills, project context files (`AGENTS.md`/`CLAUDE.md`), context window usage, and session cost totals. Derived from [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff) (Apache 2.0).

### [Ghostty](extensions/ghostty/)

[Ghostty](https://ghostty.org) terminal integration. Sets dynamic window titles with project, session, and model info. Animates a braille spinner and pulses Ghostty's native progress bar while the agent is working. Based on [pi-ghostty](https://github.com/HazAT/pi-ghostty) by [HazAT](https://github.com/HazAT).

## Skills

| Skill | Description |
|-------|-------------|
| [commit](skills/commit/) | Conventional Commits-style `git commit` — infers type, scope, and summary from the diff |
| [github](skills/github/) | Recipes for the `gh` CLI — PR checks, CI runs, issue queries, JSON output |
| [librarian](skills/librarian/) | Research open-source libraries with evidence-backed answers and GitHub permalinks |

## Themes

| Theme | Description |
|-------|-------------|
| [catppuccin-mocha](themes/catppuccin-mocha.json) | Dark theme based on [Catppuccin Mocha](https://github.com/catppuccin/catppuccin) |

## Configuration

Most extensions work out of the box. Notable config:

- **Leader Key** — edit `extensions/leader-key/favourite-models.json` to set your favourite model presets
- **Pi Web Access** — optionally configure API keys in `~/.pi/web-search.json` (see [README](extensions/pi-web-access/README.md#configuration))
- **Todos** — set `PI_TODO_PATH` env var to change the storage directory (defaults to `.pi/todos`)

## License

[MIT](LICENSE) © tomsej
