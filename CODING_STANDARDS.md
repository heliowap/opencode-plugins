# Coding standards

## Architecture

- `src/facts.ts` owns every git call behind one function, `inspect(directory, base)`, and returns
  `Facts`. Expected failures are part of the diagnosis, not errors: a branch that tracks nothing, a
  repository with no remote, a directory that is not a repository. They are returned as absent
  fields, never thrown.
- `src/describe.ts` owns every wording rule behind one pure function, `describe(facts)`. It does no
  I/O and returns `undefined` outside a repository.
- `src/index.ts` is wiring only: subscribe, filter, await, append. Keep rules out of it.
- `index.ts` at the root is the entry point. OpenCode resolves a local plugin directory from its
  root, so an `exports` entry pointing into `src/` is not loaded.
- The plugin writes nothing. `git fetch --prune` is the only command that is not read-only; anything
  that changes the working tree, the index or a ref stays out.
- The report is appended to the prompt, never prepended: attachment `mention` offsets index into
  that text.

## Style

- Prefer `const` and early returns.
- Do not alias imports or use star imports.
- Avoid `any`, casts, and `try`/`catch`.
- Comments explain a non-obvious why. Do not narrate the code.
- All user-visible text is English.

## Tests

- Write the failing test first, run it to see it fail, then implement.
- Test through `inspect` and `describe`, the way `src/index.ts` calls them, and assert literal
  values.
- Do not mock. `test/harness/repository.ts` builds real repositories: a bare origin whose default
  branch is `dev`, a seed clone that publishes to it, and the clone under test.
- Expected counts come from the fixture's history, not from the code's own arithmetic. The staleness
  test also asserts that the clone's local refs still say zero, so a passing run proves the fetch
  ran rather than assuming it.
- `bun test` and `bun run typecheck` pass before every commit.

## End-to-end check

Unit tests cannot see the plugin wiring. After changing `src/index.ts`, run `script/e2e.sh` and
read its output:

1. The first user message must end with the base check, saying `1 commit behind origin/dev`, while
   the line above the report shows the clone's own refs reporting `0`.
2. The second user message must carry no report.

The script needs a configured provider and spends one model call per prompt, so it stays out of CI.
