# AGENTS.md

OpenCode 2 plugin that adds a Codex-style `/goal`. Bun, TypeScript, Effect.

Before editing `src/`, `test/`, or `templates/`, read `CODING_STANDARDS.md`.

- `bun run verify:changed` must pass before every commit: it runs the checks the changed files select (rules in `src/verify-plan.ts`, the single source; `--dry-run` lists them). The tui suite requires tmux.
- This machine runs the published package (`github:heliowap/opencode-plugins#main::path:plugins/goal` in `~/.config/opencode/opencode.jsonc`), not this checkout: a change reaches live sessions only after merge and `opencode plugin update`. Test unmerged changes with `bun test ./host`, which loads `src/` into an isolated `opencode serve`.
