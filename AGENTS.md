# AGENTS.md

Monorepo of OpenCode v2 plugins. Bun, TypeScript.

- Before editing any file, read `CODING_STANDARDS.md`. It covers every plugin and the root code.
- Before editing `plugins/<name>/`, read that plugin's `AGENTS.md` and `CODING_STANDARDS.md` where they exist.
- `bun run check` must pass before every commit; the pre-commit hook runs it. `bun run check:all` runs everything at once.
- **Ceremony:** state the change class on the `Done when:` line, the first line of the first reply, chosen by what the diff touches or, with no diff yet, by the highest category the plan will touch; in doubt, the higher class. Sensitive (`plugins/redact-secrets`, `plugins/protect-agents-md`, `install.ts` and install specs, `scripts/trial-install.sh`, plugin ids and stored-state keys): TDD and a two-axis review. Local behavior: TDD, narrow spec and one Spec-axis review subagent. Mechanical (flag, value, rename, revert, text, test deletion): the narrowest check, with no new test or agent review. These harnesses replace the generic one-review-per-axis rule; an implementer's review of its own diff counts for that diff. An explicit request sets the floor. Report a disproportionate brake with evidence; the owner decides.
- **Project facts:** while `README.md` records plugins installed by users and `CODING_STANDARDS.md` records user state keyed by plugin id, preserving id-keyed state is a Sensitive concern and shims for never-shipped behavior are ceremony. Brake owners: `bun run check` and the pre-commit hook (the repo); edits to the global `AGENTS.md` (the user, via protect-agents-md).
- Before adding a plugin, running a host suite, or proving an install, read `docs/development.md`.
- Plugin ids differ from directory names (`tps.meter.server`, `local.unpushed-work`); never derive one from the other.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on this repository; use `gh`. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical role names as label strings. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
