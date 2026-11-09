import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

/**
 * dynamic-compaction — Automatically triggers compaction when context usage reaches a percentage threshold.
 *
 * Default threshold is 40% of the active model's context window, triggered cleanly when the agent
 * is idle (agent_settled) so multi-step tool workflows are not interrupted mid-task.
 * An emergency ceiling (85%) triggers mid-task during turn_end if massive tool outputs threaten overflow.
 * Configurable via /compact-threshold <number>.
 */

const DEFAULT_TARGET_PERCENT = 40;
const EMERGENCY_THRESHOLD_PERCENT = 85;

export default function (pi: ExtensionAPI) {
  let targetPercent = DEFAULT_TARGET_PERCENT;
  let isCompacting = false;
  let lastCompactedTokens: number | null = null;

  const triggerDynamicCompaction = (
    ctx: ExtensionContext,
    shouldResume = false,
    isEmergency = false
  ) => {
    if (isCompacting) return;
    isCompacting = true;

    const usage = ctx.getContextUsage();
    const currentPercent = usage?.percent != null ? usage.percent.toFixed(1) : "unknown";

    if (ctx.hasUI) {
      const message = isEmergency
        ? `Emergency context usage ${currentPercent}% (ceiling: ${EMERGENCY_THRESHOLD_PERCENT}%) — compacting mid-task...`
        : `Context reached ${currentPercent}% (threshold: ${targetPercent}%) — compacting...`;
      ctx.ui.notify(message, isEmergency ? "warning" : "info");
    }

    ctx.compact({
      onComplete: () => {
        isCompacting = false;
        const newUsage = ctx.getContextUsage();
        lastCompactedTokens = newUsage?.tokens ?? null;

        if (shouldResume) {
          if (ctx.hasUI) {
            ctx.ui.notify("Dynamic compaction completed — resuming...", "info");
          }
          // Delay briefly to allow the runtime to settle before prompting
          setTimeout(() => {
            pi.sendUserMessage("continue");
          }, 150);
        } else {
          if (ctx.hasUI) {
            ctx.ui.notify("Dynamic compaction completed", "info");
          }
        }
      },
      onError: (error) => {
        isCompacting = false;
        if (ctx.hasUI) {
          ctx.ui.notify(`Dynamic compaction failed: ${error.message}`, "error");
        }
      },
    });
  };

  // 1. Clean idle compaction: runs after all multi-tool turns complete and the agent settles
  pi.on("agent_settled", (event, ctx) => {
    if (isCompacting || event.aborted) return;

    const usage = ctx.getContextUsage();
    if (!usage || usage.percent == null) return;

    // Guard: avoid re-triggering if token count has not grown past the last post-compaction count
    if (lastCompactedTokens != null && usage.tokens != null && usage.tokens <= lastCompactedTokens) {
      return;
    }

    if (usage.percent >= targetPercent) {
      triggerDynamicCompaction(ctx, false, false);
    }
  });

  // 2. Emergency mid-task safety valve: triggers only if a tool output spikes context near the limit
  pi.on("turn_end", (event, ctx) => {
    if (isCompacting) return;

    const usage = ctx.getContextUsage();
    if (!usage || usage.percent == null) return;

    // Guard: avoid re-triggering if token count has not grown past the last post-compaction count
    if (lastCompactedTokens != null && usage.tokens != null && usage.tokens <= lastCompactedTokens) {
      return;
    }

    const emergencyThreshold = Math.max(EMERGENCY_THRESHOLD_PERCENT, targetPercent);
    if (usage.percent >= emergencyThreshold) {
      const shouldResume = Boolean(event.continue || (event.toolResults && event.toolResults.length > 0));
      triggerDynamicCompaction(ctx, shouldResume, true);
    }
  });

  pi.on("session_compact", () => {
    isCompacting = false;
  });

  pi.on("session_compact_failed", () => {
    isCompacting = false;
  });

  pi.on("session_start", () => {
    lastCompactedTokens = null;
    isCompacting = false;
  });

  pi.on("session_switch", () => {
    lastCompactedTokens = null;
    isCompacting = false;
  });

  pi.registerCommand("compact-threshold", {
    description: "View or set the dynamic auto-compaction percentage threshold (default: 40%)",
    handler: async (args, ctx) => {
      const trimmed = args.trim();
      if (trimmed) {
        const val = parseFloat(trimmed);
        if (isNaN(val) || val <= 5 || val >= 95) {
          if (ctx.hasUI) {
            ctx.ui.notify("Please specify a threshold between 5% and 95%", "warning");
          }
          return;
        }
        targetPercent = Math.round(val);
        if (ctx.hasUI) {
          ctx.ui.notify(
            `Compaction threshold updated to ${targetPercent}% (idle trigger; ${EMERGENCY_THRESHOLD_PERCENT}% emergency ceiling)`,
            "info"
          );
        }
        return;
      }

      const usage = ctx.getContextUsage();
      const current = usage?.percent != null ? `${usage.percent.toFixed(1)}%` : "unknown";
      const tokens = usage?.tokens != null ? `${Math.round(usage.tokens / 1000)}k` : "unknown";
      const window = usage?.contextWindow != null ? `${Math.round(usage.contextWindow / 1000)}k` : "unknown";

      if (ctx.hasUI) {
        ctx.ui.notify(
          `Context: ${current} (${tokens} / ${window} tokens) | Compaction threshold: ${targetPercent}% (idle), emergency: ${EMERGENCY_THRESHOLD_PERCENT}%`,
          "info"
        );
      }
    },
  });
}
