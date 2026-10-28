# model-routes merged into model-policy: measured behavior before the merge

Base: `origin/main` `6f3c527`. OpenCode v2.2.0, bun 1.4.3.

## Isolation

`plugins/model-policy/host/harness/host.ts` starts `opencode serve` with `HOME`, `XDG_CONFIG_HOME`,
`XDG_DATA_HOME`, `XDG_CACHE_HOME` and `XDG_STATE_HOME` pointing into a fresh temp root, writes its own
`config/opencode/opencode.jsonc`, and drops `CLIPROXY_URL` and `CLIPROXY_MANAGEMENT_KEY` from the inherited
environment. `~/.config/opencode/` is not read. `sha256(~/.config/opencode/opencode.jsonc)` was
`1d043d2749e163a01a75d437803705976cad115f391d2d570fa6e81ac798ec30` before the runs.

## Setup under test

`host/routes.test.ts` (pre-merge form) loads `plugins/model-policy/src` and
`plugins/model-routes/src/index.ts` as an extra plugin. The live setup lists `model-policy` before
`model-routes` in `opencode.jsonc` `plugins`. The host loads its plugins from the config `plugins/` directory;
`GET /api/plugin` shows the load order, and the extra plugin is linked as `model-routes.ts` so it sorts after
`model-policy`:

```
model-routes.ts      local order: ["plugins/model-policy", "plugins/model-routes.ts"]
aa-model-routes.ts   local order: ["plugins/aa-model-routes.ts", "plugins/model-policy"]   (control, reversed)
```

## Results

| case | policy first (live order) | routes first (control) |
| --- | --- | --- |
| (a) `general` asks for `anthropic/claude-sonnet-5-5` | rejected: `anthropic/claude-sonnet-5-5 is user-only: only the user selects Anthropic API models in /models. Dispatch the subagent without this model.` No child call. | same |
| (b) `implementer` asks for `anthropic/claude-sonnet-5-5` | **rewritten and accepted**: the child ran on `cli_proxy/cpa-claude-haiku-5-5#medium`, the subagent result is `state="completed"`, no `user-only` error. | rejected with the same user-only message; no child call |
| (c) catalog | see below | |

**(b) depends on hook order.** model-policy's `execute.before` replaces `input.model` with the policy route
before model-routes' hook runs, so model-routes sees `cli_proxy/cpa-claude-haiku-5-5#medium`, which is not
`anthropic/*`. With model-routes first the request is rejected. The live order is policy first, so the
behavior to preserve is: a policied agent that asks for an Anthropic API model is silently routed, not rejected.

### (c) catalog

`anthropic` is activated with a placeholder model; the built-in models come from the bundled snapshot.

- `model-policy` alone: 21 `anthropic/*` models in `/api/model` (20 built-in plus the placeholder).
- `model-policy` then `model-routes`: `anthropic/*` is exactly `claude-sonnet-5-5`, `claude-haiku-5-5` and the
  placeholder. `cli_proxy/cpa-claude-{haiku,sonnet,opus}-5-5` and `openai/gpt-6.1-sol` (allowed provider) stay.
  No remaining model from a non-allowed provider has an `openai/` or `anthropic/` id or a `gpt*` / `claude*`
  family.
- Models defined in `opencode.jsonc` survive `editor.remove`; only built-in snapshot models are removed. The
  test therefore activates providers with non-vendor placeholders and asserts on the built-in models.

Command: `cd plugins/model-policy && bun test ./host/routes.test.ts` → 3 pass, 0 fail.
