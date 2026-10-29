# Coding standards

## Architecture

- `src/goal.ts` owns every state rule in the pure reducer `step(goal, event, now) -> { goal, effect }`. Add behavior as a new `GoalEvent` or `GoalEffect` variant and a reducer case. The reducer takes `now` as an argument and does no I/O.
- `src/watchdog.ts` and `src/loop.ts` hold the rules for subagent stalls and repeated shell commands. They are separate pure reducers because they apply to sessions without a goal. Time-dependent rules take `now` as an argument; neither module does I/O.
- `src/index.ts` is a thin adapter: it turns OpenCode events, the `/goal` command, and tool calls into `GoalEvent`s, then runs the returned `GoalEffect`. Every state change goes through `transition`, which holds the semaphore across load, step, save, and perform, and emits the `goal.changed` RPC event.
- `src/tui.tsx` is the terminal entrypoint. It reads and edits the goal only through the `goal` RPC (`src/rpc.ts`), renders `goalBadge`, `objectiveLines`, and `sidebarTitle`, `dialogTitle` from `src/badge.ts`, and uses `controlsFor`, `budgetEvent`, `verifyEvent`, and `controlEvent` from `src/controls.ts`. A bare `/goal edit` reaches it as the `editRequested` RPC event, because a terminal slash command named `goal` would take over every `/goal` command. Keep display rules in `badge.ts`, where unit and mutation tests reach them. Do not import `solid-js` in `tui.tsx`: an installed package gets its own copy, and its signals never reach the host renderer. Keep reactive state in `context.storage.memory`.
- `src/verify-plan.ts` maps changed files to the commands AGENTS.md requires for them; `scripts/verify-changed.ts` is its CLI adapter.
- `src/command.ts` parses `/goal` arguments into a `GoalCommand` union. `src/prompts.ts` renders `templates/*.md` and formats status text. `src/controls.ts` holds the pure rules for control ids, their availability, and their input-to-event mapping.
- Model data as tagged unions with `_tag` and `switch` exhaustively. Persisted data is an Effect `Schema`, decoded with `decodeGoal` at the storage boundary.

## Effect and the plugin API

- Use the Effect entry point `@opencode/plugin/effect` with `Effect.gen`. Register transforms, hooks, and the event stream inside the plugin scope so unload disposes them.
- Declare tool inputs as plain JSON Schema through `toolInput(schema)` and decode inside `execute`. OpenCode rejected valid input against an Effect `Schema.Int` passed directly.
- Fail tools with `Tool.Error` and a message the model can act on.
- Isolate each event handler with `catchCause` so one bad event cannot stop the stream.
- Act only on goals whose `directory` matches `ctx.location.directory` (`ownedGoal`). Several plugin instances, one per location, see the same events.
- Synthetic messages: `resume: true` starts a turn, `delivery: "steer"` lands in the running turn, `"queue"` waits for the next one. Send continuations through `queue`, which sends at most one until the next turn starts. Send wrap-ups and objective updates through `steer`, which is never deduplicated.
- Per-turn bookkeeping (`activity`, `agents`, `resumePending`, `closingSteps`) lives in the per-location `LocationState` on `globalThis`, so a plugin reload keeps turns in flight. Recovery after a restart runs only when that state is fresh.
- `goal_update` with `complete` runs the user's `--verify` command before `transition`, outside the semaphore, and passes the result to `step` as `Complete.check`. The reducer accepts the check only for the goal's current command.
- A `Retry` effect forks a sleep into the plugin scope, then sends `RetryDue` with its attempt through `transition`; the reducer drops a `RetryDue` whose attempt no longer matches `failedTurns`. It sends no notice, because a queued notice starts a turn at once. Pending waits live in the per-location `LocationState`, so a location reload resumes each wait where it stopped. The `retryDelaysMs` plugin option exists only so host canaries can shorten the waits.
- The `watchdogStallMs` plugin option sets how long a silent subagent may run before the watchdog interrupts it. It defaults to 600000 ms (10 minutes), and `src/watchdog.ts` checks every quarter of that, capped at 60 s. The watchdog canaries pass 1500 so a stall happens within the test. A child with an open tool call is never interrupted.
- `src/trace.ts` builds the trace log records as pure functions, `src/log.ts` appends them with `appendCapped`, and `src/report.ts` summarizes them for `bun run report`. Records are a tagged union, `TraceRecord`. Every typed `/goal`, failed `goal_*` tool call, caught handler failure, and `transition` that changes the status, has an effect, or changes the goal other than usage writes one record through `trace`. A refused command is a `Refuse` effect, so the log and the report can tell it apart from a notice, which swallows write errors so the log can never fail a goal.
- Storage changes go through `transition` too, including deletion: a deleted session is a quiet `Clear`.

## Persistence

- State lives in `ctx.storage` under `goal/<sessionID>`. Changing the `Goal` schema makes old records decode to `undefined`, which reads as "no goal". Accept that or migrate in `decodeGoal`.

## Prompts and text

- Prompts live in `templates/` with `{{placeholder}}` slots. Pass the objective through `escapeXml`, since it is user data inside `<objective>` tags.
- `templates/continuation.md`, `budget_limit.md`, `objective_updated.md`, and the tool descriptions are adapted from OpenAI Codex under Apache-2.0. When you change them, keep `NOTICE` accurate.

## Tests

- For rendered templates, assert the filled slots with `toContain` on a literal line instead of pinning the whole template text.
- Every reducer branch has a test. A new event or effect ships with its tests.
- `bun run mutation` keeps a 100% mutation score on the files in `mutate` of `stryker.config.json`. Pure logic goes in one of those files. A surviving mutant means a missing test or redundant code: add the test, or delete the code. Do not exclude mutants.

## Host canaries

Changes to `src/index.ts` or event handling need a canary in `host/`. A canary starts a real `opencode serve` through `host/harness/host.ts` with a scripted fixture provider (`host/harness/fixture.ts`). Grade it on `host.stored(session)`, files on disk, and `host.fixture.agentRequests()`. Assert exact counts and values. Add new canary files to the `goal-host` matrix in the repo root `.github/workflows/ci.yml`.

## Manual end-to-end checks

For checks against your own running service:

- The service hot-reloads the plugin only when it is loaded through the `~/.config/opencode/plugins/goal` directory symlink (see README, Develop); then saving `src/` changes every live session. Running `opencode service restart` from inside an OpenCode session kills that session too.
- `opencode run` sends `/goal ...` as plain text. Invoke the command with `opencode api post /api/session/<id>/command --data '{"name":"goal","text":"..."}'`.
- Run each scenario in its own temp directory and session. Read the outcome from `opencode session export <id>` and `opencode api get /api/session/<id>/inbox`.
