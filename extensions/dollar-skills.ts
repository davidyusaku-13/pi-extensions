import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type AutocompleteItem, type AutocompleteProvider, type AutocompleteSuggestions, fuzzyFilter } from "@earendil-works/pi-tui";

/**
 * dollar-skills — Allows invoking Pi skills using the "$skill-name" syntax.
 *
 * Examples:
 *   $shadcn add button          -> /skill:shadcn add button
 *   $computer-use open terminal -> /skill:computer-use open terminal
 *
 * Also registers a TUI autocomplete provider so typing "$" presents all available skills.
 */

interface SkillMeta {
  name: string;
  description?: string;
}

export default function (pi: ExtensionAPI) {
  // 1. Intercept user input and transform "$skill-name <args>" into "/skill:skill-name <args>"
  pi.on("input", async (event) => {
    if (event.source === "extension") {
      return { action: "continue" };
    }

    const text = event.text.trimStart();
    // Match leading $skill-name followed by space, end of string, or newline
    const match = text.match(/^\$([a-zA-Z0-9_-]+)(?:\s+(.*)|$)/s);
    if (!match) {
      return { action: "continue" };
    }

    const skillName = match[1];
    const rest = match[2] ? match[2].trim() : "";
    const transformed = rest ? `/skill:${skillName} ${rest}` : `/skill:${skillName}`;

    return {
      action: "transform",
      text: transformed,
      images: event.images,
    };
  });

  // 2. Register TUI Autocomplete provider for $
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI || typeof ctx.ui.addAutocompleteProvider !== "function") return;

    ctx.ui.addAutocompleteProvider((current: AutocompleteProvider): AutocompleteProvider => {
      return {
        async getSuggestions(lines, cursorLine, cursorCol, options): Promise<AutocompleteSuggestions | null> {
          const currentLine = lines[cursorLine] ?? "";
          const textBeforeCursor = currentLine.slice(0, cursorCol);

          // Trigger autocomplete when token starts with $
          const match = textBeforeCursor.match(/(?:^|[\s])\$([a-zA-Z0-9_-]*)$/);
          if (!match) {
            return current.getSuggestions(lines, cursorLine, cursorCol, options);
          }

          const query = match[1];

          // Fetch registered skills via pi.getCommands()
          const allCommands = pi.getCommands();
          const skills: SkillMeta[] = allCommands
            .filter((c) => c.name.startsWith("skill:"))
            .map((c) => ({
              name: c.name.slice(6),
              description: c.description,
            }));

          if (skills.length === 0 || options.signal.aborted) {
            return current.getSuggestions(lines, cursorLine, cursorCol, options);
          }

          let matched = skills;
          if (query) {
            matched = fuzzyFilter(skills, query, (s) => s.name);
          }

          if (matched.length === 0) {
            return current.getSuggestions(lines, cursorLine, cursorCol, options);
          }

          const items: AutocompleteItem[] = matched.slice(0, 15).map((s) => ({
            value: `$${s.name} `,
            label: `$${s.name}`,
            description: s.description ? (s.description.length > 60 ? s.description.slice(0, 57) + "..." : s.description) : "Skill",
          }));

          return {
            items,
            prefix: `$${query}`,
          };
        },

        applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
          return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
        },

        shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
          return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
        },
      };
    });
  });
}
