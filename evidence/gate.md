# Migration gate (P7)

The checks ran on `main`. Steps 1–4 ran at `f199ca7`. Steps 5–6 ran at `d5dd514`, which changes only `scripts/trial-install.sh`.

| # | Check | Result | Exit |
|---|---|---|---|
| 1 | `ls plugins` | Exactly `base-check cliproxy-quota goal model-policy protect-agents-md redact-secrets tps-meter unpushed-work` | 0 |
| 2 | Every sha in `evidence/subtree-imports.tsv` is an ancestor of HEAD | No `FAIL` lines, all 8 pass. model-routes `6cc8362` is still reachable after the merge | 0 |
| 3 | Plugin ids | `goal`, `redact-secrets`, `protect-agents-md`, `model-policy`, `tps.meter.server`, `cliproxy.quota.server`, `base-check` and `local.unpushed-work` are all present. `model-routes` is absent | 0 |
| 4 | CI on `main` | [Run 40744551184](https://github.com/heliowap/opencode-plugins/actions/runs/40744551184): success on the first attempt | 0 |
| 5 | `scripts/trial-install.sh main <all 8>` | `TRIAL OK base-check cliproxy-quota goal model-policy protect-agents-md redact-secrets tps-meter unpushed-work live-config-unchanged 1d043d2749e163a01a75d437803705976cad115f391d2d570fa6e81ac798ec30` | 0 |
| 6 | `./install.ts --dry-run --all \| wc -l` | `8`, and every plugin directory is named in `README.md` | 0 |

The first run of step 5 exited 1 with a timeout. The script waited for plugin ids equal to the directory names, but `tps.meter.server`, `cliproxy.quota.server` and `local.unpushed-work` differ from their directories. `d5dd514` makes the script match on the installed spec (`source.target`) instead. After that change, all 8 plugins report `active`, each at version `f199ca7`.

`goal-host (tui-package)` failed once on PR #2 at test T6 and passed when the failed jobs were rerun. The test is flaky. The old goal repo's last 20 CI runs also include 5 failures.
