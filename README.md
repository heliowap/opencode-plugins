# opencode-v2-model-policy

OpenCode 2 plugin that enforces which model a subagent runs on, per agent, with
provider fallback.

The parent session can pass any `model` to the `subagent` tool. For agents with a
policy, the plugin replaces it with the policy route, so a delegated agent always
runs where you decided it should.

## Policy

| Agent | Routes, in order |
| --- | --- |
| `researcher`, `explore` | `openai/gpt-6.1-sol#low` → `cli_proxy_openai/gpt-6.1-sol#fast-low` → `cli_proxy/cpa-claude-opus-5-5#low` |
| `planner` | `cli_proxy/cpa-claude-opus-5-5#high` |

Every other agent keeps the model the parent chose. Routes are defined in
[`src/policy.ts`](src/policy.ts).

- A route missing from the model catalog, or lacking the effort variant, is
  skipped. If no route is left, the dispatch fails instead of using another model.
- A route uses the `fast-<effort>` variant when the catalog offers it and the
  policy prefers fast mode (research routes do; the planner does not).

## Fallback

A provider failure (rate limit, quota, auth, transport, timeout, missing route,
provider error) on a foreground dispatch retries once on the next route. A route
that failed is moved to the back for 10 minutes.

- Rate-limit and quota failures skip OpenCode's own retries when another route
  is available, so fallback happens in seconds instead of minutes.
- Task failures (invalid request, content filter, tool errors) and cancellation
  are returned to the parent unchanged.
- Background dispatches return immediately, so they cannot fall back in the
  same call. Their provider failure still demotes the route, and the next
  dispatch starts on the next route.

Each result carries `metadata.modelPolicy`: the agent, the requested model, the
skipped routes and every attempt with its outcome. Prompts are never recorded.

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
