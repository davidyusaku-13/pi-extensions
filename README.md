# Pi Extensions

A collection of extensions for the [Pi coding agent harness](https://github.com/earendil-works/pi-coding-agent).

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

### 3. `readable-stats` (`extensions/readable-stats.ts`)
* Formats terminal footer metrics into clean, readable, grouped token counters.
* Uses Pi's official `ctx.ui.setFooter()` Extension API hook.
* Displays prompt tokens, completion tokens, context limits, and active cache ratios cleanly in the TUI footer.

### 4. `dynamic-compaction` (`extensions/dynamic-compaction.ts`)
* Automatically triggers compaction when context usage reaches a percentage threshold (defaults to **40%**).
* Avoids waiting until 90%+ capacity, keeping model inferences fast, focused, and inexpensive.
* Provides a `/compact-threshold` command to view real-time context usage or adjust the target threshold dynamically (e.g. `/compact-threshold 35`).

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
pi --extension ./extensions/dynamic-compaction.ts
```

Or copy whichever extension you need into your local directory:
`~/.pi/agent/extensions/`

---

## License

[MIT](LICENSE)
