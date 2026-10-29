# Coding standards

These rules apply to every plugin under `plugins/`. Rules marked "enforced by `lint:repo`" are mechanical: a failing `bun run lint:repo` is the finding, not a judgement call. Plugin-specific rules live in `plugins/<name>/CODING_STANDARDS.md` and override this file.

## Monorepo

- Each plugin is self-contained and installable from `github:heliowap/opencode-plugins#<ref>::path:plugins/<name>`. It imports nothing from outside its directory and carries its own `package.json`, `bun.lock`, and `tsconfig.json`. Required files: enforced by `lint:repo` (`plugin-shape`). No `workspace:` dependencies: enforced by `lint:repo` (`workspace-dep`).
- The plugin `id` is stable. Stored state and user config are keyed by it, so a rename orphans both. A plugin may register several ids (server, TUI, slots); list them all in the README table of the root `README.md`.
- Plugin lists and install specs have one source: `listPlugins` and `specFor` in `install.ts`. Scripts, CI, and tests derive from them. The one exception is the human-facing README table.
- Pin each new GitHub Action to a full commit SHA, with the version in a comment.
- No `github:heliowap/opencode-v2-` specs (`old-spec`) and no literal `[REDACTED]` (`redacted-literal`): enforced by `lint:repo`.

## Architecture

- Rules live in pure modules under `src/`: no I/O, and the clock enters as a `now` argument.
- I/O sits at one edge per concern (a git module, an HTTP client, the OpenCode event adapter). Adapters (`index.ts`, `tui.tsx`) translate host events into calls to the pure modules and carry no rules.

## Style

- Prefer `const` and early returns.
- Do not alias imports or use star imports.
- Avoid `any`, casts, and `try`/`catch`.
- Write a comment only for a non-obvious why, such as a host quirk. State the observed fact.
- Write everything in English: code, comments, prompts, user-visible text, tests, docs, commit messages, issues, and pull requests.

## Tests

- Test behavior through the exported functions, the way the adapter calls them. Assert literal expected values.
- Do not mock. Use real processes, servers, and repositories; `host/harness/` and `test/harness/` hold the fixtures.
- Expected values come from the fixture, never from the code under test. These shapes are tautological and fail review:
  - A computed expected value, such as `Date.parse(...)` or arithmetic over the fixture. Write the literal.
  - A restated constant: an upstream URL, header, request body, or config default copied from `src/`. Test the mechanism that reads it.
  - A weak assertion: `toBeDefined`, `toBeTruthy`, `not.toThrow`, `toBeInstanceOf`, `toBeGreaterThan(0)`, or none.
  - An absence alone (`toEqual([])`, `toBe("")`, `toBe(false)`, `toBeUndefined`) without a presence check on another input in the same test.
  - A fixture that asserts itself, where the subject never runs in the test body.
- Unit tests cannot see the TUI or the host wiring. A change to `tui.tsx` or to event handling gets the plugin's end-to-end check or host canary.

## Plugin standards

Plugin-specific rules live in `plugins/<name>/CODING_STANDARDS.md` and override this file. A plugin without one follows this file alone.
