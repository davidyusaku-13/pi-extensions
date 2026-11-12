# Pi Extensions & Themes

A collection of extensions and themes for the [Pi coding agent harness](https://github.com/earendil-works/pi-coding-agent).

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
* Formats terminal footer metrics into clean, readable, grouped token counters using Pi's official `ctx.ui.setFooter()` hook.
* Displays prompt tokens, completion tokens, context limits, and active cache hit ratios cleanly in the TUI footer.
* Automatically detects the `pi-antigravity` package when installed and displays a live Gemini subscription quota column (`gemini: <5h>% (<reset>) · wk <wk>% (<reset>)`) with background auto-refresh and warning/error thresholds.

### 5. `dynamic-compaction` (`extensions/dynamic-compaction.ts`)
* Automatically triggers compaction when context usage reaches a percentage threshold (defaults to **40%**) once the agent settles (idle), preventing disruptive mid-task context loss.
* Avoids waiting until 90%+ capacity, keeping model inferences fast, focused, and inexpensive.
* Includes an emergency safety ceiling (85%) during active turns (`turn_end`) to protect against sudden context overflows from large tool outputs, auto-resuming pending steps.
* Provides a `/compact-threshold` command to view real-time context usage or adjust the target threshold dynamically (e.g. `/compact-threshold 35`).

### 6. `dollar-skills` (`extensions/dollar-skills.ts`)
* Allows invoking any skill with a leading `$` shortcut instead of `/skill:` (e.g. `$shadcn add button`).
* Seamlessly transforms `$skill-name [args]` into `/skill:skill-name [args]` at the input layer.
* Adds a dedicated TUI autocomplete dropdown for `$` showing all discoverable skills with fuzzy matching.

### 7. `activity-stats` (`extensions/activity-stats.ts`)
* Analyzes all local Pi session history (`~/.pi/agent/sessions/**/*.jsonl`) to visualize your most active hours and usage patterns.
* Provides the `/stats` command (and `/activity` alias) featuring an interactive, scrollable TUI modal:
  - **24-Hour Activity Histogram**: Visual ASCII bar charts with ranked peak hours.
  - **Weekly & Habit Breakdown**: Daily activity counts and routine windows (Evening, Afternoon, Late Night, Sleep/Off).
  - **Multi-Period Filtering**: Quick tabs/flags for All Time, Past 7 Days (`/stats week`), Today (`/stats today`), and Past 30 Days (`/stats month`).
  - **Current Session Inspector**: Use `/stats session` to view real-time turn counts, token consumption, cache hit rate %, and estimated API costs for the active conversation.
  - **Universal Support**: Renders a rich interactive modal in TUI mode and a structured report in CLI/print mode.

### 8. `init` (`extensions/init.ts`)
* Adopted directly from [OpenAI Codex](https://github.com/openai/codex)'s native `/init` command and prompt asset (`codex-rs/tui/assets/prompt_for_init_command.md`).
* Registers the `/init` slash command to generate a structured `AGENTS.md` repository guidelines and contributor guide.
* Evaluates project structure, build/test commands, code styles, testing practices, and commit/PR history.
* Safe by default: refuses to overwrite an existing `AGENTS.md` unless requested via `--force` or `-f` (e.g. `/init --force`). Also accepts custom instructions (e.g. `/init focus on uv workflows`).

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
