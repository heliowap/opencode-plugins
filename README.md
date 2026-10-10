# opencode-v2-protect-agents-md

An OpenCode v2 plugin that stops agents from editing any `AGENTS.md` without
your explicit approval: the global one (`~/.config/opencode/AGENTS.md`) and
every repo's, including creating a new one.

## Behavior

- **Denied by default.** The plugin denies:
  - `edit` permissions (edit, write, patch) whose target file is named
    `AGENTS.md` in any letter case, in any directory, including relative paths,
    `~` paths, symlinks and files that do not exist yet;
  - shell commands whose text mentions `AGENTS.md` in any letter case.

  The denial message tells the agent to ask you first.
- **Approval.** The agent must ask through the question tool, with exactly
  this question: "Do you want to proceed with editing AGENTS.md?".
  Only the answer `Yes` (that option alone, not a custom answer) unlocks edits.
- **Scope of the approval.** It applies to every `AGENTS.md` in that session
  only, and lasts until your next message in it.
- **Works with `session.permissions: autoaccept`.** The plugin denies instead
  of asking, so an auto-accepting client cannot approve the edit for you.

## Limitations

- Shell matching is textual. Read-only shell commands that name the file (for
  example `cat AGENTS.md` or `git diff AGENTS.md`) are denied too; use the read
  tool instead, which is not affected. `git add -A` and `git status` do not name
  the file and are not affected.
- Commands such as `/init` that create or update `AGENTS.md` also need your
  `Yes`.
- Scripts that build the path indirectly (variables, string concatenation,
  another script) are not detected.

## Install

Add the plugin to your OpenCode config:

```jsonc
{
  "plugins": ["github:heliowap/opencode-v2-protect-agents-md"]
}
```

If you already have a local copy (for example in
`~/.config/opencode/plugins/`), remove it so the plugin does not load twice.

## Development

```sh
bun install
bun run typecheck
bun test
```

The tests start a real `opencode serve` against a scripted model fixture, so
`opencode` must be on your `PATH` (or set `OPENCODE_BIN`).

## License

MIT
