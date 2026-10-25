# Coding standards

## Architecture

- `src/facts.ts` owns every git call behind one function, `inspect(directory, base)`, and returns
  `Facts`, or `undefined` outside a repository. Expected failures are part of the diagnosis, not
  errors: a branch that tracks nothing, a configured base ref the repository does not have, a
  repository with no remote. They are returned as states or absent fields, never thrown, and never
  as a placeholder value standing in for a fact that was not read.
- `src/describe.ts` owns every wording rule behind one pure function, `describe(facts)`. It does no
  I/O and always returns a report.
- `src/index.ts` owns the wiring and the per-session bookkeeping that the wiring needs: which
  sessions this location owns, which already carry a report, and which have a warm-up in flight.
  Rules about git or about wording stay out of it.
- `index.ts` at the root is the entry point. OpenCode resolves a local plugin directory from its
  root, so an `exports` entry pointing into `src/` is not loaded.
- The plugin writes nothing. `git fetch --prune` is the only command that is not read-only; anything
  that changes the working tree, the index or a ref stays out.
- The report is appended to the prompt, never prepended: attachment `mention` offsets index into
  that text.
- The report never tells a model to mutate the repository. It states facts, and its last line
  forbids pulling, rebasing or merging on the model's own initiative. It does not override the
  user: a rebase the user asks for is still the user's call.
- The session's first prompt waits on this check, so the git timeouts are short enough that a slow
  network degrades the report rather than the session.

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

Unit tests cannot see the plugin wiring. After changing `src/index.ts`, run `bun script/e2e.ts`. It
builds the same fixture as the tests through `test/harness/repository.ts`, serves it from a private
`opencode serve` so the user's own service and data are untouched, sends two prompts and checks that

1. the first user message OpenCode persisted carries `Base: 1 commit behind origin/dev.`, while the
   clone's own refs still report `0`, and
2. the second carries no report.

It exits non-zero on either failure. It needs a configured provider and spends one model call per
prompt, so it stays out of CI.
