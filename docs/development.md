# Development

Reached from `AGENTS.md`. Sections are independent; read the one that matches your task.

## Check interface

| Command | Runs | Use when |
| --- | --- | --- |
| `bun run check` | typecheck and unit tests for the plugins your changes affect, plus `lint:repo` | after every edit |
| `bun run check:all` | the same for every plugin | after touching `install.ts`, `scripts/`, or `.github/` |
| `bun run lint:repo` | the repo linter | rules below |

`lint:repo` rules: `plugin-shape` (each plugin has the required files), `old-spec` (no `github:heliowap/opencode-v2-`), `redacted-literal` (no literal `[REDACTED]`), `workspace-dep` (no `workspace:` dependencies in plugins). The pre-commit hook in `.githooks/` runs when `bun install` has run (`prepare`). CI is `.github/workflows/ci.yml`; its matrix is chosen by `scripts/ci-matrix.ts` from the changed files. The commands and the linter live in `package.json`, `scripts/check.ts`, and `scripts/lint-repo.ts`; read them for the exact behavior.

## Add a plugin

Each step names the check that catches a miss.

1. Create `plugins/<name>/` by copying the shape of a small sibling (`plugins/redact-secrets`). The required file list is the `plugin-shape` rule in `scripts/lint-repo.ts`.
2. In `package.json`: set `description` (the installer prints it), add a `typecheck` script (CI runs `bun run typecheck` for every plugin), and add `test` if the plugin has tests (the CI matrix runs `bun run test` only when the script exists). Declare the entry in `exports`. Use no `workspace:` dependencies (`workspace-dep`) and no `github:heliowap/opencode-v2-` specs (`old-spec`).
3. Run `bun install` inside `plugins/<name>`; each plugin has its own `bun.lock`.
4. Pick a plugin `id` you will keep. Stored state is keyed by it.
5. Add a row to the `Plugins` table in the root `README.md`: directory, every plugin id, description, former repo.
6. Nothing to register in `install.ts`: `listPlugins` finds any `plugins/<dir>/package.json`. Confirm with `./install.ts --dry-run <name>`, which prints the `opencode plugin add` command and runs nothing.
7. CI needs no edit unless the plugin departs from the defaults (runner, Bun version, OpenCode version, test command): add an entry to `OVERRIDES` in `scripts/ci-matrix.ts`.
8. Create the issue label: `gh label create "plugin:<name>" --color 1d76db --description "Plugin: <name>"`.
9. After the branch is pushed, prove the install with `scripts/trial-install.sh` (below).

## Run host suites locally

Host suites start a real `opencode serve` against a fixture provider. They need `opencode` on `PATH`, or `OPENCODE_BIN` pointing at it. Run each from the plugin directory.

| Plugin | Command | Notes |
| --- | --- | --- |
| goal | `bun test ./host` | One suite: `bun test ./host/<suite>.test.ts`. The `tui` suites need `tmux`. CI pins the OpenCode version in `OPENCODE_VERSION` of `ci.yml`. `GOAL_HOST_KEEP=1` keeps each host's temp directory for inspection. `GOAL_PLUGIN_SPEC=<spec>` makes the `package` and `tui` suites install that spec instead of loading `src/`. `LIVE_MODEL="<provider>/<model>" bun test ./host/live/live.test.ts` uses your provider config. |
| model-policy | `bun run test:host` | The harness clears `CLIPROXY_URL` and `CLIPROXY_MANAGEMENT_KEY`. |
| protect-agents-md | `bun test` | Its unit and host tests share one command. The native process-enforcement group runs on macOS only. |

The plugin README holds each suite's prerequisites and tested OpenCode versions.

## Prove an install in isolation

`scripts/trial-install.sh <ref> <name>...` installs `plugins/<name>` from `github:heliowap/opencode-plugins#<ref>` into a throwaway OpenCode environment, starts `opencode serve`, and waits until every plugin reports `active`. `<ref>` is a pushed branch or sha, and `<name>` is a directory name. It hashes `~/.config/opencode/opencode.jsonc` and `cli.json` before and after, and ends with `TRIAL OK` only when both are unchanged.

Exit codes: `2` usage, `3` isolation not proven (it refuses to run against the live paths), `4` live config modified, `1` install failure or a 120 s load timeout.

## Evidence

Anything that must outlive the session goes in `evidence/`. Existing files show the forms:

- Markdown for a proof: a title naming what was proved, the commit the checks ran at, then one row per check with its result and exit status (`evidence/gate.md`). Record measured output verbatim (`evidence/preflight.md`).
- TSV with a header row for data other tools read (`evidence/subtree-imports.tsv`, `evidence/issue-transfer.tsv`).
