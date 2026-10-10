# opencode-v2-model-policy

OpenCode 2 plugin that enforces which model a subagent runs on, per agent, with
provider fallback.

The parent session can pass any `model` to the `subagent` tool. For agents with a
policy, an `execute.before` hook replaces it with the policy route, so a delegated
agent always runs where you decided it should. The plugin does not wrap the
`subagent` tool itself: in OpenCode 2.0.25 a wrapped tool reports the wrong error
for parallel calls that fail.

## Policy

| Agent | Routes, in order |
| --- | --- |
| `researcher`, `explore` | `cli_proxy/cpa-claude-sonnet-5-5#medium` → `cli_proxy/cpa-claude-opus-5-5#low` |
| `planner` | `cli_proxy/cpa-claude-opus-5-5#high` |

Every other agent keeps the model the parent chose. Routes are defined in
[`src/policy.ts`](src/policy.ts).

- A route missing from the model catalog, or lacking the effort variant, is
  skipped. If no route is left, the dispatch fails instead of using another model.

## Fallback

A provider failure (rate limit, quota, auth, transport, timeout, missing route,
provider error) moves the failed route to the back for 10 minutes. The failure
is returned to the parent, and its next dispatch of that agent starts on the
next route. This works the same for foreground and background dispatches.

- Rate-limit and quota failures skip OpenCode's own retries when another route
  is available, so the failure reaches the parent in seconds instead of minutes.
- Other provider errors (5xx, transport) keep OpenCode's retries, about 80
  seconds, before the route is demoted.
- Task failures (invalid request, content filter, tool errors) and cancellation
  do not demote the route.

Each successful result carries `metadata.modelPolicy`: the agent, the requested
model, the chosen route, the skipped routes and the demoted routes. Prompts are
never recorded.

## Coverage

The plugin wraps the `subagent` tool. These paths create child sessions without
it and are not enforced:

- Commands with `subagent: true` (or whose agent has `mode: subagent`). They use
  the command's `model`, then the agent's default model.
- Background subagents resumed after a server restart.

Set each agent's default `model` to its first route so these paths start on the
right model.

## Install

```sh
git clone https://github.com/heliowap/opencode-v2-model-policy
cd opencode-v2-model-policy
bun install
ln -s "$PWD/src" ~/.config/opencode/plugins/model-policy
```

Check that it is active:

```sh
opencode api get /api/plugin
```

## Development

```sh
bun test            # policy and failure classification
bun run typecheck
bun test ./host     # starts real `opencode serve` instances against fixture providers
```

The host tests need the `opencode` binary on `PATH` (or `OPENCODE_BIN`). They
were written against OpenCode 2.0.25. Tests that load your global plugins or the
`code-review` skill are skipped when those files are missing.

## License

MIT
