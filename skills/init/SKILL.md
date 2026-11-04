---
name: init
description: Generate or update a concise AGENTS.md contributor guide for the current repository. Use when initializing repo documentation, onboarding contributors, or when user asks for init, AGENTS.md, or repository guidelines.
---

# Init — Generate or Update AGENTS.md

Generate or update `AGENTS.md` as a contributor guide for the repository in the current working directory.

## Pre-check (mandatory)

Before writing, check whether `AGENTS.md` already exists in the current working directory:

```bash
ls AGENTS.md
```

- If it exists: read it first, then update it as needed based on repository discovery. Preserve accurate, repository-specific instructions unless they need correction.
- If it does not exist: proceed to generate it.

## Discovery

Inspect the repository before writing. Adapt to what actually exists — do not invent tooling or paths.

1. Project structure: list top-level files and dirs, locate source code, tests, assets, and config files.
   ```bash
   ls -la
   cat package.json 2>/dev/null || cat pyproject.toml 2>/dev/null || cat go.mod 2>/dev/null || cat Cargo.toml 2>/dev/null || cat pom.xml 2>/dev/null
   ```
2. Build/test commands: check README, Makefile, package.json scripts, CI config (`.github/workflows/`, `.gitlab-ci.yml`), task runners.
3. Style: check for formatter/linter config (`.prettierrc`, `eslint.config.*`, `ruff.toml`, `.golangci.yml`, `rustfmt.toml`, `.editorconfig`).
4. Tests: identify framework (jest, vitest, pytest, go test, cargo test) and test file naming/location.
5. Git conventions: inspect recent history.
   ```bash
   git log --oneline -20
   ```

## Document Requirements

- Title the document `Repository Guidelines` (single top-level `#` heading).
- Use Markdown headings (`#`, `##`) for structure.
- Keep the document concise: 200–400 words optimal.
- Keep explanations short, direct, and specific to this repository. No generic advice.
- Provide examples where helpful (commands, directory paths, naming patterns).
- Maintain a professional, instructional tone.

## Recommended Sections

Write only sections that apply. Omit those that do not fit the project. Add extra sections if relevant.

### Project Structure & Module Organization

- Outline where source code, tests, and assets live (e.g. `src/`, `tests/`, `assets/`).
- One bullet per key directory/file.

### Build, Test, and Development Commands

- List key commands for building, testing, and running locally (e.g. `npm test`, `make build`).
- One line per command explaining what it does. Use code formatting.

### Coding Style & Naming Conventions

- Specify indentation, language-specific style, and naming patterns actually used in the repo.
- Name the formatter/linter used (e.g. Prettier, ESLint, Ruff) and its config file.

### Testing Guidelines

- Identify testing frameworks and coverage requirements if any.
- State test naming conventions and how to run tests (exact command).

### Commit & Pull Request Guidelines

- Summarize commit message conventions found in Git history (e.g. Conventional Commits).
- Outline PR requirements: description, linked issues, screenshots, checks.

### Optional sections (add only if relevant)

- Security & Configuration Tips (env vars, secrets handling, `.env.example`).
- Architecture Overview (brief module/data flow).
- Agent-Specific Instructions (constraints for AI agents working in this repo).

## Output

- Write or update `./AGENTS.md` in the current working directory.
- After writing, report the word count and which sections were included, updated, or omitted and why.
