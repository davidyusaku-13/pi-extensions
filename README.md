# Pi Extensions, Skills & Themes

A collection of extensions, skills, and themes for the [Pi coding agent harness](https://github.com/earendil-works/pi-coding-agent).

## Included Extensions

### 1. `auto-title` (`extensions/auto-title.ts`)
* Automatically generates a concise, relevant session title using the active model.
* Triggers on `agent_settled` after the first user/assistant exchange.
* Automatically updates the title on `session_compact` (following `/compact` or automatic context compaction).
* Respects manually set titles or explicit renames.

### 2. `block-env` (`extensions/block-env.ts`)
* Security guardrail preventing accidental exposure of sensitive credentials and full environment dumps.
* Intercepts:
  - File operations targeting sensitive configuration files (.env, .env.local, etc.).
  - Search tools (`grep`, `find`).
  - Shell commands and scripts attempting to dump all process environment variables.
  - Codemode scripts targeting sensitive files.
  - Safe templates (.env.example, *.sample, *.template, etc.) remain fully accessible.

### 3. `block-python` (`extensions/block-python.ts`)
* Enforces using `uv` and `uvx` tooling instead of raw Python or Pip commands.
* Intercepts shell tool calls (`bash`, `powershell`) invoking `python`, `python3`, `python.exe`, `py`, `pip`, `pip3`, or direct virtualenv python binaries.
* Automatically returns structured instructions to the model on how to run commands with `uv run`, `uv add`, `uv pip`, or `uvx`.
* Non-execution references (e.g. `git`, `cat`, `grep`, `find`) and valid `uv`/`uvx` invocations pass through untouched.

### 4. `readable-stats` (`extensions/readable-stats.ts`)
* Formats terminal footer metrics into clean, readable, grouped token counters.
* Uses Pi's official `ctx.ui.setFooter()` Extension API hook.
* Displays prompt tokens, completion tokens, context limits, and active cache ratios cleanly in the TUI footer.

### 5. `dynamic-compaction` (`extensions/dynamic-compaction.ts`)
* Automatically triggers compaction when context usage reaches a percentage threshold (defaults to **40%**).
* Avoids waiting until 90%+ capacity, keeping model inferences fast, focused, and inexpensive.
* Provides a `/compact-threshold` command to view real-time context usage or adjust the target threshold dynamically (e.g. `/compact-threshold 35`).

### 6. `dollar-skills` (`extensions/dollar-skills.ts`)
* Allows invoking any skill with a leading `$` shortcut instead of `/skill:` (e.g. `$shadcn add button`).
* Seamlessly transforms `$skill-name [args]` into `/skill:skill-name [args]` at the input layer.
* Adds a dedicated TUI autocomplete dropdown for `$` showing all discoverable skills with fuzzy matching.

## Included Skills

### 1. `init` (`skills/init/SKILL.md`)
* Generates or updates a concise `AGENTS.md` contributor guide tailored to the current repository.
* Inspects project structure, build/test commands, code styles, and Git conventions before generating repository guidelines.
* Usable via `/skill:init` or `$init`.

## Included Themes

### 1. `catppuccin-mocha` (`themes/catppuccin-mocha.json`)
* Soothing Catppuccin Mocha palette adapted for the Pi TUI.
* Features styled editor states, role-differentiated tool diffs, syntax highlighting, and thinking blocks.
* Selectable via `/settings` > **Theme** or by adding `"theme": "catppuccin-mocha"` to your `~/.pi/agent/settings.json`.

---

## Installation

### As a Pi Package

Install directly from GitHub using the Pi CLI:

```bash
pi install git:github.com/davidyusaku-13/pi-extensions
```

To add to your global Pi settings (`~/.pi/agent/settings.json`), add:

```json
{
  "packages": [
    "git:github.com/davidyusaku-13/pi-extensions"
  ]
}
```

### Loading Individual Extensions

You can also copy or load individual TypeScript files directly:

```bash
pi --extension ./extensions/dollar-skills.ts
```

---

## License

[MIT](LICENSE)
