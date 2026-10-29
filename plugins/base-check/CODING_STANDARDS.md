# Coding standards

## Architecture

- `src/facts.ts` owns every git call behind one function, `inspect(directory, base)`, and returns
  `Facts`, or `undefined` outside a repository. Expected failures are part of the diagnosis, not
  errors: a branch that tracks nothing, a configured base ref the repository does not have, a
  repository with no remote. They are returned as states or absent fields, never thrown, and never
  as a placeholder value standing in for a fact that was not read.
- `src/describe.ts` owns every wording rule behind one function, `describe(facts)`, which always returns a
  report.
- `src/index.ts` owns the wiring and the per-session bookkeeping that the wiring needs: which
  sessions already carry a report, and which have a warm-up in flight. Ownership is decided per
  event and per prompt, never recorded. Rules about git or about wording stay out of it.
- A session is claimed before the first `await` so that two prompts admitted at once cannot both
  annotate it, and the claim is released again whenever no report ends up attached. A session this
  location does not own, or one whose check failed, must stay eligible.
- `index.ts` at the root is the entry point, and it only re-exports `src/index.ts`. OpenCode
  resolves a local plugin directory as a path (`<dir>/server`, then `<dir>/index`) and never reads
  that directory's `package.json`, so declaring the entry only through `exports` or `main` loads
  nothing and logs nothing. Do not move it under `src/`.
- The plugin writes nothing. `git fetch --prune` is the only command that is not read-only, and
  every call passes `--no-optional-locks`, without which `git status` rewrites `.git/index`.
  Anything that changes the working tree, the index or a local ref stays out, and a test asserts
  the index mtime is untouched.
- The report is appended to the prompt, never prepended: attachment `mention` offsets index into
  that text.
- The report never tells a model to mutate the repository. It states facts, and its last line
  forbids pulling, rebasing or merging on the model's own initiative. It does not override the
  user: a rebase the user asks for is still the user's call.
- The session's first prompt waits on this check, so the whole check has a deadline in
  `src/index.ts`, not just a timeout per git command: the steps run in sequence and their timeouts
  would otherwise add up. Past the deadline the prompt goes through unannotated.

## Tests

- Test through `inspect` and `describe`, the way `src/index.ts` calls them.
- `test/harness/repository.ts` builds real repositories: a bare origin whose default branch is `dev`, a seed clone that publishes to it, and the clone under test. Expected counts come from that history.
- The staleness test also asserts that the clone's local refs still say zero, so a passing run proves the fetch ran rather than assuming it.

## End-to-end check

After changing `src/index.ts`, run `bun script/e2e.ts`. It
builds the same fixture as the tests through `test/harness/repository.ts`, loads this checkout by
absolute path, serves it from a private `opencode serve` so the user's own service and data are
untouched, sends two prompts and checks that

1. the first user message OpenCode persisted carries `Base: 1 commit behind origin/dev.`, while the
   clone's own refs still report `0`, and
2. the second carries no report.

It exits non-zero on either failure. It needs a configured provider and spends one model call per
prompt, so it stays out of CI.
