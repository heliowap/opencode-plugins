# Coding standards

These rules apply to every plugin under `plugins/` and to the root code (`install.ts`, `scripts/`, `test/`). A rule marked "enforced by `lint:repo`" is mechanical: a failing `bun run lint:repo` is the finding, not a judgement call.

## Monorepo

- Each plugin is self-contained and installable from `github:heliowap/opencode-plugins#<ref>::path:plugins/<name>`. It imports nothing from outside its directory.
- Enforced by `lint:repo`:
  - `plugin-shape`: the plugin has `package.json` (with a `typecheck` script), `bun.lock`, `tsconfig.json`, `README.md`, and a row in the root README table.
  - `workspace-dep`: no `workspace:` dependencies in a plugin.
  - `old-spec`: install specs point at this monorepo, never at the archived `opencode-v2-*` repos.
  - `redacted-literal`: files carry real values, never the redact-secrets mask placeholder.
- The plugin `id` is stable. Stored state and user config are keyed by it, so a rename orphans both. A plugin may register several ids (server, TUI, slots); the root README table lists them all.
- Plugin lists and install specs have one source: `listPlugins` and `specFor` in `install.ts`. Scripts, CI, and tests derive from them. The one exception is the human-facing README table.
- Pin each new GitHub Action to a full commit SHA, with the version in a comment.

## Architecture

- Rules live in pure modules under `src/`: no I/O, and the clock enters as a `now` argument.
- I/O sits at one edge per concern (a git module, an HTTP client, the OpenCode event adapter). Adapters (`index.ts`, `tui.tsx`) translate host events into calls to the pure modules and carry no rules.

## Style

- Declare with `const` and return early.
- Import named bindings directly under their own names.
- Type values precisely; let unexpected errors propagate to the adapter, which handles them.
- Write a comment only for a non-obvious why, such as a host quirk. State the observed fact.
- Write everything in English: code, comments, prompts, user-visible text, tests, docs, commit messages, issues, and pull requests.

## Tests

- Test behavior through the exported functions, the way the adapter calls them. Assert literal expected values.
- Use real processes, servers, and repositories; `host/harness/` and `test/harness/` hold the fixtures.
- Expected values come from the fixture, never from the code under test. These shapes are tautological and fail review:
  - A computed expected value, such as `Date.parse(...)` or arithmetic over the fixture. Write the literal.
  - A restated constant: an upstream URL, header, request body, or config default copied from `src/`. Test the mechanism that reads it.
  - A weak assertion: `toBeDefined`, `toBeTruthy`, `not.toThrow`, `toBeInstanceOf`, `toBeGreaterThan(0)`, or none.
  - An absence alone (`toEqual([])`, `toBe("")`, `toBe(false)`, `toBeUndefined`) without a presence check on another input in the same test.
  - A fixture that asserts itself, where the subject never runs in the test body.
- Unit tests cannot see the TUI or the host wiring. A change to `tui.tsx` or to event handling gets the plugin's end-to-end check or host canary.

## Plugin standards

Plugin-specific rules live in `plugins/<name>/CODING_STANDARDS.md` and override this file. A plugin without one follows this file alone.
