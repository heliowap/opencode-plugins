# unpushed-work

An OpenCode plugin (id `local.unpushed-work`) that reports work which exists only on
this machine.

## What it does

After each successful root-session turn, it writes a report of uncommitted or
unpushed work in the repositories under `~/VSCode` and `~/.codex/worktrees` to:

```
${XDG_STATE_HOME:-~/.local/state}/opencode-unpushed-work/last-report.txt
```

It injects nothing into the model. Each report overwrites the previous one. Read
the file at handoff, or run the CLI directly (below).

The report covers uncommitted and untracked paths, detached HEAD commits on no
branch or remote, local branches with commits on no remote (including branches
with no upstream), branches ahead of their upstream, and repositories git cannot
read.

## Install

```sh
opencode plugin add 'github:<owner>/opencode-plugins#main::path:plugins/unpushed-work'
```

Replace `<owner>` with the GitHub owner of this repository.

## Run the CLI by hand

```sh
bin/unpushed-work
bin/unpushed-work --since 2026-10-15T00:00:00-03:00
```

The CLI prints one line per risk; clean repositories print nothing. `--since`
(ISO 8601) also reports how many evidence files under
`${XDG_DATA_HOME:-~/.local/share}/opencode/evidence` changed after that time. This
line is informational and never affects the exit status.

Exit codes: `0` no repository risk found, `1` risks or unreadable repositories,
`2` invalid arguments.

The checker is read-only: it performs no fetch, index refresh, stash, commit, push,
checkout or repository write, and runs Git with `--no-optional-locks`.

## Limits

- **Trigger.** The plugin runs only after a successful root-session turn. Failed or
  interrupted turns, application shutdown and machine crashes do not trigger it.
- **Delivery.** The report is a file. It is not a visible TUI warning or a backup.
  A notification or a handoff rule that reads the report is not implemented.
- **Discovery.** It covers main checkouts, OpenCode worktrees, direct and
  one-level-nested Codex worktrees, and every worktree registered to each
  discovered repository. Other nested repositories are not found.
- **Remote state.** All remote claims use local remote-tracking refs as of the last
  fetch. Server-side existence is not checked, and the scan is not an atomic
  snapshot while other processes modify repositories.
- **No-upstream branches.** A branch with no upstream is reported only when it has
  commits reachable from no remote-tracking ref. This detects local-only content,
  not missing tracking configuration alone. Owner acceptance of this filter is
  still needed.
- **Broken repositories.** They report `cannot inspect` without suppressing other
  results.

## Development

```sh
bun install
bun run typecheck
bun run test
```

`test/script.test.ts` checks that the script path resolves inside the package and is
executable. `test/test_unpushed_work.py` exercises the CLI against disposable
repositories, bare local remotes and linked worktrees.
