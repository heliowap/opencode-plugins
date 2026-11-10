# protect-agents-md

Formerly `heliowap/opencode-v2-protect-agents-md`.

An OpenCode v2 plugin that stops agents from editing any `AGENTS.md` without
your explicit approval: the global one (`~/.config/opencode/AGENTS.md`) and
every repo's, including creating a new one.

For Cursor Agent CLI, Codex CLI, and Claude Code on macOS, use the
[process launcher](docs/process-guard.md). It rejects local protected writes
for the entire process tree. Unlike the OpenCode plugin, it has no temporary
approval or in-session unlock. The Cursor IDE is not covered.

## Run a protected CLI on macOS

Install Bun and the client CLI. Run the launcher from your working project,
using the absolute path to this checkout's entry point.

```sh
bun /path/to/opencode-plugins/plugins/protect-agents-md/bin/protect-agents.ts --client cursor
bun /path/to/opencode-plugins/plugins/protect-agents-md/bin/protect-agents.ts --client codex
bun /path/to/opencode-plugins/plugins/protect-agents-md/bin/protect-agents.ts --client claude
```

Put client arguments after `--`. Use `--binary` for a custom executable.
Use repeated `--protect` arguments for additional physical files or existing
symlinks whose targets have ordinary names.

```sh
bun /path/to/opencode-plugins/plugins/protect-agents-md/bin/protect-agents.ts --client codex --protect ./nested/AGENTS.md -- --model gpt-6.1-sol
```

The launcher does not install hooks or change your global configuration.
To edit a protected file, use an editor outside the launched process tree.
There is no automatic approval based on an agent's answer.

## OpenCode behavior


- **Denied by default.** The plugin denies:
  - `edit` permissions (edit, write, patch) whose target file is named
    `AGENTS.md` in any letter case, in any directory, including relative paths,
    `~` paths, symlinks and files that do not exist yet;
  - shell commands whose text shows a write to a file named `AGENTS.md` in
    any letter case: a redirect (`>`, `>>`, `&>`, `<>`) or `--output`/`-o`
    option targeting it, `tee`, `mv`, `cp`, `rm`, `ln`, `touch` and similar
    writers, `sed -i`/`perl -i`, sed `w` scripts, `git checkout`/`restore`/
    `rm`/`mv`/`apply`/`stash`/`reset`, `find -exec`/`-delete`, and inline
    script lines that call a file-writing API on that path.

  The denial message tells the agent to ask you first.
- **Approval.** The denial message tells the agent to call the question tool
  with a ready-made input that names the target (the file it resolves to,
  or the shell command, whose head and tail are kept when it exceeds 300
  characters) and a `<change>` slot the agent fills with what the edit
  changes and why:

  ```text
  Stop and call the question tool with this input, replacing <change> with what the edit changes and why, then retry only if the answer is "Yes":
  {"questions":[{"header":"AGENTS.md edit","question":"Do you want to proceed with editing AGENTS.md? File: /path/to/AGENTS.md. Change: <change>","options":[{"label":"Yes","description":"apply the edit"},{"label":"No","description":"leave it unchanged"}]}]}
  Keep the question's first sentence and target as written. If you cannot use the question tool, report this to your parent.
  ```

  Only the answer `Yes` (that option alone, not a custom answer) unlocks
  edits, only with the header and options shown above, and only to one of
  two questions: the bare "Do you want to proceed
  with editing AGENTS.md?", or exactly the question the plugin issued for a
  target in that session since your last message, with `<change>` replaced
  by one line of up to 500 characters. Any other text after the first
  sentence keeps edits denied, so the agent cannot reframe what your `Yes`
  answers. Line breaks, bidi overrides, terminal escapes and other invisible
  characters are shown as `\u{…}` escapes in the target and rejected in the
  change, which also rejects runs of whitespace and blank-looking
  characters. The plugin does not check that the change describes the edit
  truthfully, and a long command cut in the middle can hide a write placed
  there; the ` … ` marks the cut.
- **Scope of the approval.** It applies to every `AGENTS.md` in that session
  only, and lasts until your next message in it.
- **Works with `session.permissions: autoaccept`.** The plugin denies instead
  of asking, so an auto-accepting client cannot approve the edit for you.
- **Shell reads.** Every other command runs, including chains such as
  `cd repo && git log -- AGENTS.md`, `find . -name AGENTS.md`, and queries
  that mention the name as data. Commands are tokenized, so a writer word or
  the name inside a quoted argument (a grep pattern, an echo string) does not
  count: only a writer's own arguments, a write API's path expression, or a
  redirect target can name the file. Wrappers that run another command are
  unwrapped (`sudo`, `env`, `nice`, `timeout`, `chroot`, `flock`, `taskset`,
  `busybox`, `setsid`, `unshare`, `nsenter`, `systemd-run`, `firejail`,
  `parallel`, `runuser`, `setpriv`, `chrt`, `numactl`, `prlimit`, `setarch`,
  `bwrap`, `proot`, `strace`, `valgrind`, `fakeroot`, `eatmydata`, `perf`,
  `screen`, `time` and similar), and commands carried inside arguments are
  judged again: an `eval` line, a shell's `-c` string, the command `xargs`
  runs, `flock -c`, the shell command of an executing `tmux` subcommand, and
  `ssh -o` values that execute locally (`ProxyCommand`,
  `LocalCommand`). The remote command of `ssh` is not inspected, since it
  writes on another machine. A `VAR=value` word assigns only in command
  position or through an assignment builtin such as `export`, and a write
  API's path expression counts an identifier the same script assigns
  `AGENTS.md` to, including through a `Path('...')`-style call or a dict or
  list literal a subscript reads. A heredoc body counts only when the
  receiving command executes stdin — a shell, `su`, `newgrp`, `ssh`, an
  interpreter or wrapper that defaults to a shell, `at`/`batch`, or a later
  pipeline stage — or feeds `eval`, kept for parity with the fallback scan;
  it does not count when a data sink such as `cat` consumes it, nor when
  the receiver already has its program in argv (a `-c` string or a
  script file). Pipeline output feeding such a command is judged as
  commands too. If a command cannot be parsed the match falls back
  to a textual scan, and a write whose target the text does not show (a
  path computed at runtime, a script file) is not caught either way; use
  the process guard for that.
  A recognized read does not override other OpenCode permission rules or
  approve later writes.

## OpenCode limitations

- Shell matching parses each command and falls back to a textual scan when
  parsing fails. It is not a shell sandbox. It assumes standard executables
  and trusted inherited environment and configuration. Git diff helpers and
  text conversion can run configured programs.
- The command-executor list is a best-effort denylist, not a sandbox: an
  exhaustive list is impossible, and a write launched through an executor
  it does not know passes. Known gaps in that class include `sg`, `pwsh`,
  `yash`, `env -S`, `sudoedit`, `scp`, `curl -o`, `git clean`,
  `xargs -I{} sh -c {}`, a command hidden behind a substitution or variable
  (`$(which rm)`, `$x` as argv0), `printf -v` bindings, `for`-loop
  variables, and write APIs the script matcher does not model (such as
  `fs.truncateSync`). The process guard denies these at syscall level.
- Commands such as `/init` that create or update `AGENTS.md` also need your
  `Yes`.
- Scripts that build the path indirectly (variables, string concatenation,
  another script) are not detected.

## Install the OpenCode plugin

Add the plugin to your OpenCode config:

```jsonc
{
  "plugins": ["github:heliowap/opencode-plugins#main::path:plugins/protect-agents-md"]
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

Native process-enforcement tests run on macOS. Other systems skip that group.
The outbound-network assertion also requires `/usr/bin/python3` on macOS.
The [opt-in client tests](docs/process-guard.md#verification) require the
installed client CLIs and Python 3. They use disposable homes and loopback
model responses, not cloud models or real credentials.

## License

MIT
