# Development

## Check interface

| Command | Runs | Use when |
| --- | --- | --- |
| `bun run check` | typecheck and unit tests for the plugins and root code your changes affect, plus `lint:repo` | before every commit |
| `bun run check:all` | the same for everything | you want the whole repo at once |
| `bun run lint:repo` | the repo linter | its rules are in `CODING_STANDARDS.md` |

`bun install` enables the pre-commit hook in `.githooks/` (`prepare`). CI is `.github/workflows/ci.yml`: a per-plugin matrix selected by changed files through `scripts/ci-matrix.ts`; goal's host suites run only on goal runtime changes. The scripts live in `package.json`, `scripts/check.ts`, and `scripts/lint-repo.ts`.

## Add a plugin

1. Copy the shape of a small sibling (`plugins/redact-secrets`) and satisfy `plugin-shape` (`CODING_STANDARDS.md`, Monorepo). `bun run check` names what is missing.
2. In `package.json`: set `description` (the installer prints it), declare the entry in `exports`, and add a `test` script if the plugin has tests (the CI matrix runs `bun run test` only when it exists).
3. Run `bun install` inside `plugins/<name>`; each plugin has its own `bun.lock`.
4. `install.ts` needs no edit: `listPlugins` finds any `plugins/<dir>/package.json`. Confirm with `./install.ts --dry-run <name>`, which prints the `opencode plugin add` command and runs nothing.
5. Add an entry to `OVERRIDES` in `scripts/ci-matrix.ts` only when the plugin departs from the default runner, Bun version, OpenCode version, or test command.
6. Create the issue label: `gh label create "plugin:<name>" --color 1d76db --description "Plugin: <name>"`.
7. After the branch is pushed, prove the install with `scripts/trial-install.sh`.

## Run host suites locally

Host suites start a real `opencode serve` against a fixture provider, so `opencode` must be on `PATH` (or `OPENCODE_BIN`). Run them from the plugin directory; each README documents its own:

- goal: `plugins/goal/README.md`, section Develop. Not in the README: `GOAL_HOST_KEEP=1` keeps each host's temp directory, and `GOAL_PLUGIN_SPEC=<spec>` makes the `package` and `tui` suites install that spec instead of loading `src/`.
- model-policy: `plugins/model-policy/README.md`, section Development (`bun run test:host`).
- protect-agents-md: `plugins/protect-agents-md/README.md`, section Development.

## Prove an install in isolation

`scripts/trial-install.sh <ref> <name>...` installs `plugins/<name>` from `github:heliowap/opencode-plugins#<ref>` into a throwaway OpenCode environment and checks that the live `~/.config/opencode` is unchanged. `<ref>` is a pushed branch or sha, and `<name>` is a directory name. The script header and its `refuse` and exit paths document the rest.

## Evidence

Write a proof as Markdown with one row per check, its result, and its exit status, naming the commit it ran at (`evidence/gate.md`). Write data that tools read as TSV with a header row (`evidence/subtree-imports.tsv`).
