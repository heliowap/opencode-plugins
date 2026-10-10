# opencode-v2-protect-agents-md

An OpenCode v2 plugin that stops agents from editing your global `AGENTS.md`
(`$XDG_CONFIG_HOME/opencode/AGENTS.md`, by default `~/.config/opencode/AGENTS.md`)
without your explicit approval.

## Behavior

- **Denied by default.** The plugin denies:
  - `edit` permissions (edit, write, patch) whose target resolves to the global
    `AGENTS.md`, including relative paths, `~` paths and symlinks;
  - shell commands whose text names `AGENTS.md` together with the config
    directory (absolute path, `~/.config/opencode`, `$HOME/.config/opencode` or
    `$XDG_CONFIG_HOME/opencode`), or that name `AGENTS.md` while running with
    the config directory as working directory.

  The denial message tells the agent to ask you first.
- **Approval.** The agent must ask through the question tool, with exactly
  this question: "Do you want to proceed with editing the global AGENTS.md?".
  Only the answer `Yes` (that option alone, not a custom answer) unlocks edits.
- **Scope of the approval.** It applies to that session only and lasts until
  your next message in it.
- **Works with `session.permissions: autoaccept`.** The plugin denies instead
  of asking, so an auto-accepting client cannot approve the edit for you.

## Limitations

- Shell matching is textual. Read-only shell commands that name the file (for
  example `cat ~/.config/opencode/AGENTS.md`) are denied too; use the read tool
  instead, which is not affected.
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
