# opencode-plugins

Every OpenCode plugin from `heliowap`, one per directory under `plugins/`. Install only the ones you want.

## Plugins

| Directory | Plugin ids | Description | Former repo |
| --- | --- | --- | --- |
| `base-check` | `base-check` | Tells an OpenCode session how stale its git base is, before the first prompt runs, without touching the working tree | `heliowap/opencode-v2-base-check` |
| `cliproxy-quota` | `cliproxy.quota.server`, `cliproxy.quota`, `cliproxy.quota.refresh` | Shows CLIProxyAPI 5-hour and weekly quota usage in the prompt footer and sidebar | `heliowap/opencode-v2-cliproxy-quota` |
| `goal` | `goal`, `goal.status`, `goal.controls` | Codex-style `/goal`: a persistent, audited objective that keeps a session working across turns | `heliowap/opencode-v2-goal-plugin` |
| `model-policy` | `model-policy` | Enforces the model route of delegated subagent work | `heliowap/opencode-v2-model-policy` |
| `model-routes` | `model-routes` | Restricts OpenAI and Anthropic models in the catalog to approved providers. Being merged into `model-policy`. | `heliowap/opencode-v2-model-routes` |
| `protect-agents-md` | `protect-agents-md` | Denies agent edits to the global `AGENTS.md` until the user approves them | `heliowap/opencode-v2-protect-agents-md` |
| `redact-secrets` | `redact-secrets` | Masks secrets in tool results and errors | `heliowap/opencode-v2-redact-secrets` |
| `tps-meter` | `tps.meter.server`, `tps.meter` | Shows a live tokens-per-second meter in the prompt footer | `heliowap/opencode-v2-tps-meter` |
| `unpushed-work` | `local.unpushed-work` | After each successful turn, reports uncommitted and unpushed work across local repositories | local `~/.config/opencode/plugins` |

## Install

Interactive (pick from a numbered list, then confirm):

```sh
./install.ts
```

Non-interactive:

```sh
./install.ts --all
./install.ts goal tps-meter
./install.ts --dry-run --all   # print the commands, run nothing
```

The installer runs `opencode plugin add` for each plugin and keeps going if one fails. It prints a summary and exits 1 if any install failed. An unknown name exits 2 and installs nothing. With no arguments and no TTY it prints usage and exits 2.

`OPENCODE_PLUGINS_INTERACTIVE=1` forces the interactive prompt when stdin is not a TTY. It exists for the tests only.

Manually, one plugin at a time:

```sh
opencode plugin add 'github:heliowap/opencode-plugins#main::path:plugins/<name>'
```

Or list the specs in your OpenCode config:

```json
{
  "plugins": [
    "github:heliowap/opencode-plugins#main::path:plugins/goal",
    "github:heliowap/opencode-plugins#main::path:plugins/tps-meter"
  ]
}
```

## Development

```sh
cd plugins/<name> && bun install && bun test
```

Root checks (installer and CI matrix):

```sh
bun install --frozen-lockfile && bun run typecheck && bun test ./test
```

CI runs the root checks on every change. Each plugin job runs only when files under `plugins/<name>/` change. A change to the workflow or `scripts/ci-matrix.ts` runs all of them.

## Issues

File issues in this repository with a `plugin:<name>` label, for example `plugin:goal`.
