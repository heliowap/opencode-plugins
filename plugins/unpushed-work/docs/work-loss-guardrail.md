# Work-loss guardrail

## Implemented: item 2

Run `bin/unpushed-work`.
Optional evidence inventory:

```sh
bin/unpushed-work --since 2026-10-15T00:00:00-03:00
```

The CLI prints one line per risk; clean repositories print nothing. Exit 0 means
no repository risk found; 1 means risks or unreadable repositories; invalid CLI
arguments exit 2. Evidence counts are informational and do not affect exit status.
Untracked directories count as paths, not individual files. No file contents are
printed. Status and branch checks run in parallel but results retain discovery
order. No fetch, index refresh, stash, commit, push, checkout or repository write
is performed by the checker; Git runs with `--no-optional-locks`.

Discovery covers main checkouts, OpenCode worktrees, direct and one-level-nested
Codex worktrees, then every worktree registered to each discovered repository.
Arbitrary nested repositories not reachable through these locations are outside
this first version. Broken candidates report `cannot inspect` without suppressing
the other results. Detached HEAD commits on no branch or remote are also reported.

**Interpretation:** a no-upstream branch is reported when it has commits reachable
from no remote-tracking ref. An alias whose commits already exist on a remote is
not reported. This detects local-only *content*, not missing tracking configuration
alone. All remote claims mean **local remote-tracking refs as of the last fetch**;
server-side existence is not checked. The scan is not an atomic snapshot while
other workers are modifying repositories.

### Wiring and its limits

`src/index.ts` is the plugin entry point, installed with `opencode plugin add`
(see the README). It subscribes to `session.execution.succeeded`, excludes child
sessions, and filters to the session's own location because each location's
plugin instance receives the server-wide event stream. It runs after a
**successful root-session turn**, not application shutdown. Failed or interrupted
turns and machine crashes do not trigger it. Multiple successful turns in the same
location are processed by the stream in order. Reports overwrite the previous snapshot.

Output: `${XDG_STATE_HOME:-$HOME/.local/state}/opencode-unpushed-work/last-report.txt`.
Read this file at handoff, or run the CLI directly. **This is not a visible TUI
warning or a backup.** A UI notification or a handoff rule that reads the report is
a proposed follow-up, not implemented here; no verified notification interface was
used. Private evidence remains only on the machine where the plugin runs.

Verified against OpenCode v2.0.29 via CLI help, installed SDK event definitions,
`opencode api plugin.list` (`local.unpushed-work`, state `active`), and real
`opencode run` probe sessions. A probe header looks like this:

```text
# 2026-10-16T00:47:29.100Z session=<session-id> since=2026-10-16T00:47:19.517Z exit=1 (remote state from local refs, no fetch)
```

Sources read:
- https://opencode.ai/v2/docs/plugins (global discovery and automatic reload)
- https://opencode.ai/v2/docs/build/plugins (event subscription and cleanup)
- Installed `@opencode/schema/dist/session-event.js` (execution events)
  and `session-status-event.js` (`session.idle` is deprecated).

### Verification

```sh
cd plugins/unpushed-work
python3 -m unittest discover -s test -p 'test_unpushed_work.py' -v
```

Result: `Ran 12 tests`, `OK`. Tests exercise the CLI against disposable
repositories, bare local remotes and linked worktrees, never real repositories.
The red/green iterations caught missing status, ahead/no-upstream/gone
tracking, linked-worktree, evidence, detached-HEAD and broken-repository behavior.

### Review

Standards and Spec reviews were run independently against the code and test
files. Standards found a blocking all-or-nothing crash on a broken repository;
it was fixed and regression tested. Follow-up fixes added detached-HEAD coverage,
invalid-time validation, accurate `path(s)` wording, correct timeout status,
continued listening after a session lookup failure, and the local-ref caveat in
plugin headers. Remaining limitations are the successful-turn-only trigger,
report-file-only delivery, the no-upstream interpretation above, last-report
overwrite, and the absence of automated plugin tests at review time (the plugin
was verified with real sessions). Plugin tests for the entry point are not yet
present; `test/script.test.ts` covers only the script path.

Final independent re-review: Standards approved with 0 BLOCKING, 1 WARNING
(no automated plugin tests), 3 NITs. Spec: 0 BLOCKING, 0 WARNING, 3 NITs
(CLI-only local-ref caveat visibility, successful-turn/file-only wiring, no-upstream
interpretation requiring owner acceptance). No required blocking fix remained.
The content-based no-upstream filter still needs owner acceptance.
