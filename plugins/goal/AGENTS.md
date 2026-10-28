# AGENTS.md

OpenCode 2 plugin that adds a Codex-style `/goal`. Bun, TypeScript, Effect.

Before editing `src/`, `test/`, or `templates/`, read `CODING_STANDARDS.md`.

- Verify with `bun run verify:changed`: it runs the checks the changed files select (rules in `src/verify-plan.ts`; `--dry-run` lists them). The tui suite requires tmux.
- Write everything in English: code, comments, docs, commit messages, issues, and pull requests.
- This machine runs the published package (`github:heliowap/opencode-v2-goal-plugin` in `~/.config/opencode/opencode.jsonc`), not this checkout: a change reaches live sessions only after merge and `opencode plugin update`. Test unmerged changes with `bun test ./host`, which loads `src/` into an isolated `opencode serve`.
