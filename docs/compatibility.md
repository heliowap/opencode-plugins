# Compatibility and evidence

Every claim here comes from a real `opencode serve` process with no mocked plugin hooks. Each run uses isolated `HOME` and `XDG_*` directories. Results are graded on state the plugin cannot narrate: the goal stored in `opencode.db` (table `kv`, key `plugin:<id>:goal/<sessionID>`), files on disk, test exit codes, and the requests the plugin sent. Model prose is not evidence.

## Host canaries (deterministic)

`host/*.test.ts` runs OpenCode 2.0.24 against a scripted OpenAI-compatible fixture provider (`host/harness/fixture.ts`). The fixture controls each reply, its timing, errors, and the exact token usage, so these results reproduce on every run. A8b–A8e load `host/harness/no-host-retry`, which turns off OpenCode's own provider retries, and set `GOAL_RETRY_DELAYS_MS` to shorten the plugin's waits. CI runs one runner per file on Linux. They also pass locally on macOS arm64.

| # | Scenario | Result | Graded on |
|---|---|---|---|
| A1 | `/goal` registers and `goal_create`, `goal_get`, `goal_update` reach the model | ✅ | `/api/command`, tools in the captured request |
| A2 | The goal continues turn after turn and stops once completed | ✅ | stored `complete` with note, `a.txt`/`b.txt` contents, exactly 3 continuations and 6 model requests |
| A3 | Text-only turns keep the goal going | ✅ | stored `complete`, `emptyTurns: 0`, 3 continuations |
| A4 | Three empty turns block the goal | ✅ | stored `blocked`, `emptyTurns: 3`, exactly 3 model requests |
| A5 | Crossing a 10K budget limits the goal and steers one wrap-up | ✅ | stored `budget_limited`, `tokensUsed: 16000` with 4,000-token steps, exactly 1 wrap-up |
| A5b | The step that calls `goal_update` is charged | ✅ after #2 | stored `tokensUsed: 4000` for a one-step goal |
| A5c | Crossing the budget in a turn already steered by `/goal edit` still steers the wrap-up | ✅ after #9 | stored `budget_limited`, `tokensUsed: 360`, exactly 1 wrap-up request |
| A6 | `/goal edit` mid-turn steers that turn and keeps usage | ✅ | stored new objective, `tokensUsed: 240`, escaped objective in the steered request |
| A7a | Interrupt pauses, resume continues | ✅ | stored `paused` with note, then `complete` |
| A7b | `/goal pause` mid-turn starts no other turn | ✅ | stored `paused`, exactly 2 model requests (the second answers the pause notice) |
| A8 | A provider error blocks instead of looping | ✅ | stored `blocked` with the error, exactly 1 model request |
| A8b | A server error (503) is retried and the goal finishes without the user | ✅ | stored `complete` with no failure streak left, exactly 3 model requests |
| A8c | A server error that persists blocks after three retries | ✅ | stored `blocked`, `failedTurns: 3`, note `Turn failed after 3 retries: …`, exactly 4 model requests |
| A8d | Pausing during the retry wait cancels the retry | ✅ | stored `paused`, exactly 1 model request |
| A8e | A location reload during the retry wait still retries | ✅ after review | stored `complete`, exactly 3 model requests |
| A9 | `plan`-agent turns neither count nor continue | ✅ | stored `active`, `tokensUsed: 0`, one continuation in the last request |
| A10 | Tools refuse a second goal and impossible transitions | ✅ | exact tool results, stored `blocked` |
| A11 | The objective reaches the model escaped | ✅ | captured request text |
| A12a | A paused goal survives a server restart unchanged | ✅ | stored goal identical before and after |
| A12b | An active goal cut off by a server death comes back paused | ✅ after #3 | stored `paused` with recovery note, then `complete` after resume |
| A12c | A location reload leaves a running goal active | ✅ | stored `complete` without user action |
| A12d | A location reload during a `plan` turn keeps that turn uncounted | ✅ after #10 | stored `tokensUsed: 0`, `emptyTurns: 0` |
| A13 | Deleting a session removes its goal | ✅ | no stored goal, exactly one `goal.changed` with `goal: null` |
| A16 | A goal follows its session to a new directory | ✅ after #11 | stored `directory` updated, then `complete` after resume there |
| L1 | The trace log records typed commands (refused ones too), transitions, and failed tool calls | ✅ | exact records read from `goal.jsonl` in the isolated data directory |
| L2 | `OPENCODE_GOAL_LOG=0` writes no log | ✅ | no `goal.jsonl` after the same scenario |
| H1 | A goal created through `opencode run --server` is finished by the server after the command exits | ✅ | real `opencode run --format json` and `opencode api` against the canary server, goal read through the `goal.get` RPC as `complete`, `a.txt`/`b.txt` contents, exactly 8 model requests |
| H2 | `opencode run --standalone` stops the goal after its first turn | ⚠️ known limitation | stored `active`, no `a.txt`/`b.txt`, fewer than 8 model requests. The command returns after its first turn and its private server exits with it |
| V1 | `--verify` refuses completion until the command exits 0 in the goal's directory | ✅ | first tool result names exit code 3 and the output, stored `complete` with `verifyFailures: 1`, `lastExitCode: 0` |
| V2 | Interrupting a running check kills the command and pauses the goal | ✅ | `late.txt` never written, stored `paused`, no failed check counted |
| A14 | The plugin installed from its package spec works | ✅ | stored `complete`. CI installs `github:<repo>#<commit under test>` |
| A15 | `goal.get` RPC returns the stored goal and `goal.changed` fires on each transition | ✅ | RPC output equals the `kv` row, events read from `/api/event` |
| A17 | A bare `/goal edit` sends the full objective to the terminal through `goal.editRequested`, and `goal.edit` saves the new one | ✅ | event payload read from `/api/event`, stored new objective with status kept, refusal notice without a goal |
| T1 | The line above the input shows running with usage, then paused, then nothing after clear | ✅ | real `opencode` terminal in tmux, screen text above the input |
| T2 | The line shows active between turns (`plan` agent), blocked, and budget reached | ✅ | same, with the stored status checked first |
| T3 | The sidebar shows the objective cut to three lines, and a typed `/goal edit` opens it in an editor that saves with `ctrl+s` and discards with `esc` | ✅ | screen text in tmux, stored objective after save and after discard |

T1, T2, and T3 start the real `opencode` terminal client against the canary server inside tmux, then read the line directly above the input with `tmux capture-pane`. CI runs them twice: once with the linked source, and once with the plugin installed from the commit under test (`tui-package`). The installed run caught a bug the linked run could not see. An installed package resolves `solid-js` to its own copy, which the host renderer does not track, so the line stayed empty. The status line now keeps its state in the host's `context.storage.memory` store and imports nothing from `solid-js`.

The canaries found three bugs, each fixed test-first: #1, #2, #3. A later code review found five more, fixed the same way: #9, #10, #11, #12, #13.

## Live models

`host/live/live.test.ts` runs the same harness against real providers, with all permissions allowed in the isolated config. Run on OpenCode 2.0.24, macOS arm64, 2026-10-06.

```sh
LIVE_MODEL="cli_proxy_google/gemini-3.8-flash#low" bun test ./host/live/live.test.ts
```

| Scenario | `devin/swe-2#medium` | `gemini-3.8-flash#low` | `opencode/nemotron-3.5-lightning-free` |
|---|---|---|---|
| L1 fix a failing test, complete with evidence | ✅ 19.3K tokens, 1 continuation | ✅ 66.6K, 3 | ✅ 72.5K, 2 |
| L2 one file per turn until three exist | ✅ 40.4K, 3 continuations | ✅ 107.1K, 3 | ⚠️ goal met (files correct, `complete`), but the model wrote all three files in one turn in both runs. In the first run its completion note claimed "Each file was created in a separate turn". |
| L3 stop at a 40K budget with one wrap-up | ✅ stopped at 54.9K | ✅ stopped at 55.3K | ✅ stopped at 61.5K |
| L4 pause, restart the server, resume, finish | ✅ 82.6K, state identical across restart | ✅ 115.3K, identical | ✅ 79.6K, identical (second run; the first hit a harness fetch timeout, since fixed) |

L1 is graded by running `bun test` ourselves (exit 0) and checking that `sum.test.ts` is byte-identical. L3 is graded on `budget_limited`, exactly one wrap-up message, and no continuation after it.

Sessions: swe-2 L1 `ses_eeef3b56bffeJg94Uk67o84d8R`, L2 `ses_eeef37efdffeu1K0UjBJqVu6S4`, L3 `ses_eeef333eeffeRXXMu16btlHRSh`, L4 `ses_eeef2bedaffe2vXZDZ6B380asx`. Gemini L1 `ses_eeef3b58affeqO6jV1DiOgpZms`, L2 `ses_eeef318b9ffeyAvsRVio8wQkeY`, L3 `ses_eeef2796effemwjMmKouR0L8j9`, L4 `ses_eeef21e99ffevfwjhnL8457yfN`. Nemotron L1 `ses_eeef3b570ffeKzh32XAL3i6PQ6`, L2 `ses_eeef1d153ffe4AsfzqeN9XYPBk` and `ses_eeeeade5affef3Kk6RUjaWd1E1`, L3 `ses_eeef11b59ffezTNeKOeXQ7Yuei`, L4 `ses_eeee9f9feffe8t7JmL3LXsFUXF`. The isolated data directories were deleted after each run, so these IDs identify runs in the results log, not sessions you can open.

## Budgets overshoot

The budget is checked when each model step ends, so the step that crosses it and the wrap-up turn still run. With 4,000-token steps, a 10K budget ends at 16K (A5). With real models and a 40K budget the goal ended between 54.9K and 61.5K (+37% to +54%). Set budgets well above the cost of one turn.

## Not established

| Surface | Status |
|---|---|
| `/goal` typed in the terminal UI | ⚠️ Not established. Canaries call the same command through `POST /api/session/:id/command`. The status line in the terminal is verified (T1, T2). |
| Status line in the desktop and web apps | ⚠️ Not established. They do not load terminal plugins. |
| Esc in the terminal UI during a running tool | ⚠️ Not established. The API interrupt is verified (A7a). |
| OpenCode versions other than 2.0.24 | ⚠️ Not established. |
| Windows | ⚠️ Not established. |
