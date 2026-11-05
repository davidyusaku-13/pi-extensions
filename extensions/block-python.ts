import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * block-python — Enforces using 'uv' and 'uvx' instead of direct python / pip execution.
 *
 * Intercepts:
 * - Shell tools: bash, powershell
 * - Commands: python, python3, python3.x, python.exe, py, py.exe, pip, pip3, pip.exe, and direct venv python binaries.
 *
 * Allowed:
 * - Any command prefixed or invoked via 'uv' or 'uvx' (e.g. uv run python, uv run script.py, uv pip install)
 * - Non-execution references (e.g. git commit -m "python", cat script.py, grep python, find . -name "*.py")
 */

interface BlockResult {
  blocked: boolean;
  executable?: string;
  statement?: string;
}

function checkStatement(rawStmt: string): BlockResult {
  let stmt = rawStmt.trim();
  if (!stmt) return { blocked: false };

  // Strip grouping tokens, subshell prefixes, or PowerShell call operator (&)
  stmt = stmt.replace(/^[\s()&{}]+/, "").trim();

  // Strip POSIX environment variable assignments (e.g. FOO=bar, PYTHONPATH=.)
  while (/^[A-Za-z_][A-Za-z0-9_]*=(?:[^\s"'`]+|"[^"]*"|'[^']*')\s+/.test(stmt)) {
    stmt = stmt.replace(/^[A-Za-z_][A-Za-z0-9_]*=(?:[^\s"'`]+|"[^"]*"|'[^']*')\s+/, "").trim();
  }

  // Strip common command wrappers
  while (/^(?:sudo|nohup|time|builtin|exec|command)\s+/i.test(stmt)) {
    stmt = stmt.replace(/^(?:sudo|nohup|time|builtin|exec|command)\s+/i.test(stmt), "").trim();
  }

  // Extract leading executable token (handling quotes if any)
  const match = stmt.match(/^("([^"]+)"|'([^']+)'|([^\s(){}<>|;&]+))/);
  if (!match) return { blocked: false };

  const exeToken = (match[2] ?? match[3] ?? match[4] ?? "").trim();
  const exeBase = exeToken.split(/[\/\\]/).pop()?.toLowerCase() ?? "";

  // 1. If command is uv or uvx -> allowed
  if (exeBase === "uv" || exeBase === "uvx" || exeBase === "uv.exe" || exeBase === "uvx.exe") {
    return { blocked: false };
  }

  // 2. Check for subshell commands like bash -c "..." or powershell -Command "..."
  if (
    /^(?:bash|sh|zsh|dash|powershell|pwsh)(?:\.exe)?$/i.test(exeBase) &&
    /(?:-c|-command)\s+("([^"]+)"|'([^']+)')/i.test(stmt)
  ) {
    const subMatch = stmt.match(/(?:-c|-command)\s+(?:"([^"]+)"|'([^']+)')/i);
    const innerCmd = subMatch?.[1] ?? subMatch?.[2];
    if (innerCmd) {
      const innerCheck = isBlockedPythonCommand(innerCmd);
      if (innerCheck.blocked) {
        return innerCheck;
      }
    }
  }

  // 3. Check blocked executables: python, python3, py, pip, pip3, etc.
  const isPython = /^(python(?:\d+(?:\.\d+)?)?|py)(?:\.exe)?$/i.test(exeBase);
  const isPip = /^(pip(?:\d+(?:\.\d+)?)?)(?:\.exe)?$/i.test(exeBase);

  if (isPython || isPip) {
    return { blocked: true, executable: exeBase, statement: stmt };
  }

  return { blocked: false };
}

export function isBlockedPythonCommand(cmd: string): BlockResult {
  if (!cmd || typeof cmd !== "string") return { blocked: false };

  // Split on statement delimiters: ;, &&, ||, |, &, newlines, and subshells
  const statements = cmd.split(/(?:[\r\n;&|]|(?:\$\()|`)+/);

  for (const rawStmt of statements) {
    const result = checkStatement(rawStmt);
    if (result.blocked) {
      return result;
    }
  }

  return { blocked: false };
}

const UV_GUIDANCE_MESSAGE = `Direct execution of python/pip is blocked. Please use 'uv' or 'uvx' instead:
- Run scripts:          uv run <script.py> (or uv run python <script.py>)
- Run modules:          uv run -m <module>
- Add dependencies:     uv add <package>
- Pip compatibility:    uv pip install <package>
- Run CLI tools:        uvx <tool> (e.g. uvx ruff, uvx pytest)
- Environment info:     uv python list`;

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    const tool = event.toolName;
    if (tool !== "bash" && tool !== "powershell") {
      return undefined;
    }

    const input = (event.input ?? {}) as Record<string, unknown>;
    const cmd = String(input.command ?? "");

    const check = isBlockedPythonCommand(cmd);
    if (check.blocked) {
      if (ctx.hasUI) {
        ctx.ui.notify(
          `Blocked direct execution of '${check.executable}'. Use 'uv' or 'uvx' instead.`,
          "warning"
        );
      }

      return {
        block: true,
        reason: `${UV_GUIDANCE_MESSAGE}\n\nAttempted command: "${cmd.trim()}"`,
      };
    }

    return undefined;
  });
}
