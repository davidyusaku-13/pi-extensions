import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * block-env — Global hook to block agent access to .env files and environment variables.
 *
 * Covers:
 * - Direct file operations: read, write, edit, ls
 * - Search tools: grep, find
 * - Sandbox execution: codemode (preventing script-level env snooping & nested tool access)
 * - Shell tools: bash, powershell (blocking commands referencing .env, dumps, inline scripts, encodings)
 * - Generic/MCP tools inspection: any tool input or nested tool containing sensitive .env paths
 *
 * Example templates (.env.example, *.sample, *.template) remain allowed.
 */

function sanitizeToken(token: string): string {
  // Strip quotes, redirections (<, >, |), brackets, and semicolons
  return token.replace(/^[<>"'`;()&|]+|[<>"'`;()&|]+$/g, "").trim();
}

function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

function isSensitiveEnvPath(pathStr: string): boolean {
  if (!pathStr) return false;
  const clean = sanitizeToken(pathStr);
  const base = basename(clean);
  if (!base) return false;

  // Allow safe templates / example configurations
  if (
    base === ".env.example" ||
    base.endsWith(".example") ||
    base.endsWith(".sample") ||
    base.endsWith(".template")
  ) {
    return false;
  }

  // Block .env, .env.local, .env.production, etc.
  return base === ".env" || base.startsWith(".env.");
}

function containsSensitiveEnvPath(text: string): boolean {
  if (!text) return false;

  // 1. Check for standard whitespace/quote separated tokens
  const tokens = text.split(/[\s"'`\\/:]+/);
  for (const token of tokens) {
    if (isSensitiveEnvPath(token)) return true;
  }

  // 2. Direct regex match for .env references not followed by safe extensions
  // Catches tricky cases like cat<.env, $(echo .env), /path/.env
  // Also rejects .environment, .env_setup via negative lookahead
  const directEnvMatch = /(^|[^a-zA-Z0-9_-])\.env(\.[a-zA-Z0-9_-]+)?(?![a-zA-Z0-9_])(?![a-zA-Z0-9_.-]*(example|sample|template))/i;
  if (directEnvMatch.test(text)) {
    return true;
  }

  return false;
}

function containsSuspiciousBase64Env(text: string): boolean {
  // Matches base64 representations of '.env' or common env commands
  // .env -> LmVudg, Ll9lbnY, cHJpbnRlbnY (printenv), b3MuZW52aXJvbg (os.environ)
  //
  // NOTE: Base64 fragments are fragile (encoding shifts with padding/context).
  // Defense-in-depth only; primary protection from other layers.
  return /\b(LmVudg|cHJpbnRlbnY|b3MuZW52aXJvbg)\b/i.test(text);
}

function isSuspiciousShellCommand(cmd: string): boolean {
  if (!cmd) return false;

  // 1. Direct sensitive .env path check
  if (containsSensitiveEnvPath(cmd)) return true;

  // 2. Base64 / encoded snoop attempts
  if (containsSuspiciousBase64Env(cmd)) return true;

  // 3. Shell dump commands: standalone env, printenv, or cmd set
  // Distinguish standalone "env" from "/usr/bin/env <cmd>" or "env VAR=VAL <cmd>"
  const standaloneEnvDump = /(^|[;&|`$()\n\r]\s*)(env|printenv)\s*($|[;&|><\n\r])/i;
  // Match bare "set" for var dump, NOT "set -e", "set -x", "set -o" etc.
  const cmdSetPattern = /(^|[;&|\n\r]\s*)set\s+($|[;&|\n\r])/i;
  if (standaloneEnvDump.test(cmd) || cmdSetPattern.test(cmd)) return true;

  // 4. PowerShell environment snooping
  const psEnvPattern = /\b(env:|\$env:|Get-ChildItem\s+env:|dir\s+env:|ls\s+env:)/i;
  if (psEnvPattern.test(cmd)) return true;

  // 5. Python / Node / Ruby / Perl inline environment dumping
  const inlineEnvPattern = /(os\.environ|process\.env|ENV\[|ENV\.to_h|%ENV)/i;
  if (inlineEnvPattern.test(cmd)) return true;

  return false;
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    const tool = event.toolName;
    const input = (event.input ?? {}) as Record<string, unknown>;

    // --- 1. Direct file access tools (read, write, edit, ls) ---
    if (tool === "read" || tool === "write" || tool === "edit" || tool === "ls") {
      const targetPath = String(input.path ?? "");
      if (isSensitiveEnvPath(targetPath) || containsSensitiveEnvPath(targetPath)) {
        if (ctx.hasUI) ctx.ui.notify(`Blocked ${tool}: ${targetPath}`, "warning");
        return {
          block: true,
          reason: `Access to "${targetPath}" is blocked by block-env protection`,
        };
      }

      // Deep-inspect edit newText to block sensitive path injection
      if (tool === "edit" && Array.isArray(input.edits)) {
        for (const edit of input.edits as Array<{ newText?: string }>) {
          const newText = String(edit.newText ?? "");
          if (containsSensitiveEnvPath(newText)) {
            if (ctx.hasUI) ctx.ui.notify("Blocked edit: newText has sensitive path ref", "warning");
            return {
              block: true,
              reason: "Edit blocked: newText contains sensitive file reference",
            };
          }
        }
      }
      return undefined;
    }

    // --- 2. Search tools (grep, find) ---
    if (tool === "grep" || tool === "find") {
      const dump = JSON.stringify(input);
      if (containsSensitiveEnvPath(dump)) {
        if (ctx.hasUI) ctx.ui.notify(`Blocked ${tool} on .env`, "warning");
        return {
          block: true,
          reason: `Searching .env files is blocked by block-env protection`,
        };
      }
      return undefined;
    }

    // --- 3. Shell tools (bash, powershell) ---
    if (tool === "bash" || tool === "powershell") {
      const cmd = String(input.command ?? "");
      if (isSuspiciousShellCommand(cmd)) {
        if (ctx.hasUI) ctx.ui.notify(`Blocked shell command snooping .env/environment`, "warning");
        return {
          block: true,
          reason: "Shell command touching .env or reading environment variables is blocked by block-env protection",
        };
      }
      return undefined;
    }

    // --- 4. Codemode sandbox execution ---
    // Codemode runs in a secure QuickJS sandbox with no Node.js process, file system, or env access.
    // Nested tool calls made by codemode (such as tools.read, tools.bash) are already individually
    // intercepted and checked by this tool_call hook.
    // We only block scripts that explicitly string-target sensitive .env files.
    if (tool === "codemode") {
      const code = String(input.code ?? "");
      if (containsSensitiveEnvPath(code) || containsSuspiciousBase64Env(code)) {
        if (ctx.hasUI) ctx.ui.notify(`Blocked codemode script touching .env`, "warning");
        return {
          block: true,
          reason: "Codemode script referencing .env is blocked by block-env protection",
        };
      }
      return undefined;
    }

    // --- 5. Generic check for any other tools (e.g. MCP tools, custom extensions) ---
    try {
      const serialized = JSON.stringify(input);
      if (containsSensitiveEnvPath(serialized)) {
        if (ctx.hasUI) ctx.ui.notify(`Blocked ${tool} accessing .env`, "warning");
        return {
          block: true,
          reason: `Tool "${tool}" call blocked because parameters touch .env`,
        };
      }
    } catch {
      // Ignore serialization issues
    }

    return undefined;
  });
}
