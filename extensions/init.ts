import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * init — Generates an AGENTS.md contributor guide for the current repository.
 *
 * Adopted directly from OpenAI Codex's `/init` slash command and prompt:
 * https://github.com/openai/codex (codex-rs/tui/assets/prompt_for_init_command.md)
 *
 * Slash command:
 *   /init [--force|-f] [additional instructions]
 */

const CODEX_INIT_PROMPT = `Generate a file named AGENTS.md that serves as a contributor guide for this repository.
Before writing, check whether AGENTS.md already exists in the current working directory. If it does, do not overwrite or modify it.
Your goal is to produce a clear, concise, and well-structured document with descriptive headings and actionable explanations for each section.
Follow the outline below, but adapt as needed — add sections if relevant, and omit those that do not apply to this project.

Document Requirements

- Title the document "Repository Guidelines".
- Use Markdown headings (#, ##, etc.) for structure.
- Keep the document concise. 200-400 words is optimal.
- Keep explanations short, direct, and specific to this repository.
- Provide examples where helpful (commands, directory paths, naming patterns).
- Maintain a professional, instructional tone.

Recommended Sections

Project Structure & Module Organization

- Outline the project structure, including where the source code, tests, and assets are located.

Build, Test, and Development Commands

- List key commands for building, testing, and running locally (e.g., npm test, make build).
- Briefly explain what each command does.

Coding Style & Naming Conventions

- Specify indentation rules, language-specific style preferences, and naming patterns.
- Include any formatting or linting tools used.

Testing Guidelines

- Identify testing frameworks and coverage requirements.
- State test naming conventions and how to run tests.

Commit & Pull Request Guidelines

- Summarize commit message conventions found in the project’s Git history.
- Outline pull request requirements (descriptions, linked issues, screenshots, etc.).

(Optional) Add other sections if relevant, such as Security & Configuration Tips, Architecture Overview, or Agent-Specific Instructions.`;

const CODEX_INIT_PROMPT_FORCE = `Generate a file named AGENTS.md that serves as a contributor guide for this repository.
If AGENTS.md already exists in the current working directory, examine its contents and update/overwrite it to reflect current repository conventions and structure.
Your goal is to produce a clear, concise, and well-structured document with descriptive headings and actionable explanations for each section.
Follow the outline below, but adapt as needed — add sections if relevant, and omit those that do not apply to this project.

Document Requirements

- Title the document "Repository Guidelines".
- Use Markdown headings (#, ##, etc.) for structure.
- Keep the document concise. 200-400 words is optimal.
- Keep explanations short, direct, and specific to this repository.
- Provide examples where helpful (commands, directory paths, naming patterns).
- Maintain a professional, instructional tone.

Recommended Sections

Project Structure & Module Organization

- Outline the project structure, including where the source code, tests, and assets are located.

Build, Test, and Development Commands

- List key commands for building, testing, and running locally (e.g., npm test, make build).
- Briefly explain what each command does.

Coding Style & Naming Conventions

- Specify indentation rules, language-specific style preferences, and naming patterns.
- Include any formatting or linting tools used.

Testing Guidelines

- Identify testing frameworks and coverage requirements.
- State test naming conventions and how to run tests.

Commit & Pull Request Guidelines

- Summarize commit message conventions found in the project’s Git history.
- Outline pull request requirements (descriptions, linked issues, screenshots, etc.).

(Optional) Add other sections if relevant, such as Security & Configuration Tips, Architecture Overview, or Agent-Specific Instructions.`;

export default function (pi: ExtensionAPI) {
  pi.registerCommand("init", {
    description: "create an AGENTS.md file with instructions for AI agents (OpenAI Codex style)",
    getArgumentCompletions: (prefix: string) => {
      const flags = ["--force", "-f"];
      const matched = flags.filter((f) => f.startsWith(prefix));
      return matched.length > 0 ? matched.map((f) => ({ value: f, label: f })) : null;
    },
    handler: async (args, ctx) => {
      if (!ctx.isIdle()) {
        if (ctx.hasUI) {
          ctx.ui.notify("Cannot run /init while agent is busy", "warning");
        }
        return;
      }

      const trimmed = args.trim();
      const isForce = /(?:^|\s)(?:--force|-f)(?:\s|$)/.test(trimmed);
      const remainingArgs = trimmed.replace(/(?:^|\s)(?:--force|-f)(?:\s|$)/, " ").trim();

      let prompt = isForce ? CODEX_INIT_PROMPT_FORCE : CODEX_INIT_PROMPT;

      if (remainingArgs) {
        prompt += `\n\nAdditional instructions:\n${remainingArgs}`;
      }

      if (ctx.hasUI) {
        ctx.ui.notify(
          isForce ? "Initializing AGENTS.md (force overwrite)..." : "Initializing AGENTS.md...",
          "info"
        );
      }

      pi.sendUserMessage(prompt);
    },
  });
}
