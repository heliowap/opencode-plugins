# cold-read

An OpenCode v2 plugin that makes agents ask the user self-contained questions.

Agents tend to ask terse questions full of session jargon ("Remove the gate?",
"#996 step 4?"), which costs the user a round of questions back before they
can decide. This plugin works on the built-in `question` tool:

- **Rejects a terse question once.** A question under 150 characters is
  rejected with a *cold read* checklist (the decision and why it blocks, the
  verified current state with terms and IDs explained, each option's
  consequence, and a recommendation), so the agent rewrites it before the user
  sees it. Resubmitting the identical input in the same session passes, so
  fixed-text questions required by other tools (such as `protect-agents-md`'s
  approval question) still reach the user.

The plugin leaves the `question` tool's definition untouched: changing it with
`tool.transform`, even only its description, stops the TUI from drawing the
question form (reproduced on OpenCode 2.2.7). Put standing guidance on how to
ask in your `AGENTS.md` instead.

## Install

```sh
opencode plugin add 'github:heliowap/opencode-plugins#main::path:plugins/cold-read'
```

## Development

```sh
bun install
bun run typecheck
bun test
```

The host tests start a real `opencode serve` against a scripted model fixture,
so `opencode` must be on your `PATH` (or set `OPENCODE_BIN`).
`COLD_READ_HOST_KEEP=1` keeps each host's temp directory.

## License

MIT
