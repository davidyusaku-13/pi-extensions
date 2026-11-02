import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type AutocompleteItem, type AutocompleteProvider, type AutocompleteSuggestions, fuzzyFilter } from "@earendil-works/pi-tui";
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * dollar-skills — Allows invoking Pi skills using the "$skill-name" syntax.
 *
 * Examples:
 *   $shadcn add button          -> /skill:shadcn add button
 *   $computer-use open terminal -> /skill:computer-use open terminal
 *
 * Features:
 * - Natural typing trigger: sets triggerCharacters: ["$"] so typing "$" automatically pops up suggestions.
 * - Discovers skills from ~/.agents/skills, .agents/skills, and pi.getCommands().
 * - Replaces current token on completion.
 */

interface SkillMeta {
  name: string;
  description?: string;
}

function discoverSkillsFromDisk(cwd: string): SkillMeta[] {
  const skillsMap = new Map<string, SkillMeta>();
  const searchDirs = [
    join(homedir(), ".agents", "skills"),
    join(cwd, ".agents", "skills"),
    join(homedir(), ".pi", "agent", "skills"),
    join(homedir(), ".pi", "skills"),
  ];

  for (const baseDir of searchDirs) {
    if (!existsSync(baseDir)) continue;
    try {
      const entries = readdirSync(baseDir);
      for (const entry of entries) {
        if (entry.startsWith(".")) continue;
        const skillDir = join(baseDir, entry);
        const skillFile = join(skillDir, "SKILL.md");
        if (existsSync(skillFile)) {
          let description = "Skill";
          try {
            const raw = readFileSync(skillFile, "utf8");
            const lines = raw.split(/\r?\n/);
            for (const l of lines) {
              const trimmed = l.trim();
              if (trimmed.startsWith("description:")) {
                description = trimmed.slice(12).trim().replace(/^[\"']|[\"']$/g, "");
                break;
              }
            }
          } catch {}
          skillsMap.set(entry, { name: entry, description });
        }
      }
    } catch {}
  }

  return Array.from(skillsMap.values());
}

export default function (pi: ExtensionAPI) {
  // 1. Intercept user input and transform "$skill-name <args>" into "/skill:skill-name <args>"
  pi.on("input", async (event) => {
    if (event.source === "extension") {
      return { action: "continue" };
    }

    const text = event.text.trimStart();
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

  // 2. Register TUI Autocomplete provider with triggerCharacters: ["$"]
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI || typeof ctx.ui.addAutocompleteProvider !== "function") return;

    let cachedSkills: SkillMeta[] | null = null;

    const getSkills = (): SkillMeta[] => {
      if (cachedSkills && cachedSkills.length > 0) return cachedSkills;

      // 1. Try pi.getCommands()
      try {
        const allCommands = pi.getCommands();
        const skillCommands = allCommands
          .filter((c) => c.name.startsWith("skill:"))
          .map((c) => ({
            name: c.name.slice(6),
            description: c.description,
          }));

        if (skillCommands.length > 0) {
          cachedSkills = skillCommands;
          return cachedSkills;
        }
      } catch {}

      // 2. Fallback to scanning disk locations (~/.agents/skills, etc.)
      cachedSkills = discoverSkillsFromDisk(ctx.cwd);
      return cachedSkills;
    };

    ctx.ui.addAutocompleteProvider((current: AutocompleteProvider): AutocompleteProvider => {
      const existingTriggers = current.triggerCharacters ?? [];
      const triggerCharacters = Array.from(new Set([...existingTriggers, "$"]));

      return {
        triggerCharacters,

        async getSuggestions(lines, cursorLine, cursorCol, options): Promise<AutocompleteSuggestions | null> {
          const currentLine = lines[cursorLine] ?? "";
          const textBeforeCursor = currentLine.slice(0, cursorCol);

          // Match trailing $ or $partialName at boundary
          const match = textBeforeCursor.match(/(?:^|[\s])\$([a-zA-Z0-9_-]*)$/);
          if (!match) {
            return current.getSuggestions(lines, cursorLine, cursorCol, options);
          }

          const query = match[1];
          const skills = getSkills();

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
            description: s.description
              ? s.description.length > 60
                ? s.description.slice(0, 57) + "..."
                : s.description
              : "Skill",
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
