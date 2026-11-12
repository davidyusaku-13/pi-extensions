import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { isAbsolute, relative, resolve, sep } from "node:path";

/**
 * readable-stats extension
 *
 * Formats footer stats into clean, grouped token metrics using Pi's official
 * ctx.ui.setFooter() Extension API hook. No minified bundle chunk patching required!
 */

function formatTokens(count: number): string {
  return count < 1e3
    ? count.toString()
    : count < 1e4
    ? `${(count / 1e3).toFixed(1)}k`
    : count < 1e6
    ? `${Math.round(count / 1e3)}k`
    : count < 1e7
    ? `${(count / 1e6).toFixed(1)}M`
    : `${Math.round(count / 1e6)}M`;
}

function formatCwdForFooter(cwd: string, home: string | undefined): string {
  if (!home) return cwd;
  const resolvedCwd = resolve(cwd);
  const resolvedHome = resolve(home);
  const rel = relative(resolvedHome, resolvedCwd);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
    ? rel === ""
      ? "~"
      : `~${sep}${rel}`
    : cwd;
}

function sanitizeStatusText(text: string): string {
  return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI || typeof ctx.ui.setFooter !== "function") return;

    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsub = footerData.onBranchChange(() => tui.requestRender());

      return {
        dispose: unsub,
        // invalidate() is a no-op: the footer re-renders on every render() call,
        // and branch changes are handled by the onBranchChange subscription above.
        invalidate() {},
        render(width: number): string[] {
          let input = 0;
          let output = 0;
          let cacheRead = 0;
          let cacheWrite = 0;
          let cost = 0;
          // Shows the most recent assistant message's cache hit rate (not session average),
          // which reflects current cache effectiveness after prompt changes.
          let latestCacheHitRate: number | undefined;

          // Deduplicate usage: track entry IDs to prevent double-counting when
          // usage appears in both a dedicated "usage" entry and an assistant message.
          const seenEntryIds = new Set<string>();

          // Compute usage from session entries
          for (const entry of ctx.sessionManager.getEntries()) {
            // Skip entries we've already counted (prevents double-counting)
            const entryId = (entry as any).id;
            if (entryId && seenEntryIds.has(entryId)) continue;
            if (entryId) seenEntryIds.add(entryId);

            if (entry.type === "usage" && entry.usage) {
              input += entry.usage.input;
              output += entry.usage.output;
              cacheRead += entry.usage.cacheRead ?? 0;
              cacheWrite += entry.usage.cacheWrite ?? 0;
              cost += entry.usage.cost?.total ?? 0;
            } else if (entry.type === "message" && entry.message.role === "assistant") {
              const msg = entry.message as AssistantMessage;
              if (msg.usage) {
                input += msg.usage.input;
                output += msg.usage.output;
                cacheRead += msg.usage.cacheRead ?? 0;
                cacheWrite += msg.usage.cacheWrite ?? 0;
                cost += msg.usage.cost?.total ?? 0;
                const promptTokens = msg.usage.input + (msg.usage.cacheRead ?? 0) + (msg.usage.cacheWrite ?? 0);
                latestCacheHitRate = promptTokens > 0 ? ((msg.usage.cacheRead ?? 0) / promptTokens) * 100 : undefined;
              }
            } else if (entry.type === "message" && (entry.message as any).role === "toolResult" && (entry.message as any).usage) {
              // Tool results can carry their own usage when tools make nested model calls
              // (e.g. guard-destructive LLM classification). Include these in session totals.
              const u = (entry.message as any).usage;
              input += u.input ?? 0;
              output += u.output ?? 0;
              cacheRead += u.cacheRead ?? 0;
              cacheWrite += u.cacheWrite ?? 0;
              cost += u.cost?.total ?? 0;
            }
          }

          // Context window and percent
          const contextUsage = ctx.getContextUsage();
          const contextWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
          const contextPercentValue = contextUsage?.percent ?? 0;
          const contextPercent = contextUsage?.percent !== null && contextUsage?.percent !== undefined
            ? contextPercentValue.toFixed(1)
            : "?";

          // Working directory & branch & session name
          const home = process.env.HOME || process.env.USERPROFILE;
          let pwd = formatCwdForFooter(ctx.sessionManager.getCwd(), home);
          const branch = footerData.getGitBranch();
          if (branch) {
            pwd = `${pwd} (${branch})`;
          }
          const sessionName = pi.getSessionName();
          if (sessionName) {
            pwd = `${pwd} \u2022 ${sessionName}`;
          }

          // Readable grouped stats
          const groups: string[] = [];
          const io: string[] = [];
          if (input) io.push(`in: ${formatTokens(input)}`);
          if (output) io.push(`out: ${formatTokens(output)}`);
          if (io.length > 0) groups.push(io.join(" \u00B7 "));

          const hasCache = cacheRead > 0 || cacheWrite > 0;
          if (hasCache) {
            const cParts: string[] = [];
            if (cacheRead && cacheWrite) {
              cParts.push(`${formatTokens(cacheRead)} read / ${formatTokens(cacheWrite)} write`);
            } else if (cacheRead) {
              cParts.push(`${formatTokens(cacheRead)}`);
            } else if (cacheWrite) {
              cParts.push(`${formatTokens(cacheWrite)} write`);
            }
            const hitRate = latestCacheHitRate !== undefined ? ` (last: ${latestCacheHitRate.toFixed(1)}% hit)` : "";
            groups.push(`cache: ${cParts.join(" ")}${hitRate}`);
          }

          if (cost > 0) {
            groups.push(`$${cost.toFixed(2)}`);
          }

          const contextPercentDisplay = contextPercent === "?"
            ? `ctx: ?/${formatTokens(contextWindow)}`
            : `ctx: ${contextPercent}%/${formatTokens(contextWindow)}`;

          let contextPercentStr: string;
          if (contextPercentValue > 90) {
            contextPercentStr = theme.fg("error", contextPercentDisplay);
          } else if (contextPercentValue > 70) {
            contextPercentStr = theme.fg("warning", contextPercentDisplay);
          } else {
            contextPercentStr = contextPercentDisplay;
          }
          groups.push(contextPercentStr);

          const statsLeft = groups.join(" \u2502 ");
          let statsLeftWidth = visibleWidth(statsLeft);
          let formattedStatsLeft = statsLeft;
          if (statsLeftWidth > width) {
            formattedStatsLeft = truncateToWidth(statsLeft, width, "...");
            statsLeftWidth = visibleWidth(formattedStatsLeft);
          }

          // Model & provider right-side info
          const modelName = ctx.model?.id || "no-model";
          let rightSide = modelName;
          if (ctx.thinkingLevel && ctx.thinkingLevel !== "off") {
            rightSide = `${modelName} \u2022 ${ctx.thinkingLevel}`;
          }

          if (footerData.getAvailableProviderCount() > 1 && ctx.model?.provider) {
            const withProvider = `(${ctx.model.provider}) ${rightSide}`;
            if (statsLeftWidth + 2 + visibleWidth(withProvider) <= width) {
              rightSide = withProvider;
            }
          }

          const rightSideWidth = visibleWidth(rightSide);
          const minPadding = 2;
          let statsLine: string;

          if (statsLeftWidth + minPadding + rightSideWidth <= width) {
            const padding = " ".repeat(width - statsLeftWidth - rightSideWidth);
            statsLine = formattedStatsLeft + padding + rightSide;
          } else {
            const availableForRight = width - statsLeftWidth - minPadding;
            if (availableForRight > 0) {
              const truncatedRight = truncateToWidth(rightSide, availableForRight, "");
              const padding = " ".repeat(Math.max(0, width - statsLeftWidth - visibleWidth(truncatedRight)));
              statsLine = formattedStatsLeft + padding + truncatedRight;
            } else {
              statsLine = formattedStatsLeft;
            }
          }

          const dimStatsLeft = theme.fg("dim", formattedStatsLeft);
          const remainder = statsLine.slice(formattedStatsLeft.length);
          const dimRemainder = theme.fg("dim", remainder);

          const lines: string[] = [
            truncateToWidth(theme.fg("dim", pwd), width, theme.fg("dim", "...")),
            dimStatsLeft + dimRemainder,
          ];

          const extensionStatuses = footerData.getExtensionStatuses();
          if (extensionStatuses.size > 0) {
            const statusLine = Array.from(extensionStatuses.entries())
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([, t]) => sanitizeStatusText(t))
              .join(" ");
            lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "...")));
          }

          return lines;
        },
      };
    });
  });
}
