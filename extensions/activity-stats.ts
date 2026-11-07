import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem, Component } from "@earendil-works/pi-tui";
import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * activity-stats — Displays comprehensive activity metrics, peak active hours,
 * 24-hour histograms, weekly habits, and session metrics for Pi.
 *
 * Slash commands:
 *   /stats [all|week|today|month|session]
 *   /activity (alias)
 */

type TabType = "all" | "week" | "today" | "month" | "session";

const TABS: Array<{ id: TabType; label: string; shortcut: string }> = [
  { id: "all", label: "All Time", shortcut: "1" },
  { id: "week", label: "Past 7 Days", shortcut: "2" },
  { id: "today", label: "Today", shortcut: "3" },
  { id: "month", label: "Past 30 Days", shortcut: "4" },
  { id: "session", label: "Current Session", shortcut: "5" },
];

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

interface AggregateStats {
  tab: TabType;
  totalSessions: number;
  userMsgs: number;
  assistantMsgs: number;
  toolResults: number;
  earliest: Date | null;
  latest: Date | null;
  hourCounts: number[];
  dayCounts: number[];
  timezone: string;
  tzOffsetHours: number;
}

interface CurrentSessionStats {
  id: string;
  name?: string;
  cwd: string;
  userMsgs: number;
  assistantMsgs: number;
  toolResults: number;
  totalEntries: number;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  startTime: Date | null;
  endTime: Date | null;
  durationMs: number;
  modelId?: string;
  thinkingLevel?: string;
}

function resolveSessionsDir(ctx?: ExtensionCommandContext): string {
  if (process.env.PI_CODING_AGENT_SESSION_DIR) {
    return process.env.PI_CODING_AGENT_SESSION_DIR;
  }
  const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  return join(agentDir, "sessions");
}

function collectAggregateStats(sessionsDir: string, tab: TabType): AggregateStats {
  const now = Date.now();
  let minTime = 0;

  if (tab === "today") {
    const today = new Date();
    minTime = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  } else if (tab === "week") {
    minTime = now - 7 * 86400000;
  } else if (tab === "month") {
    minTime = now - 30 * 86400000;
  }

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const tzOffsetHours = -new Date().getTimezoneOffset() / 60;

  const stats: AggregateStats = {
    tab,
    totalSessions: 0,
    userMsgs: 0,
    assistantMsgs: 0,
    toolResults: 0,
    earliest: null,
    latest: null,
    hourCounts: new Array(24).fill(0),
    dayCounts: new Array(7).fill(0),
    timezone: tz,
    tzOffsetHours,
  };

  if (!existsSync(sessionsDir)) {
    return stats;
  }

  function traverse(dir: string) {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          traverse(full);
        } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          if (minTime > 0) {
            try {
              const stat = statSync(full);
              if (stat.mtimeMs < minTime) continue;
            } catch {
              // Ignore access issues and proceed
            }
          }
          processFile(full);
        }
      }
    } catch {
      // Ignore unreadable directories
    }
  }

  function processFile(file: string) {
    let fileContributed = false;
    try {
      const content = readFileSync(file, "utf8");
      const lines = content.split("\n");

      for (const line of lines) {
        if (!line) continue;
        const isUser = line.includes('"role":"user"');
        const isAsst = line.includes('"role":"assistant"');
        const isTool = line.includes('"role":"toolResult"');

        if (!isUser && !isAsst && !isTool) continue;

        try {
          const obj = JSON.parse(line);
          const ts = obj.timestamp || obj.message?.timestamp;
          let d: Date | null = null;
          let timeMs = 0;

          if (ts) {
            d = new Date(ts);
            timeMs = d.getTime();
          }

          if (minTime > 0 && timeMs && timeMs < minTime) continue;

          if (d && !isNaN(timeMs)) {
            if (!stats.earliest || d < stats.earliest) stats.earliest = d;
            if (!stats.latest || d > stats.latest) stats.latest = d;
          }

          if (obj.type === "message") {
            const role = obj.message?.role;
            if (role === "user") {
              stats.userMsgs++;
              fileContributed = true;
              if (d && !isNaN(timeMs)) {
                stats.hourCounts[d.getHours()]++;
                stats.dayCounts[d.getDay()]++;
              }
            } else if (role === "assistant") {
              stats.assistantMsgs++;
            } else if (role === "toolResult") {
              stats.toolResults++;
            }
          }
        } catch {
          // Skip malformed lines
        }
      }
    } catch {
      // Skip unreadable files
    }

    if (fileContributed) {
      stats.totalSessions++;
    }
  }

  traverse(sessionsDir);
  return stats;
}

function collectCurrentSessionStats(ctx: ExtensionCommandContext): CurrentSessionStats {
  const entries = ctx.sessionManager.getEntries();
  let userMsgs = 0;
  let assistantMsgs = 0;
  let toolResults = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let cost = 0;
  let startTime: Date | null = null;
  let endTime: Date | null = null;
  let modelId: string | undefined;
  let thinkingLevel: string | undefined;

  const seenIds = new Set<string>();

  for (const entry of entries) {
    const entryId = (entry as any).id;
    if (entryId && seenIds.has(entryId)) continue;
    if (entryId) seenIds.add(entryId);

    if ((entry as any).timestamp) {
      const d = new Date((entry as any).timestamp);
      if (!isNaN(d.getTime())) {
        if (!startTime || d < startTime) startTime = d;
        if (!endTime || d > endTime) endTime = d;
      }
    }

    if (entry.type === "model_change") {
      modelId = (entry as any).modelId;
    } else if (entry.type === "thinking_level_change") {
      thinkingLevel = (entry as any).thinkingLevel;
    } else if (entry.type === "usage" && (entry as any).usage) {
      const u = (entry as any).usage;
      inputTokens += u.input ?? 0;
      outputTokens += u.output ?? 0;
      cacheRead += u.cacheRead ?? 0;
      cacheWrite += u.cacheWrite ?? 0;
      cost += u.cost?.total ?? 0;
    } else if (entry.type === "message") {
      const role = entry.message?.role;
      if (role === "user") {
        userMsgs++;
      } else if (role === "assistant") {
        assistantMsgs++;
        const msg = entry.message as any;
        if (msg.usage) {
          inputTokens += msg.usage.input ?? 0;
          outputTokens += msg.usage.output ?? 0;
          cacheRead += msg.usage.cacheRead ?? 0;
          cacheWrite += msg.usage.cacheWrite ?? 0;
          cost += msg.usage.cost?.total ?? 0;
        }
      } else if (role === "toolResult") {
        toolResults++;
        const msg = entry.message as any;
        if (msg.usage) {
          inputTokens += msg.usage.input ?? 0;
          outputTokens += msg.usage.output ?? 0;
          cacheRead += msg.usage.cacheRead ?? 0;
          cacheWrite += msg.usage.cacheWrite ?? 0;
          cost += msg.usage.cost?.total ?? 0;
        }
      }
    }
  }

  const durationMs = startTime && endTime ? Math.max(0, endTime.getTime() - startTime.getTime()) : 0;

  return {
    id: ctx.sessionManager.getSessionId?.() ?? "unknown",
    name: ctx.sessionManager.getSessionName?.() ?? undefined,
    cwd: ctx.cwd,
    userMsgs,
    assistantMsgs,
    toolResults,
    totalEntries: entries.length,
    inputTokens,
    outputTokens,
    cacheRead,
    cacheWrite,
    cost,
    startTime,
    endTime,
    durationMs,
    modelId,
    thinkingLevel,
  };
}

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

function formatCost(cost: number): string {
  if (cost === 0) return "$0.00";
  if (cost < 0.01) return `<$0.01 (${cost.toFixed(4)})`;
  return `$${cost.toFixed(2)}`;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function makeBar(count: number, max: number, maxBarWidth: number): string {
  if (max === 0 || count === 0) return "";
  const len = Math.max(1, Math.round((count / max) * maxBarWidth));
  return "█".repeat(len);
}

class ActivityStatsComponent implements Component {
  readonly capturesViewportInput: boolean = true;
  private sessionsDir: string;
  private ctx: ExtensionCommandContext;
  private tui: { requestRender: () => void };
  private theme: Theme;
  private onClose: () => void;
  private activeTab: TabType;
  private scrollOffset = 0;
  private cachedTabStats = new Map<TabType, AggregateStats>();
  private cachedSessionStats: CurrentSessionStats | null = null;
  private cachedWidth?: number;
  private cachedLines?: string[];

  constructor(
    sessionsDir: string,
    ctx: ExtensionCommandContext,
    tui: { requestRender: () => void },
    theme: Theme,
    onClose: () => void,
    initialTab: TabType = "all",
  ) {
    this.sessionsDir = sessionsDir;
    this.ctx = ctx;
    this.tui = tui;
    this.theme = theme;
    this.onClose = onClose;
    this.activeTab = initialTab;
  }

  private getAggregateData(tab: TabType): AggregateStats {
    if (!this.cachedTabStats.has(tab)) {
      this.cachedTabStats.set(tab, collectAggregateStats(this.sessionsDir, tab));
    }
    return this.cachedTabStats.get(tab)!;
  }

  private getSessionData(): CurrentSessionStats {
    if (!this.cachedSessionStats) {
      this.cachedSessionStats = collectCurrentSessionStats(this.ctx);
    }
    return this.cachedSessionStats;
  }

  private cycleTab(direction = 1): void {
    const currentIndex = TABS.findIndex((t) => t.id === this.activeTab);
    const nextIndex = (currentIndex + direction + TABS.length) % TABS.length;
    this.activeTab = TABS[nextIndex].id;
    this.scrollOffset = 0;
    this.invalidate();
  }

  private setTab(tab: TabType): void {
    if (this.activeTab !== tab) {
      this.activeTab = tab;
      this.scrollOffset = 0;
      this.invalidate();
    }
  }

  handleInput(data: string): void {
    if (
      matchesKey(data, "escape") ||
      matchesKey(data, "enter") ||
      data === "q" ||
      matchesKey(data, "ctrl+c")
    ) {
      this.onClose();
      return;
    }

    if (matchesKey(data, "tab")) {
      this.cycleTab(1);
      this.tui.requestRender();
      return;
    }

    if (matchesKey(data, "shift+tab")) {
      this.cycleTab(-1);
      this.tui.requestRender();
      return;
    }

    // Number shortcuts to switch tabs
    for (const tab of TABS) {
      if (data === tab.shortcut) {
        this.setTab(tab.id);
        this.tui.requestRender();
        return;
      }
    }

    if (matchesKey(data, "up") || data === "k") {
      if (this.scrollOffset > 0) {
        this.scrollOffset--;
        this.invalidate();
        this.tui.requestRender();
      }
      return;
    }

    if (matchesKey(data, "down") || data === "j") {
      this.scrollOffset++;
      this.invalidate();
      this.tui.requestRender();
      return;
    }

    if (matchesKey(data, "pageup")) {
      if (this.scrollOffset > 0) {
        this.scrollOffset = Math.max(0, this.scrollOffset - 10);
        this.invalidate();
        this.tui.requestRender();
      }
      return;
    }

    if (matchesKey(data, "pagedown")) {
      this.scrollOffset += 10;
      this.invalidate();
      this.tui.requestRender();
      return;
    }

    if (matchesKey(data, "home")) {
      this.scrollOffset = 0;
      this.invalidate();
      this.tui.requestRender();
      return;
    }

    if (matchesKey(data, "end")) {
      this.scrollOffset = 999999;
      this.invalidate();
      this.tui.requestRender();
      return;
    }
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  private generateAggregateLines(width: number, stats: AggregateStats): string[] {
    const lines: string[] = [];
    const th = this.theme;
    const maxBarWidth = Math.min(32, Math.max(12, width - 42));

    // Summary metadata
    const tzSign = stats.tzOffsetHours >= 0 ? `+${stats.tzOffsetHours}` : `${stats.tzOffsetHours}`;
    const tzString = `${stats.timezone} (GMT${tzSign})`;

    lines.push(
      `  ${th.fg("dim", "Timezone:")} ${th.fg("accent", tzString)}   ${th.fg(
        "dim",
        "Sessions:",
      )} ${th.bold(stats.totalSessions.toLocaleString())}   ${th.fg(
        "dim",
        "Prompts:",
      )} ${th.bold(stats.userMsgs.toLocaleString())}`,
    );

    if (stats.earliest && stats.latest) {
      const eStr = stats.earliest.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      const lStr = stats.latest.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      lines.push(`  ${th.fg("dim", "Activity Range:")} ${eStr} → ${lStr}`);
    }

    lines.push("");

    if (stats.userMsgs === 0) {
      lines.push(`  ${th.fg("warning", "No user messages recorded for this timeframe.")}`);
      return lines;
    }

    // Top Peak Hours
    const sortedHours = stats.hourCounts
      .map((count, hour) => ({ hour, count }))
      .filter((h) => h.count > 0)
      .sort((a, b) => b.count - a.count);

    const maxHourCount = Math.max(...stats.hourCounts, 1);

    lines.push(`  ${th.bold(th.fg("accent", "🏆 Top Peak Hours (Local Time):"))}`);
    const topHoursToShow = sortedHours.slice(0, 5);
    for (let i = 0; i < topHoursToShow.length; i++) {
      const { hour, count } = topHoursToShow[i];
      const hStr = `${String(hour).padStart(2, "0")}:00 – ${String(hour).padStart(2, "0")}:59`;
      const rank = `#${i + 1}`.padEnd(3);
      const bar = makeBar(count, maxHourCount, maxBarWidth);
      lines.push(
        `    ${th.fg("accent", rank)} ${hStr}  ${th.fg("dim", `[${String(count).padStart(4)}]`)}  ${th.fg(
          "accent",
          bar,
        )}`,
      );
    }

    lines.push("");

    // 24-Hour Distribution
    lines.push(`  ${th.bold(th.fg("accent", "📊 24-Hour Activity Distribution:"))}`);
    for (let h = 0; h < 24; h++) {
      const count = stats.hourCounts[h];
      const hStr = `${String(h).padStart(2, "0")}:00`;
      const isTopPeak = topHoursToShow.some((p) => p.hour === h && p.count > 0);
      const bar = makeBar(count, maxHourCount, maxBarWidth);

      const countStr = `[${String(count).padStart(4)}]`;
      const label = isTopPeak ? th.bold(hStr) : th.fg("dim", hStr);
      const barStyled = isTopPeak ? th.fg("accent", th.bold(bar)) : th.fg("text", bar);

      lines.push(`    ${label}  ${th.fg("dim", countStr)}  ${barStyled}`);
    }

    lines.push("");

    // Day of Week Breakdown (skip for today)
    if (stats.tab !== "today") {
      lines.push(`  ${th.bold(th.fg("accent", "📅 By Day of Week:"))}`);
      const maxDayCount = Math.max(...stats.dayCounts, 1);
      // Order starting Monday to Sunday
      const order = [1, 2, 3, 4, 5, 6, 0];
      for (const d of order) {
        const count = stats.dayCounts[d];
        const dayName = DAY_NAMES[d].padEnd(10);
        const bar = makeBar(count, maxDayCount, maxBarWidth);
        lines.push(
          `    ${dayName} ${th.fg("dim", `[${String(count).padStart(4)}]`)}  ${th.fg("accent", bar)}`,
        );
      }
      lines.push("");
    }

    // Routine Habit Windows
    const lateNight =
      stats.hourCounts[0] + stats.hourCounts[1] + stats.hourCounts[2] + stats.hourCounts[3];
    const sleepWindow =
      stats.hourCounts[4] +
      stats.hourCounts[5] +
      stats.hourCounts[6] +
      stats.hourCounts[7] +
      stats.hourCounts[8] +
      stats.hourCounts[9] +
      stats.hourCounts[10];
    const afternoon =
      stats.hourCounts[11] +
      stats.hourCounts[12] +
      stats.hourCounts[13] +
      stats.hourCounts[14] +
      stats.hourCounts[15] +
      stats.hourCounts[16];
    const evening =
      stats.hourCounts[17] +
      stats.hourCounts[18] +
      stats.hourCounts[19] +
      stats.hourCounts[20] +
      stats.hourCounts[21] +
      stats.hourCounts[22] +
      stats.hourCounts[23];

    const total = stats.userMsgs || 1;
    const pct = (n: number) => ((n / total) * 100).toFixed(1);

    lines.push(`  ${th.bold(th.fg("accent", "⏱️ Routine Breakdown:"))}`);
    lines.push(
      `    • ${th.bold("Evening")} (17:00 – 23:59)    : ${evening.toLocaleString()} prompts (${pct(
        evening,
      )}%)`,
    );
    lines.push(
      `    • ${th.bold("Afternoon")} (11:00 – 16:59)  : ${afternoon.toLocaleString()} prompts (${pct(
        afternoon,
      )}%)`,
    );
    lines.push(
      `    • ${th.bold("Late Night")} (00:00 – 03:59) : ${lateNight.toLocaleString()} prompts (${pct(
        lateNight,
      )}%)`,
    );
    lines.push(
      `    • ${th.bold("Sleep/Off")} (04:00 – 10:59)  : ${sleepWindow.toLocaleString()} prompts (${pct(
        sleepWindow,
      )}%)`,
    );

    lines.push("");

    // Totals
    lines.push(`  ${th.bold(th.fg("accent", "💬 Harness Interaction Totals:"))}`);
    lines.push(
      `    ${th.fg("dim", "User Prompts:")} ${th.bold(
        stats.userMsgs.toLocaleString(),
      )}  ·  ${th.fg("dim", "Assistant Turns:")} ${th.bold(
        stats.assistantMsgs.toLocaleString(),
      )}  ·  ${th.fg("dim", "Tool Executions:")} ${th.bold(
        stats.toolResults.toLocaleString(),
      )}`,
    );

    return lines;
  }

  private generateSessionLines(width: number, session: CurrentSessionStats): string[] {
    const lines: string[] = [];
    const th = this.theme;

    lines.push(`  ${th.bold(th.fg("accent", "Current Conversation Details:"))}`);
    if (session.name) {
      lines.push(`  ${th.fg("dim", "Session Title:")} ${th.bold(session.name)}`);
    }
    lines.push(`  ${th.fg("dim", "Session ID:")}    ${th.fg("accent", session.id)}`);
    lines.push(`  ${th.fg("dim", "Workspace:")}     ${session.cwd}`);

    if (session.modelId) {
      const thinkingStr = session.thinkingLevel ? ` (${session.thinkingLevel} thinking)` : "";
      lines.push(`  ${th.fg("dim", "Active Model:")}  ${th.bold(session.modelId)}${thinkingStr}`);
    }

    if (session.startTime) {
      const sStr = session.startTime.toLocaleTimeString("en-US", { hour12: false });
      const durationStr = formatDuration(session.durationMs);
      lines.push(`  ${th.fg("dim", "Started At:")}    ${sStr}  (Active duration: ${durationStr})`);
    }

    lines.push("");

    lines.push(`  ${th.bold(th.fg("accent", "Message & Turn Counts:"))}`);
    lines.push(
      `    User Prompts       : ${th.bold(session.userMsgs.toString())}\n` +
      `    Assistant Turns    : ${th.bold(session.assistantMsgs.toString())}\n` +
      `    Tool Executions    : ${th.bold(session.toolResults.toString())}\n` +
      `    Total Branch Entries: ${th.bold(session.totalEntries.toString())}`,
    );

    lines.push("");

    lines.push(`  ${th.bold(th.fg("accent", "Token & Cost Consumption:"))}`);
    const promptTokens = session.inputTokens + session.cacheRead + session.cacheWrite;
    const cacheHitPct =
      promptTokens > 0 ? ((session.cacheRead / promptTokens) * 100).toFixed(1) : "0.0";

    lines.push(
      `    Input Tokens       : ${formatTokens(session.inputTokens)} (${session.inputTokens.toLocaleString()})\n` +
      `    Output Tokens      : ${formatTokens(session.outputTokens)} (${session.outputTokens.toLocaleString()})\n` +
      `    Cache Read Tokens  : ${formatTokens(session.cacheRead)} (${cacheHitPct}% cache hit rate)\n` +
      `    Cache Write Tokens : ${formatTokens(session.cacheWrite)}\n` +
      `    Estimated Cost     : ${th.bold(th.fg("success", formatCost(session.cost)))}`,
    );

    return lines;
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines;
    }

    const th = this.theme;
    const lines: string[] = [];
    const contentWidth = Math.max(30, width - 2);

    // 1. Title bar
    const titleText = " Pi Activity & Usage Statistics ";
    const leftPad = 2;
    const rightPad = Math.max(0, contentWidth - titleText.length - leftPad);
    lines.push(
      th.fg("border", "┌" + "─".repeat(leftPad)) +
        th.bold(th.fg("accent", titleText)) +
        th.fg("border", "─".repeat(rightPad) + "┐"),
    );

    // 2. Tabs bar
    let tabRow = " ";
    for (const tab of TABS) {
      const isSelected = tab.id === this.activeTab;
      const tabLabel = `[${tab.shortcut}] ${tab.label}`;
      if (isSelected) {
        tabRow += `  ${th.fg("accent", th.bold(`▶ ${tabLabel} ◀`))}`;
      } else {
        tabRow += `   ${th.fg("dim", tabLabel)}`;
      }
    }
    const tabRowPadded = tabRow + " ".repeat(Math.max(0, contentWidth - visibleWidth(tabRow)));
    lines.push(th.fg("border", "│") + truncateToWidth(tabRowPadded, contentWidth) + th.fg("border", "│"));

    // Sub-border
    lines.push(th.fg("border", "├" + "─".repeat(contentWidth) + "┤"));

    // 3. Generate content lines based on active tab
    let innerContent: string[] = [];
    if (this.activeTab === "session") {
      innerContent = this.generateSessionLines(contentWidth, this.getSessionData());
    } else {
      innerContent = this.generateAggregateLines(contentWidth, this.getAggregateData(this.activeTab));
    }

    // Scroll handling
    const terminalHeight = process.stdout.rows || 30;
    const maxVisibleLines = Math.max(8, terminalHeight - 7);
    const maxScroll = Math.max(0, innerContent.length - maxVisibleLines);
    this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, maxScroll));

    const visibleSlice = innerContent.slice(
      this.scrollOffset,
      this.scrollOffset + maxVisibleLines,
    );

    // Fill to keep modal height consistent
    for (const rawLine of visibleSlice) {
      const padded = " " + rawLine;
      const fillLen = Math.max(0, contentWidth - visibleWidth(padded));
      lines.push(
        th.fg("border", "│") +
          truncateToWidth(padded, contentWidth - 1) +
          " ".repeat(fillLen) +
          th.fg("border", "│"),
      );
    }

    if (visibleSlice.length < maxVisibleLines) {
      const emptyCount = maxVisibleLines - visibleSlice.length;
      for (let i = 0; i < emptyCount; i++) {
        lines.push(th.fg("border", "│") + " ".repeat(contentWidth) + th.fg("border", "│"));
      }
    }

    // 4. Bottom footer with scroll & key controls
    lines.push(th.fg("border", "├" + "─".repeat(contentWidth) + "┤"));

    const scrollInfo =
      innerContent.length > maxVisibleLines
        ? ` (${this.scrollOffset + 1}–${Math.min(
            innerContent.length,
            this.scrollOffset + maxVisibleLines,
          )}/${innerContent.length})`
        : "";

    const controls = ` [Tab/1-5] Switch Tab  ·  [↑/↓/PgUp/PgDn] Scroll${scrollInfo}  ·  [Esc/Enter] Close`;
    const controlsPadded =
      controls + " ".repeat(Math.max(0, contentWidth - visibleWidth(controls)));

    lines.push(
      th.fg("border", "│") +
        th.fg("dim", truncateToWidth(controlsPadded, contentWidth)) +
        th.fg("border", "│"),
    );

    lines.push(th.fg("border", "└" + "─".repeat(contentWidth) + "┘"));

    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }
}

function printCliReport(sessionsDir: string, tab: TabType, ctx?: ExtensionCommandContext) {
  if (tab === "session" && ctx) {
    const session = collectCurrentSessionStats(ctx);
    console.log(`\n=== Current Pi Session Statistics ===`);
    if (session.name) console.log(`Title: ${session.name}`);
    console.log(`Session ID: ${session.id}`);
    console.log(`Workspace: ${session.cwd}`);
    if (session.modelId) {
      console.log(`Active Model: ${session.modelId}${session.thinkingLevel ? ` (${session.thinkingLevel})` : ""}`);
    }
    if (session.startTime) {
      console.log(`Started: ${session.startTime.toLocaleTimeString()} | Active Duration: ${formatDuration(session.durationMs)}`);
    }
    console.log("\nMessage & Turn Counts:");
    console.log(`  User Prompts       : ${session.userMsgs}`);
    console.log(`  Assistant Turns    : ${session.assistantMsgs}`);
    console.log(`  Tool Executions    : ${session.toolResults}`);
    console.log(`  Total Entries      : ${session.totalEntries}`);
    console.log("\nTokens & Cost:");
    const promptTokens = session.inputTokens + session.cacheRead + session.cacheWrite;
    const cacheHitPct = promptTokens > 0 ? ((session.cacheRead / promptTokens) * 100).toFixed(1) : "0.0";
    console.log(`  Input Tokens       : ${formatTokens(session.inputTokens)} (${session.inputTokens.toLocaleString()})`);
    console.log(`  Output Tokens      : ${formatTokens(session.outputTokens)} (${session.outputTokens.toLocaleString()})`);
    console.log(`  Cache Read Tokens  : ${formatTokens(session.cacheRead)} (${cacheHitPct}% cache hit rate)`);
    console.log(`  Estimated Cost     : ${formatCost(session.cost)}\n`);
    return;
  }

  const stats = collectAggregateStats(sessionsDir, tab);
  const tzSign = stats.tzOffsetHours >= 0 ? `+${stats.tzOffsetHours}` : `${stats.tzOffsetHours}`;
  console.log(`\n=== Pi Activity & Usage Statistics (${stats.tab.toUpperCase()}) ===`);
  console.log(`Timezone: ${stats.timezone} (GMT${tzSign})`);
  console.log(`Total Sessions: ${stats.totalSessions.toLocaleString()} | User Prompts: ${stats.userMsgs.toLocaleString()}`);
  if (stats.earliest && stats.latest) {
    console.log(`Activity Range: ${stats.earliest.toLocaleDateString()} → ${stats.latest.toLocaleDateString()}`);
  }

  const maxCount = Math.max(...stats.hourCounts, 1);
  const sorted = stats.hourCounts
    .map((c, h) => ({ h, c }))
    .filter((x) => x.c > 0)
    .sort((a, b) => b.c - a.c);

  console.log("\n🏆 Top Peak Hours (Local Time):");
  sorted.slice(0, 5).forEach((p, i) => {
    console.log(`  #${i + 1}  ${String(p.h).padStart(2, "0")}:00 – ${String(p.h).padStart(2, "0")}:59 : ${String(p.c).padStart(4)} | ${makeBar(p.c, maxCount, 30)}`);
  });

  console.log("\n📊 24-Hour Distribution:");
  stats.hourCounts.forEach((c, h) => {
    console.log(`  ${String(h).padStart(2, "0")}:00 : ${String(c).padStart(4)} | ${makeBar(c, maxCount, 30)}`);
  });

  if (stats.tab !== "today") {
    console.log("\n📅 By Day of Week:");
    const maxDay = Math.max(...stats.dayCounts, 1);
    [1, 2, 3, 4, 5, 6, 0].forEach((d) => {
      console.log(`  ${DAY_NAMES[d].padEnd(10)}: ${String(stats.dayCounts[d]).padStart(4)} | ${makeBar(stats.dayCounts[d], maxDay, 30)}`);
    });
  }

  const lateNight = stats.hourCounts[0] + stats.hourCounts[1] + stats.hourCounts[2] + stats.hourCounts[3];
  const sleepWindow = stats.hourCounts[4] + stats.hourCounts[5] + stats.hourCounts[6] + stats.hourCounts[7] + stats.hourCounts[8] + stats.hourCounts[9] + stats.hourCounts[10];
  const afternoon = stats.hourCounts[11] + stats.hourCounts[12] + stats.hourCounts[13] + stats.hourCounts[14] + stats.hourCounts[15] + stats.hourCounts[16];
  const evening = stats.hourCounts[17] + stats.hourCounts[18] + stats.hourCounts[19] + stats.hourCounts[20] + stats.hourCounts[21] + stats.hourCounts[22] + stats.hourCounts[23];
  const total = stats.userMsgs || 1;
  const pct = (n: number) => ((n / total) * 100).toFixed(1);

  console.log("\n⏱️ Routine Breakdown:");
  console.log(`  • Evening (17:00 – 23:59)   : ${evening.toLocaleString()} prompts (${pct(evening)}%)`);
  console.log(`  • Afternoon (11:00 – 16:59) : ${afternoon.toLocaleString()} prompts (${pct(afternoon)}%)`);
  console.log(`  • Late Night (00:00 – 03:59): ${lateNight.toLocaleString()} prompts (${pct(lateNight)}%)`);
  console.log(`  • Sleep/Off (04:00 – 10:59) : ${sleepWindow.toLocaleString()} prompts (${pct(sleepWindow)}%)`);

  console.log("\n💬 Harness Interaction Totals:");
  console.log(`  User Prompts: ${stats.userMsgs.toLocaleString()} | Assistant Turns: ${stats.assistantMsgs.toLocaleString()} | Tool Calls: ${stats.toolResults.toLocaleString()}\n`);
}

export default function activityStatsExtension(pi: ExtensionAPI) {
  const parseTab = (raw: string): TabType => {
    const val = raw.trim().toLowerCase();
    if (val === "today") return "today";
    if (val === "week" || val === "7d") return "week";
    if (val === "month" || val === "30d") return "month";
    if (val === "session" || val === "current") return "session";
    return "all";
  };

  const handler = async (args: string, ctx: ExtensionCommandContext) => {
    const initialTab = parseTab(args);
    const sessionsDir = resolveSessionsDir(ctx);

    if (!ctx.hasUI || ctx.mode !== "tui") {
      printCliReport(sessionsDir, initialTab, ctx);
      return;
    }

    await ctx.ui.custom<void>((tui, theme, _kb, done) => {
      return new ActivityStatsComponent(sessionsDir, ctx, tui, theme, () => done(), initialTab);
    });
  };

  // Allow /stats to work in non-interactive print mode as well
  pi.on("input", async (event, ctx) => {
    const text = event.text.trim();
    if (
      text === "/stats" ||
      text.startsWith("/stats ") ||
      text === "/activity" ||
      text.startsWith("/activity ") ||
      text === "//stats" ||
      text.startsWith("//stats ")
    ) {
      const args = text.replace(/^\/+?(stats|activity)\s*/, "");
      const sessionsDir = resolveSessionsDir();

      if (!ctx.hasUI || ctx.mode !== "tui") {
        const tab = parseTab(args);
        printCliReport(sessionsDir, tab);
        return { action: "handled" };
      }

      // If interactive, let registerCommand handle it
      return { action: "continue" };
    }

    return { action: "continue" };
  });

  pi.registerCommand("stats", {
    description: "Display Pi usage, active hours, and session statistics",
    getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
      const items: AutocompleteItem[] = [
        { value: "all", label: "all", description: "Lifetime activity & peak hours" },
        { value: "week", label: "week", description: "Activity over the past 7 days" },
        { value: "today", label: "today", description: "Activity today since midnight" },
        { value: "month", label: "month", description: "Activity over the past 30 days" },
        { value: "session", label: "session", description: "Current active session metrics & token usage" },
      ];
      const filtered = items.filter((i) => i.value.startsWith(prefix.toLowerCase()));
      return filtered.length > 0 ? filtered : null;
    },
    handler,
  });

  pi.registerCommand("activity", {
    description: "Alias for /stats",
    getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
      const items: AutocompleteItem[] = [
        { value: "all", label: "all", description: "Lifetime activity & peak hours" },
        { value: "week", label: "week", description: "Activity over the past 7 days" },
        { value: "today", label: "today", description: "Activity today since midnight" },
        { value: "month", label: "month", description: "Activity over the past 30 days" },
        { value: "session", label: "session", description: "Current active session metrics & token usage" },
      ];
      const filtered = items.filter((i) => i.value.startsWith(prefix.toLowerCase()));
      return filtered.length > 0 ? filtered : null;
    },
    handler,
  });
}
