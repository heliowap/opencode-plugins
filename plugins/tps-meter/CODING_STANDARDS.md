# Coding standards

## Architecture

- `src/meter.ts` holds every rule as pure functions: `record` folds one session event into the meter, `reading` returns the value to show at a given time, and `label` formats it. It does no I/O and takes `now` as an argument.
- `src/tui.tsx` is a thin adapter. It subscribes to OpenCode events, calls the functions above, and renders the `prompt.footer.status` slot. Keep logic out of it.
- `index.ts` and `tui.tsx` at the root are entry points. `src/index.ts` is an empty server plugin because OpenCode loads a package's TUI entry only when the package also has a server entry.
- Exact readings use server timestamps (`session.step.started` `data.started` and `session.step.streamed` `created`) so they match OpenCode's built-in footer. Live readings use the client's clock because delta events are compared with `Date.now()`.

## Style

- Prefer `const` and early returns.
- Do not alias imports or use star imports.
- Avoid `any`, casts, and `try`/`catch`.
- Comments explain a non-obvious why. Do not narrate the code.
- All user-visible text is English.

## Tests

- Write the failing test first, run it to see it fail, then implement.
- Test through `record`, `reading`, and `label`, the way `src/tui.tsx` calls them, and assert literal values.
- Do not mock.
- `bun test` and `bun run typecheck` pass before every commit. `bunfig.toml` fails `bun test` below 95% line or function coverage.

## End-to-end check

Unit tests cannot see the TUI. After changing `src/tui.tsx`:

1. In a temporary git repository with one commit, write an `opencode.jsonc` whose `plugins` lists this directory.
2. If your global config also lists the published plugin, OpenCode loads that copy and marks this directory's copy as failed in `/plugins`. Point `XDG_CONFIG_HOME` at a scratch copy of your config without that entry, and confirm `/plugins` shows `tps.meter` as `local`.
3. Start `opencode --standalone` inside `tmux` and send a prompt that produces a few hundred words, then one that runs two tool calls before answering.
4. Read the footer with `tmux capture-pane -p`. While streaming it shows `~N tok/s`; when the turn ends it shows the same `N.N tok/s` as the assistant footer.
