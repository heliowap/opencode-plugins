# AGENTS.md

Monorepo of OpenCode v2 plugins. Bun, TypeScript.

- Before editing any file, read `CODING_STANDARDS.md`. It covers every plugin and the root code.
- Before editing `plugins/<name>/`, read that plugin's `AGENTS.md` and `CODING_STANDARDS.md` where they exist.
- `bun run check` must pass before every commit; the pre-commit hook runs it. `bun run check:all` runs everything at once.
- Before adding a plugin, running a host suite, or proving an install, read `docs/development.md`.
- Plugin ids differ from directory names (`tps.meter.server`, `local.unpushed-work`); never derive one from the other.
