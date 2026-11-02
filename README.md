# Pi Extensions

A collection of extensions for the [Pi coding agent harness](https://github.com/earendil-works/pi-coding-agent).

## Included Extensions

### 1. `auto-title` (`extensions/auto-title.ts`)
* Automatically generates a concise, relevant session title using the active model.
* Triggers on `agent_settled` after the first user/assistant exchange.
* Automatically updates the title on `session_compact` (following `/compact` or automatic context compaction).
* Respects manually set titles or explicit renames.

### 2. `block-env` (`extensions/block-env.ts`)
* Security guardrail preventing accidental exposure of sensitive environment variables and credentials.
* Intercepts:
  - File operations targeting sensitive configuration files.
  - Search tools (`grep`, `find`).
  - Shell commands and scripts attempting to print process environment variables.
  - Sandboxes attempting to read process environment variables.

### 3. `readable-stats` (`extensions/readable-stats.ts`)
* Formats terminal footer metrics into clean, readable, grouped token counters.
* Uses Pi's official `ctx.ui.setFooter()` Extension API hook.
* Displays prompt tokens, completion tokens, context limits, and active cache ratios cleanly in the TUI footer.

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
pi --extension ./extensions/auto-title.ts
```

Or copy whichever extension you need into your local directory:
`~/.pi/agent/extensions/`

---

## License

[MIT](LICENSE)
