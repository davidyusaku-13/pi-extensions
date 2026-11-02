import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

/**
 * dynamic-compaction — Automatically triggers compaction when context usage reaches a percentage threshold.
 *
 * Default threshold is 40% of the active model's context window.
 * Configurable via /compact-threshold <number> or options.
 */

const DEFAULT_TARGET_PERCENT = 40;

export default function (pi: ExtensionAPI) {
  let targetPercent = DEFAULT_TARGET_PERCENT;
  let isCompacting = false;
  let lastCompactedTokens: number | null = null;

  const triggerDynamicCompaction = (ctx: ExtensionContext) => {
    if (isCompacting) return;
    isCompacting = true;

    const usage = ctx.getContextUsage();
    const currentPercent = usage?.percent != null ? usage.percent.toFixed(1) : "unknown";

    if (ctx.hasUI) {
      ctx.ui.notify(`Context reached ${currentPercent}% (threshold: ${targetPercent}%) — compacting...`, "info");
    }

    ctx.compact({
      onComplete: () => {
        isCompacting = false;
        const newUsage = ctx.getContextUsage();
        lastCompactedTokens = newUsage?.tokens ?? null;
        if (ctx.hasUI) {
          ctx.ui.notify("Dynamic compaction completed", "info");
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

  pi.on("turn_end", (_event, ctx) => {
    if (isCompacting) return;

    const usage = ctx.getContextUsage();
    if (!usage || usage.percent == null) return;

    // Guard: avoid re-triggering if token count has not grown past the last post-compaction count
    if (lastCompactedTokens != null && usage.tokens != null && usage.tokens <= lastCompactedTokens) {
      return;
    }

    if (usage.percent >= targetPercent) {
      triggerDynamicCompaction(ctx);
    }
  });

  pi.on("session_compact", () => {
    isCompacting = false;
  });

  pi.on("session_compact_failed", () => {
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
          ctx.ui.notify(`Compaction threshold updated to ${targetPercent}%`, "info");
        }
        return;
      }

      const usage = ctx.getContextUsage();
      const current = usage?.percent != null ? `${usage.percent.toFixed(1)}%` : "unknown";
      const tokens = usage?.tokens != null ? `${Math.round(usage.tokens / 1000)}k` : "unknown";
      const window = usage?.contextWindow != null ? `${Math.round(usage.contextWindow / 1000)}k` : "unknown";

      if (ctx.hasUI) {
        ctx.ui.notify(
          `Context: ${current} (${tokens} / ${window} tokens) | Compaction threshold: ${targetPercent}%`,
          "info"
        );
      }
    },
  });
}
