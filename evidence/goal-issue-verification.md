# Goal issue verification

These checks ran on 2026-11-02.

## Issue #5

At `78d516876fa0a98b149e0e10e8d7ad6b98b3fe1c`, an isolated goal session using
`cli_proxy/cpa-claude-haiku-5-5` reported a 0.9072 window hit ratio. Its last
step's cache read fell, but the measurement did not capture the goal status at
each step.

At `54fa08ad7ec6a4a9031e24695e0ac5ca96fdfb5e`, another isolated session on
the same model followed a 12-file chain. This time, `rpc.goal.changed` and
`session.step.ended` events identified steps observed while the goal was active.
The 12 active steps in the first turn had strictly increasing cache reads:
6,214; 11,610; 11,766; 11,859; 11,952; 12,045; 12,138; 12,231; 12,324;
12,417; 12,510; 12,603.

The full goal window contained 14 assistant steps and 161,782 cache-read tokens
out of 169,850 total input tokens, a 0.9525 hit ratio. The goal completed.
The measurement script is `evidence/goal-cache-check.ts`; running it requires
the configured live provider and may incur model charges.

## Issue #16

At `78d516876fa0a98b149e0e10e8d7ad6b98b3fe1c`, with OpenCode 2.2.5 and Bun
1.4.3 on macOS, the installed-package T6 test ran
with `GOAL_PLUGIN_SPEC` set to
`github:heliowap/opencode-plugins#78d516876fa0a98b149e0e10e8d7ad6b98b3fe1c::path:plugins/goal`.

```sh
bun test ./host/tui.test.ts -t T6 --rerun-each=20 --bail=1
```

Four runs passed. The fifth failed while reopening the goal controls after
setting the token budget. The captured screen showed the badge, but not the
expected `Pause goal` option. The run stopped at the first failure, so the
required 20 consecutive passes were not achieved.

At `54fa08ad7ec6a4a9031e24695e0ac5ca96fdfb5e`, dismissing the onboarding
panel before clicking did not fix the failure: five runs passed and the sixth
failed while opening the controls for the first time. That test change was
discarded.

An instrumented local probe found that spinner updates repeatedly destroyed
and recreated the clickable badge. In a 200-click sample, five clicks hit no
element; after isolating the badge in a component, all 200 reached the same
element. The new T9 host test failed before the fix and passed after it.
Twenty consecutive installed-package T6 runs after the fix remain outstanding.
