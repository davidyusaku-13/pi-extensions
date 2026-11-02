import type { ExtensionAPI, ExtensionContext, SessionCompactEvent } from "@earendil-works/pi-coding-agent";
import type { UserMessage } from "@earendil-works/pi-ai";

/**
 * auto-title — Automatically generates a concise session title using the currently active model.
 *
 * Behavior:
 * - Triggers on `agent_settled` after the first user/assistant exchange.
 * - Triggers on `session_compact` (after `/compact` or automatic compaction) to update the title
 *   to match the latest milestone/scope using the compaction summary.
 * - Provides a `/autoname` command to manually generate or refresh the title at any time.
 * - Always runs silently in the background on automatic events.
 */

const TITLE_SYSTEM_PROMPT = `You are a concise title generator.
Generate a short, descriptive title (2 to 5 words) that summarizes the core topic or task of this conversation.
Rules:
- Title Case.
- Do NOT use quotation marks, punctuation, or trailing periods.
- Do NOT include prefixes like "Title:", "Summary:", or "Subject:".
- Output ONLY the title itself.`;

function cleanTitle(raw: string): string {
  let title = raw.trim();
  title = title.replace(/^```[a-z]*\s*|\s*```$/gi, "");
  // Strip all leading/trailing quotes, backticks, asterisks, brackets, and whitespace
  title = title.replace(/^[\s"'`*\[\]()]+|[\s"'`*\[\]()]+$/g, "");
  title = title.replace(/^(Title|Summary|Subject)\s*:\s*/i, "");
  title = title.replace(/[.\r\n]+$/g, "").trim();
  title = title.replace(/^[\s"'`*\[\]()]+|[\s"'`*\[\]()]+$/g, "").trim();
  return title;
}

function getMessageText(msg: any): string {
  if (!msg) return "";
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n");
  }
  return "";
}

/** Maximum number of user/assistant exchanges to use for title generation. */
const MAX_DIALOGUE_EXCHANGES = 10;
/** Maximum total character length for the dialogue sent to the LLM. */
const MAX_DIALOGUE_CHARS = 6000;

/**
 * Builds a clean dialogue transcript of user and assistant messages.
 * Skips raw tool call results or execution dumps so only conversational context is evaluated.
 * Limits output to the last MAX_DIALOGUE_EXCHANGES exchanges and MAX_DIALOGUE_CHARS total
 * to keep the title prompt lean and token-efficient.
 */
function extractConversationDialogue(branch: any[]): string {
  const dialogueLines: string[] = [];

  for (const entry of branch) {
    if (entry.type === "message" && entry.message) {
      const msg = entry.message;
      const role = msg.role;
      if (role !== "user" && role !== "assistant") continue;

      let text = getMessageText(msg).trim();
      if (!text) continue;

      // Cap single abnormally huge messages (e.g. pasted logs/code) to keep processing swift
      if (text.length > 2000) {
        text = text.slice(0, 2000) + "... [truncated]";
      }

      dialogueLines.push(`${role === "user" ? "User" : "Assistant"}: ${text}`);
    }
  }

  // Keep only the most recent exchanges for relevance and token efficiency
  const recent = dialogueLines.slice(-MAX_DIALOGUE_EXCHANGES);
  let result = recent.join("\n\n");

  // Hard cap on total characters to prevent oversized prompts
  if (result.length > MAX_DIALOGUE_CHARS) {
    result = result.slice(-MAX_DIALOGUE_CHARS);
    // Trim to the start of the next complete line to avoid partial messages
    const firstNewline = result.indexOf("\n");
    if (firstNewline > 0) {
      result = result.slice(firstNewline + 1);
    }
  }

  return result;
}

export default function (pi: ExtensionAPI) {
  let isGenerating = false;
  let attemptedInitialTitle = false;
  let lastNamedLeafId: string | null = null;
  let lastNamedAt = 0;

  pi.on("session_start", () => {
    attemptedInitialTitle = false;
    lastNamedLeafId = null;
    lastNamedAt = 0;
  });

  async function generateTitleFromText(text: string, ctx: ExtensionContext): Promise<string | undefined> {
    if (isGenerating || !ctx.model || !text.trim()) return;

    isGenerating = true;
    try {
      const userMessage: UserMessage = {
        role: "user",
        content: [
          {
            type: "text",
            text: `Based on the context below, generate a short 2 to 5 word title summarizing the overall topic or task:\n\n${text}`,
          },
        ],
        timestamp: Date.now(),
      };

      const response = await ctx.modelRegistry.complete(
        ctx.model,
        {
          systemPrompt: TITLE_SYSTEM_PROMPT,
          messages: [userMessage],
        },
        {
          maxTokens: 30,
          signal: ctx.signal,
        }
      );

      if (response.stopReason === "aborted" || response.stopReason === "error") {
        return;
      }

      const rawContent = response.content
        .filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join("")
        .trim();

      const finalTitle = cleanTitle(rawContent);

      if (finalTitle) {
        pi.setSessionName(finalTitle);
        lastNamedLeafId = ctx.sessionManager.getLeafId();
        lastNamedAt = Date.now();
        return finalTitle;
      }
    } catch {
      // Silently ignore background errors
    } finally {
      isGenerating = false;
    }
  }

  // 1. Automatic title generation on first turn settled
  pi.on("agent_settled", async (_event, ctx) => {
    // Only trigger automatically if session has no name yet and hasn't attempted yet
    if (!pi.getSessionName() && !attemptedInitialTitle) {
      attemptedInitialTitle = true;
      const branch = ctx.sessionManager.getBranch();
      const dialogue = extractConversationDialogue(branch);
      if (dialogue) {
        await generateTitleFromText(dialogue, ctx);
      }
    }
  });

  // 2. Automatic title update when session is compacted (/compact or auto-compaction)
  pi.on("session_compact", async (event: SessionCompactEvent, ctx) => {
    // Use the compaction summary directly if available, as it is already an authoritative distillation
    const summary = event.compactionEntry?.summary;
    if (summary) {
      await generateTitleFromText(`Compacted Session Summary:\n${summary}`, ctx);
    } else {
      // Fallback: extract latest branch dialogue
      const branch = ctx.sessionManager.getBranch();
      const dialogue = extractConversationDialogue(branch);
      if (dialogue) {
        await generateTitleFromText(dialogue, ctx);
      }
    }
  });

  // 3. Manual command to generate or refresh title on demand
  pi.registerCommand("autoname", {
    description: "Generate or update session title taking the full conversation into account",
    handler: async (args, ctx) => {
      if (!ctx.model) {
        if (ctx.hasUI) ctx.ui.notify("No model selected", "error");
        return;
      }

      const currentLeafId = ctx.sessionManager.getLeafId();
      const currentTitle = pi.getSessionName();
      const forceRefresh = args?.trim() === "force" || args?.trim() === "-f";

      // If no new turns have been added and a title is already set, skip the LLM call to save tokens
      if (!forceRefresh && currentTitle && lastNamedLeafId && currentLeafId === lastNamedLeafId) {
        if (ctx.hasUI) {
          ctx.ui.notify(`Conversation unchanged; title is current: "${currentTitle}"`, "info");
        }
        return;
      }

      // Throttle rapid repeated invocations (5 second debounce)
      const now = Date.now();
      if (!forceRefresh && now - lastNamedAt < 5000) {
        if (ctx.hasUI) {
          ctx.ui.notify("Please wait a moment before requesting another title refresh", "warning");
        }
        return;
      }

      const branch = ctx.sessionManager.getBranch();
      const dialogue = extractConversationDialogue(branch);
      if (!dialogue) {
        if (ctx.hasUI) ctx.ui.notify("No conversation messages found to summarize", "warning");
        return;
      }

      const title = await generateTitleFromText(dialogue, ctx);
      if (title && ctx.hasUI) {
        ctx.ui.notify(`Session title updated: ${title}`, "info");
      }
    },
  });
}
