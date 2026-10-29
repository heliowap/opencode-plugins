# AGENTS.md

Monorepo of OpenCode v2 plugins. Bun, TypeScript.

Layout: `plugins/<name>` (one self-contained plugin each), `install.ts` (installer and plugin discovery), `scripts/` (CI matrix, `trial-install.sh`), `evidence/` (recorded proofs), `docs/`.

- Before editing `plugins/<name>/`, read its `AGENTS.md` and `CODING_STANDARDS.md` if present. Both override the root.
- Before writing or reviewing code in any plugin, read `CODING_STANDARDS.md`. It is the standard for every plugin, including those without their own.
- After editing, run `bun run check`: typecheck and unit tests for the plugins you changed, plus `bun run lint:repo`. After touching shared files (`install.ts`, `scripts/`, `.github/`), run `bun run check:all`.
- `bun install` enables the pre-commit hook in `.githooks/`. CI (`.github/workflows/ci.yml`) runs a per-plugin matrix selected by changed files; goal's host suites run only on goal runtime changes.
- Before adding a plugin, running a host suite, proving an install, or recording evidence, read `docs/development.md`.
- Issues are filed in this repo with the label `plugin:<name>`.
- Install spec: `github:heliowap/opencode-plugins#<ref>::path:plugins/<name>`, built only by `specFor` in `install.ts`. Plugin ids differ from directory names (`tps.meter.server`, `local.unpushed-work`): match installed plugins on `source.target`, never on id. Matching on id broke `scripts/trial-install.sh` once.
