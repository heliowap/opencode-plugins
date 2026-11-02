# Goal issue verification

The checks below ran against commit `78d516876fa0a98b149e0e10e8d7ad6b98b3fe1c`
on 2026-11-02. Both acceptance criteria remain open.

## Issue #5

An isolated goal session using `cli_proxy/cpa-claude-haiku-5-5` was instructed
to follow a 12-file chain with one read per tool call. The goal completed.
Fourteen assistant steps reported 162,010 cache-read tokens out of 178,583
total input, a window hit ratio of 0.9072.

Cache reads rose from 0 to 13,782 across the first 13 steps, then fell to 9,415
on the final step. The measurement did not capture whether the last step ran
after the goal was completed. The required step-by-step growth is therefore
not established.

## Issue #16

With OpenCode 2.2.5 and Bun 1.4.3 on macOS, the installed-package T6 test ran
with `GOAL_PLUGIN_SPEC` set to
`github:heliowap/opencode-plugins#78d516876fa0a98b149e0e10e8d7ad6b98b3fe1c::path:plugins/goal`.

```sh
bun test ./host/tui.test.ts -t T6 --rerun-each=20 --bail=1
```

Four runs passed. The fifth failed while reopening the goal controls after
setting the token budget. The captured screen showed the badge, but not the
expected `Pause goal` option. The run stopped at the first failure, so the
required 20 consecutive passes were not achieved.
