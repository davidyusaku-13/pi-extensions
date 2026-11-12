import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { exec } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

/**
 * ensure-packages — Verifies that essential companion packages are installed in Pi.
 *
 * Checks on startup:
 *   - npm:@juicesharp/rpiv-ask-user-question
 *   - npm:@juicesharp/rpiv-todo
 *   - npm:@juicesharp/rpiv-web-tools
 *   - npm:@juicesharp/rpiv-btw
 *   - npm:pi-antigravity
 *   - npm:@ff-labs/pi-fff
 *
 * If any package is missing, automatically installs it via `pi install` and notifies the user.
 *
 * Slash commands:
 *   /ensure-packages         — Check status and install any missing packages
 *   /ensure-packages check   — Dry-run status report without installing
 */

export const REQUIRED_PACKAGES = [
  "npm:@juicesharp/rpiv-ask-user-question",
  "npm:@juicesharp/rpiv-todo",
  "npm:@juicesharp/rpiv-web-tools",
  "npm:@juicesharp/rpiv-btw",
  "npm:pi-antigravity",
  "npm:@ff-labs/pi-fff",
];

const execAsync = promisify(exec);

function getPackageFolder(pkgSpec: string): string {
  const withoutPrefix = pkgSpec.replace(/^npm:/, "");
  if (withoutPrefix.startsWith("@")) {
    const parts = withoutPrefix.slice(1).split("@");
    return `@${parts[0]}`;
  }
  return withoutPrefix.split("@")[0];
}

function getAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

function getSettingsPackages(): Set<string> {
  const settingsFile = join(getAgentDir(), "settings.json");
  if (!existsSync(settingsFile)) return new Set();
  try {
    const settings = JSON.parse(readFileSync(settingsFile, "utf8"));
    const packages = Array.isArray(settings?.packages) ? settings.packages : [];
    const set = new Set<string>();
    for (const p of packages) {
      if (typeof p === "string") {
        set.add(p);
      } else if (p && typeof p === "object" && typeof p.source === "string") {
        set.add(p.source);
      }
    }
    return set;
  } catch {
    return new Set();
  }
}

function isPackageInstalled(pkgSpec: string, settingsPackages: Set<string>): boolean {
  const folder = getPackageFolder(pkgSpec);
  const pkgDir = join(getAgentDir(), "npm", "node_modules", folder);
  const existsOnDisk = existsSync(pkgDir);
  const inSettings = settingsPackages.has(pkgSpec);
  return existsOnDisk && inSettings;
}

function getPiCommand(): string {
  const agentDir = getAgentDir();
  const winPi = join(agentDir, "bin", "pi.cmd");
  const unixPi = join(agentDir, "bin", "pi");
  if (process.platform === "win32" && existsSync(winPi)) {
    return `"${winPi}"`;
  }
  if (existsSync(unixPi)) {
    return `"${unixPi}"`;
  }
  return "pi";
}

async function installPackage(pkgSpec: string): Promise<{ success: boolean; output: string }> {
  const piCmd = getPiCommand();
  try {
    const { stdout, stderr } = await execAsync(`${piCmd} install "${pkgSpec}"`, {
      windowsHide: true,
      env: process.env,
    });
    return { success: true, output: (stdout || stderr || "").trim() };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, output: msg };
  }
}

export default function (pi: ExtensionAPI) {
  let isCheckingOrInstalling = false;
  let initialCheckDone = false;

  const checkAndInstall = async (
    ctx: ExtensionContext,
    dryRun = false
  ): Promise<{ installed: string[]; missing: string[]; failed: string[] }> => {
    if (isCheckingOrInstalling) {
      return { installed: [], missing: [], failed: [] };
    }
    isCheckingOrInstalling = true;

    try {
      const settingsPackages = getSettingsPackages();
      const installed: string[] = [];
      const missing: string[] = [];
      const failed: string[] = [];

      for (const pkg of REQUIRED_PACKAGES) {
        if (isPackageInstalled(pkg, settingsPackages)) {
          installed.push(pkg);
        } else {
          missing.push(pkg);
        }
      }

      if (missing.length === 0) {
        return { installed, missing, failed };
      }

      if (dryRun) {
        return { installed, missing, failed };
      }

      if (ctx.hasUI) {
        ctx.ui.notify(
          `Installing ${missing.length} missing companion package(s)...`,
          "info"
        );
      }

      for (const pkg of missing) {
        const res = await installPackage(pkg);
        if (res.success) {
          installed.push(pkg);
        } else {
          failed.push(pkg);
        }
      }

      if (ctx.hasUI) {
        if (failed.length === 0) {
          ctx.ui.notify(
            `All ${missing.length} missing package(s) installed successfully. Run /reload to activate.`,
            "info"
          );
        } else {
          ctx.ui.notify(
            `Installed ${missing.length - failed.length} package(s), ${failed.length} failed: ${failed.join(", ")}`,
            "warning"
          );
        }
      }

      return { installed, missing, failed };
    } finally {
      isCheckingOrInstalling = false;
    }
  };

  // 1. Silent automatic check and install on session startup
  pi.on("session_start", (_event, ctx) => {
    if (initialCheckDone) return;
    initialCheckDone = true;

    // Run asynchronously without blocking interactive session startup
    void checkAndInstall(ctx, false);
  });

  // 2. Slash command for manual verification and installation
  pi.registerCommand("ensure-packages", {
    description: "Verify and automatically install required companion packages",
    getArgumentCompletions: (prefix: string) => {
      const options = ["check", "install"];
      const matched = options.filter((o) => o.startsWith(prefix));
      return matched.length > 0 ? matched.map((o) => ({ value: o, label: o })) : null;
    },
    handler: async (args, ctx: ExtensionCommandContext) => {
      const trimmed = args.trim().toLowerCase();
      const isDryRun = trimmed === "check" || trimmed === "--check";

      const settingsPackages = getSettingsPackages();
      const missing: string[] = [];

      const lines: string[] = ["Package Status:"];
      for (const pkg of REQUIRED_PACKAGES) {
        const installed = isPackageInstalled(pkg, settingsPackages);
        if (installed) {
          lines.push(`  \u2714 [installed] ${pkg}`);
        } else {
          lines.push(`  \u2718 [missing]   ${pkg}`);
          missing.push(pkg);
        }
      }

      if (missing.length === 0) {
        lines.push("\nAll required packages are installed and up to date!");
        if (ctx.hasUI) {
          ctx.ui.notify("All companion packages are installed", "info");
        }
      } else if (isDryRun) {
        lines.push(`\n${missing.length} package(s) missing. Run /ensure-packages to install them.`);
        if (ctx.hasUI) {
          ctx.ui.notify(`${missing.length} package(s) missing. Run /ensure-packages to install.`, "warning");
        }
      } else {
        lines.push(`\nInstalling ${missing.length} missing package(s)...`);
        void checkAndInstall(ctx, false);
      }
    },
  });
}
