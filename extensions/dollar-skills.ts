import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type AutocompleteItem, type AutocompleteProvider, type AutocompleteSuggestions, fuzzyFilter } from "@earendil-works/pi-tui";
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
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
 * - Discovers skills from ~/.agents/skills, .agents/skills, ~/.pi/agent/skills, .pi/skills, and pi.getCommands().
 * - Cross-platform: case-insensitive SKILL.md/skill.md discovery, handles direct .md files, and parses frontmatter names.
 * - Replaces current token on completion and avoids file completion collision on Tab.
 */

interface SkillMeta {
  name: string;
  description?: string;
  filePath?: string;
}

function parseSkillFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};

  const lines = match[1].split(/\r?\n/);
  let name: string | undefined;
  let description: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!name && line.startsWith("name:")) {
      name = line.slice(5).trim().replace(/^["']|["']$/g, "");
    } else if (!description && line.startsWith("description:")) {
      description = line.slice(12).trim().replace(/^["']|["']$/g, "");
      // Handle YAML multiline (folded > or literal |)
      if (description === ">" || description === "|") {
        const multiline: string[] = [];
        for (let j = i + 1; j < lines.length; j++) {
          const nextLine = lines[j];
          if (/^\s+/.test(nextLine)) {
            multiline.push(nextLine.trim());
          } else {
            break;
          }
        }
        if (multiline.length > 0) {
          description = multiline.join(" ");
        }
      }
    }
  }

  return { name, description };
}

function getSearchDirectories(cwd: string): string[] {
  const dirs = new Set<string>();
  const home = homedir();

  // User-level standard paths
  dirs.add(join(home, ".agents", "skills"));
  dirs.add(join(home, ".pi", "agent", "skills"));
  dirs.add(join(home, ".pi", "skills"));

  // Project-level: walk up from cwd to find .agents/skills, .pi/skills, or .pi/agent/skills
  let currentDir = resolve(cwd);
  while (true) {
    dirs.add(join(currentDir, ".agents", "skills"));
    dirs.add(join(currentDir, ".pi", "skills"));
    dirs.add(join(currentDir, ".pi", "agent", "skills"));

    if (existsSync(join(currentDir, ".git")) || currentDir === home) {
      break;
    }
    const parent = dirname(currentDir);
    if (!parent || parent === currentDir) {
      break;
    }
    currentDir = parent;
  }

  return Array.from(dirs);
}

function scanDirectoryForSkills(baseDir: string, skillsMap: Map<string, SkillMeta>) {
  if (!existsSync(baseDir)) return;
  try {
    const entries = readdirSync(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;

      const fullPath = join(baseDir, entry.name);

      if (entry.isDirectory()) {
        // Case-insensitive search for SKILL.md or skill.md
        let skillFilePath: string | undefined;
        try {
          const subEntries = readdirSync(fullPath);
          const found = subEntries.find((f) => f.toLowerCase() === "skill.md");
          if (found) {
            skillFilePath = join(fullPath, found);
          }
        } catch {}

        if (skillFilePath && existsSync(skillFilePath)) {
          let description = "Skill";
          let skillName = entry.name;
          try {
            const raw = readFileSync(skillFilePath, "utf8");
            const meta = parseSkillFrontmatter(raw);
            if (meta.name) skillName = meta.name;
            if (meta.description) description = meta.description;
          } catch {}

          if (!skillsMap.has(skillName)) {
            skillsMap.set(skillName, { name: skillName, description, filePath: skillFilePath });
          }
        }
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        // Direct markdown file (e.g. ~/.pi/agent/skills/shadcn.md)
        if (entry.name.toLowerCase() === "skill.md") continue;

        let description = "Skill";
        let skillName = entry.name.replace(/\.md$/i, "");
        try {
          const raw = readFileSync(fullPath, "utf8");
          const meta = parseSkillFrontmatter(raw);
          if (meta.name) skillName = meta.name;
          if (meta.description) description = meta.description;
        } catch {}

        if (!skillsMap.has(skillName)) {
          skillsMap.set(skillName, { name: skillName, description, filePath: fullPath });
        }
      }
    }
  } catch {}
}

function getAllSkills(pi: ExtensionAPI, cwd: string): SkillMeta[] {
  const skillsMap = new Map<string, SkillMeta>();

  // 1. First priority: Pi's officially registered commands via pi.getCommands()
  try {
    const allCommands = pi.getCommands();
    for (const cmd of allCommands) {
      if (cmd.name.startsWith("skill:")) {
        const name = cmd.name.slice(6);
        skillsMap.set(name, {
          name,
          description: cmd.description,
        });
      }
    }
  } catch {}

  // 2. Discover from disk locations (cross-platform, case-insensitive, supporting subdirs & .md files)
  const searchDirs = getSearchDirectories(cwd);
  for (const dir of searchDirs) {
    scanDirectoryForSkills(dir, skillsMap);
  }

  return Array.from(skillsMap.values());
}

export default function (pi: ExtensionAPI) {
  // 1. Intercept user input and transform "$skill-name <args>" into "/skill:skill-name <args>"
  pi.on("input", async (event, ctx) => {
    if (event.source === "extension") {
      return { action: "continue" };
    }

    const text = event.text.trimStart();
    // Match leading $skill-name (starting with a letter, e.g. $shadcn or $pdf-tools)
    const match = text.match(/^\$([a-zA-Z][a-zA-Z0-9_-]*)(?:\s+(.*)|$)/s);
    if (!match) {
      return { action: "continue" };
    }

    const skillName = match[1];
    const rest = match[2] ? match[2].trim() : "";

    // If known skills are available on the system, only transform matching skills
    // so normal expressions like $VARIABLE, $PATH, or code are not hijacked
    const allSkills = getAllSkills(pi, ctx.cwd);
    const isKnown = allSkills.some((s) => s.name === skillName);

    if (allSkills.length > 0 && !isKnown) {
      return { action: "continue" };
    }

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

    ctx.ui.addAutocompleteProvider((current: AutocompleteProvider): AutocompleteProvider => {
      const existingTriggers = current.triggerCharacters ?? [];
      const triggerCharacters = Array.from(new Set([...existingTriggers, "$"]));

      return {
        triggerCharacters,

        async getSuggestions(lines, cursorLine, cursorCol, options): Promise<AutocompleteSuggestions | null> {
          const currentLine = lines[cursorLine] ?? "";
          const textBeforeCursor = currentLine.slice(0, cursorCol);

          // Match trailing $ or $partialName at boundary (including wrappers like `($` or ``$``)
          const match = textBeforeCursor.match(/(?:^|[\s([{\`])\$([a-zA-Z0-9_-]*)$/);
          if (!match) {
            return current.getSuggestions(lines, cursorLine, cursorCol, options);
          }

          const query = match[1];
          const skills = getAllSkills(pi, ctx.cwd);

          if (options.signal.aborted) {
            return current.getSuggestions(lines, cursorLine, cursorCol, options);
          }

          // If no skills found anywhere on system, inform user when typing bare $
          if (skills.length === 0) {
            if (!query) {
              return {
                items: [
                  {
                    value: "$",
                    label: "$ (No skills installed)",
                    description: "Add to ~/.agents/skills/ or ~/.pi/agent/skills/",
                  },
                ],
                prefix: "$",
              };
            }
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
          if (prefix.startsWith("$")) {
            // Don't apply placeholder hint item
            if (item.value === "$") {
              return { lines, cursorLine, cursorCol };
            }
            const currentLine = lines[cursorLine] || "";
            const beforePrefix = currentLine.slice(0, cursorCol - prefix.length);
            const afterCursor = currentLine.slice(cursorCol);
            const insertValue = afterCursor.startsWith(" ") ? item.value.trimEnd() : item.value;
            const newLine = beforePrefix + insertValue + afterCursor;
            const newLines = [...lines];
            newLines[cursorLine] = newLine;
            return {
              lines: newLines,
              cursorLine,
              cursorCol: beforePrefix.length + insertValue.length,
            };
          }
          return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
        },

        shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
          const currentLine = lines[cursorLine] || "";
          const textBeforeCursor = currentLine.slice(0, cursorCol);
          if (/(?:^|[\s([{\`])\$([a-zA-Z0-9_-]*)$/.test(textBeforeCursor)) {
            return false;
          }
          return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
        },
      };
    });
  });
}
