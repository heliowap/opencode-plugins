// Shell commands are flagged only when they show a write to an AGENTS.md file; every other
// command runs. The command is tokenized with quote and heredoc awareness and each simple
// command is judged on its own argv: a writer word or an AGENTS.md mention inside a quoted
// argument of another tool (a grep pattern, an echo string, an ssh remote command) does not
// count, and a write API in a script line counts only when its path expression names the file.
// When the text cannot be lexed, the textual scan at the bottom decides instead. Writes hidden
// behind indirection the text does not show (a path computed at runtime, a script file) are out
// of scope here; the process guard covers those.
const FILE = String.raw`(?:[^\s;&|<>()'"]*/)?agents\.md(?![^\s;&|<>()'"])`
const TARGET = String.raw`(?:"(?:[^"]*/)?agents\.md"|'(?:[^']*/)?agents\.md'|${FILE})`
const MENTION = /agents\.md/i
// "> f", ">> f", ">| f", "2> f", "&> f", "<> f" whose target names AGENTS.md.
const REDIRECT = new RegExp(String.raw`(?:<>|>>?\|?)\s*${TARGET}`, "i")
// "--output=f", "--output f", and sort "-o f" or "-of" whose target names AGENTS.md.
const OUTPUT_OPTION = new RegExp(String.raw`(?:(?:^|\s)--output(?:=|\s+)|\bsort\s(?:[^;&|\n]*\s)?-o\s*)${TARGET}`, "i")
// A sed "w" command or "s///w" flag writing to AGENTS.md; the blank after "w" keeps paths such as
// ".../hpv52wzj/AGENTS.md" from matching.
const SED_WRITE = new RegExp(String.raw`\bsed\s.*[\s;'"/0-9p]w\s+${TARGET}`, "i")
// Commands that create, replace, move or delete the files they name.
const WRITER = String.raw`(?:tee|mv|cp|rm|ln|touch|truncate|install|dd|unlink|rsync|ditto|shred|uniq)`
const WRITERS = new RegExp(String.raw`(?:^|[\s;&|(\x60]|\$\()${WRITER}(?=\s|$)`)
const IN_PLACE = /(?:^|[\s;&|(`]|\$\()(?:sed|perl|ruby|gsed)\s(?:[^;&|\n]*\s)?(?:-[a-zA-Z]*i|--in-place)/
const GIT_WRITE = /\bgit\s(?:[^;&|\n]*\s)?(?:checkout|restore|rm|mv|apply|stash|reset)\b/
const FIND_ACTION = /\bfind\s[^;&|\n]*\s-(?:delete|exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls)\b/
// Inline script lines that call a file-writing API on a path naming AGENTS.md.
const SCRIPT_WRITE =
  /\.write_(?:text|bytes)\(|\bopen\([^)]*,\s*(?:mode\s*=\s*)?["'][^"']*[wax+]|\b(?:writeFile|appendFile|writeFileSync|appendFileSync|createWriteStream|rmSync|renameSync|unlinkSync|copyFileSync)\b|\bBun\.write\b|\bos\.(?:remove|unlink|rename|replace)\(|\bshutil\.(?:copy\w*|move|rmtree)\(|\.(?:unlink|rename|touch)\(/
// NAME=...AGENTS.md... assignments, so a later "$NAME" counts as a mention.
const ASSIGNMENT = /(?:^|[\s;&|(])([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|'[^']*'|[^\s;&|]*)/g

const expandMentions = (command: string): string => {
  let expanded = command
  for (const [, name, value] of command.matchAll(ASSIGNMENT)) {
    if (MENTION.test(value!)) expanded = expanded.replace(new RegExp(String.raw`\$\{?${name}\b\}?`, "g"), "AGENTS.md")
  }
  return expanded
}

// Splits on newlines and on ; && || & but keeps | pipelines together, so "... AGENTS.md | xargs rm" stays one unit.
const commandsOf = (command: string): string[] => command.split(/\n|;|&&|\|\||(?<![>&|])&(?![>&])/)

// The pre-tokenizer scan: it works on raw text and ignores quoting, so it stays the fail-closed
// verdict for input the lexer cannot read.
const flagsTextualCommand = (command: string): boolean => {
  const expanded = expandMentions(command)
  if (!MENTION.test(expanded)) return false
  if (REDIRECT.test(expanded) || OUTPUT_OPTION.test(expanded) || SED_WRITE.test(expanded)) return true
  if (expanded.split("\n").some((line) => MENTION.test(line) && SCRIPT_WRITE.test(line))) return true
  return commandsOf(expanded).some(
    (part) => MENTION.test(part) && (WRITERS.test(part) || IN_PLACE.test(part) || GIT_WRITE.test(part) || FIND_ACTION.test(part)),
  )
}

// A cooked word or a script expression names AGENTS.md when it carries the file name in any
// letter case next to a non-word, non-dot boundary. "AGENTS.md.bak", "AGENTS.md.orig" and
// "myAGENTS.md" are different files and do not count.
const NAMES = /(?:^|[^\w.])agents\.md(?:$|[^\w.])/i
// Quoted string literals in script text keep their quotes, so they need the textual TARGET too.
const exprNames = (text: string) => NAMES.test(text) || new RegExp(TARGET, "i").test(text)

// A write API call flags only when its path expression names AGENTS.md; the name anywhere else
// in the call (a data string, a second argument that is not a path) does not count.
const EXPR = String.raw`[^,()]*(?:\([^()]*\)[^,()]*)*`
const RECEIVER = String.raw`(?:[A-Za-z_][\w.]*\s*\((?:[^()]|\([^()]*\))*\)|\((?:[^()]|\([^()]*\))*\)|[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)`
const METHOD_WRITE = new RegExp(String.raw`(${RECEIVER})\s*\.\s*(?:write_text|write_bytes|unlink|touch|rename|replace)\s*\(`, "g")
const RENAME_TARGET = new RegExp(String.raw`\.\s*rename\s*\(\s*(${EXPR})`, "g")
const OPEN_WRITE = new RegExp(String.raw`\bopen\s*\(\s*(${EXPR})\s*,\s*(?:mode\s*=\s*)?["']?[^,"'()\s]*[wax+]`, "g")
const PATH_WRITE = new RegExp(
  String.raw`\b(?:writeFileSync|appendFileSync|writeFile|appendFile|createWriteStream|rmSync|unlinkSync|os\.(?:remove|unlink)|shutil\.rmtree|Bun\.write|unlink)\s*\(?\s*(${EXPR})`,
  "g",
)
const COPY_WRITE = new RegExp(String.raw`\b(?:renameSync|copyFileSync|os\.(?:rename|replace)|shutil\.(?:copy\w*|move))\s*\(\s*(${EXPR})\s*,\s*(${EXPR})`, "g")
// Shell-out APIs carry a nested shell command; the call's quoted strings become its argv.
const SHELL_OUT = /\b(?:os\.system|subprocess\.\w+|system|exec|spawn|popen)\s*\(([^)]*)\)/g

// The `time` keyword (and GNU time) takes options before the timed command; only these
// consume a separate value, and "-o"/"--output" writes the file it names.
const TIME_VALUE_OPTS = new Set(["-f", "--format", "-o", "--output"])
const TIME_WRITE_OPTS = new Set(["-o", "--output"])

// Commands whose argv[0] wraps another command; option-with-value arguments are skipped so the
// wrapped command becomes argv[0]. env and sudo also take VAR=value words, timeout takes a
// duration. "cmdOpts" are options whose value is itself a command string (flock -c),
// "opts2" consume two separate values (bwrap --bind SRC DEST), "positional" counts leading
// operands that are not the command (chroot's directory, flock's lock file, taskset's mask),
// "positionalMatch" restricts that operand to matching words (setarch's arch name),
// "positionalOpts" are value options that satisfy the operand themselves (taskset -c gives
// the mask inline, runuser -u names the user), "clusterValues" are letters that end a
// short-option cluster and consume a value (screen -dmS), and "writeOpts" are options
// whose value is an output file the wrapper writes (GNU time -o, strace -o).
const WRAPPERS: Record<
  string,
  {
    opts: ReadonlySet<string>
    assigns?: boolean
    positional?: number
    positionalMatch?: RegExp
    cmdOpts?: ReadonlySet<string>
    positionalOpts?: ReadonlySet<string>
    writeOpts?: ReadonlySet<string>
    opts2?: ReadonlySet<string>
    clusterValues?: ReadonlySet<string>
  }
> = {
  sudo: {
    opts: new Set(["-u", "-g", "-h", "-p", "-C", "-T", "-D", "-R", "--user", "--group", "--host", "--prompt", "--chdir", "--role", "--type"]),
    assigns: true,
  },
  doas: { opts: new Set(["-u", "-C"]) },
  pkexec: { opts: new Set(["--user"]) },
  env: { opts: new Set(["-u", "--unset", "-C", "--chdir", "-S", "--split-string"]), assigns: true },
  exec: { opts: new Set(["-a", "--argv0"]) },
  command: { opts: new Set() },
  builtin: { opts: new Set() },
  nice: { opts: new Set(["-n", "--adjustment"]) },
  ionice: { opts: new Set(["-c", "-n", "-p", "--class", "--classdata", "--pid"]) },
  nohup: { opts: new Set() },
  timeout: { opts: new Set(["-s", "--signal", "-k", "--kill-after"]), positional: 1 },
  watch: { opts: new Set(["-n", "--interval"]) },
  stdbuf: { opts: new Set(["-i", "-o", "-e", "--input", "--output", "--error"]) },
  sshpass: { opts: new Set(["-p", "-f", "-d", "-o", "--option"]) },
  time: { opts: new Set(["-f", "--format"]), writeOpts: new Set(["-o", "--output"]) },
  busybox: { opts: new Set() },
  setsid: { opts: new Set() },
  chroot: { opts: new Set(["--userspec", "--groups"]), positional: 1 },
  unshare: {
    opts: new Set([
      "-S", "--setuid", "-G", "--setgid", "--setgroups", "-R", "--root", "-w", "--wd",
      "--propagation", "--monotonic", "--boottime", "--map-user", "--map-group", "--map-users", "--map-groups",
    ]),
  },
  "systemd-run": {
    opts: new Set([
      "-p", "--property", "--unit", "-d", "--description", "--slice", "--uid", "--gid",
      "-E", "--setenv", "--working-directory", "--service-type", "--nice", "--machine", "-M",
      "-H", "--host", "--job-mode", "--on-active", "--on-boot", "--on-startup", "--on-unit-active",
      "--on-unit-inactive", "--on-calendar", "--timer-property", "--path-property", "--timezone",
    ]),
  },
  // nsenter's namespace options take an optional file and are usually valueless when -t gives
  // the pid, so they are treated as flags; the pid and ids take required values.
  nsenter: { opts: new Set(["-t", "--target", "-S", "--setuid", "-G", "--setgid"]) },
  flock: {
    opts: new Set(["-w", "--timeout", "-E", "--conflict-exit-code"]),
    cmdOpts: new Set(["-c", "--command"]),
    positional: 1,
  },
  // "-c" gives the cpu list itself, so it replaces the mask operand; without it the first
  // positional is the mask.
  taskset: { opts: new Set(), positionalOpts: new Set(["-c", "--cpu-list"]), positional: 1 },
  firejail: {
    opts: new Set([
      "--profile", "--profile-path", "--include", "--net", "--netns", "--ip", "--ip6", "--mac",
      "--name", "--hostname", "--dns", "--hosts-file", "--chroot", "--private", "--private-bin",
      "--private-etc", "--private-home", "--private-lib", "--private-opt", "--private-tmp",
      "--seccomp", "--protocol", "--cpu", "--nice", "--user", "--env", "--output", "--join",
      "--join-filesystem", "--join-network", "--bandwidth", "--timeout", "--whitelist",
      "--blacklist", "--read-only", "--read-write", "--bind", "--tmpfs",
    ]),
  },
  // GNU parallel runs the command word; ":::" input markers stay ordinary arguments. The
  // option list is the common value-taking subset; with no command at all it reads jobs
  // from stdin (handled with the other stdin executors below).
  parallel: {
    opts: new Set([
      "-j", "--jobs", "-P", "--max-procs", "-N", "-n", "--max-args", "-L", "--max-lines",
      "-C", "--colsep", "-d", "--delimiter", "-E", "-e", "--eof", "-I", "--replace", "-i",
      "-J", "--profile", "-S", "--sshlogin", "--sshloginfile", "--slf", "-a", "--arg-file",
      "--arg-file-sep", "-B", "--bf", "--basefile", "-s", "--max-chars", "--load",
      "--memfree", "--nice", "--timeout", "--halt", "--halt-on-error", "--retries",
      "--rpl", "--recstart", "--recend", "--joblog", "--results", "--result", "--res",
      "--tmpdir", "--tempdir", "--wd", "--workdir", "--delay", "--env", "--header",
      "--tagstring", "--compress", "--compress-program", "--semaphoretimeout", "--id",
      "--trc", "--tarflag",
    ]),
  },
  // The user operand is either the "-u" value or the first positional.
  runuser: {
    opts: new Set(["-u", "--user", "-g", "--group", "-s", "--shell", "-w", "--whitelist-environment"]),
    positional: 1,
    positionalOpts: new Set(["-u", "--user"]),
  },
  setpriv: {
    opts: new Set([
      "--ruid", "--euid", "--reuid", "--rgid", "--egid", "--regid", "--groups",
      "--securebits", "--pdeathsig", "--selinux-label", "--apparmor-profile",
      "--inh-caps", "--ambient-caps", "--bounding-set", "--landlock-access", "--landlock-rule",
    ]),
  },
  // Policy flags are valueless; the priority (or deadline values) is the one operand.
  chrt: {
    opts: new Set(["-p", "--pid", "-T", "--sched-runtime", "-P", "--sched-period", "-D", "--sched-deadline"]),
    positional: 1,
  },
  numactl: {
    opts: new Set(["-N", "--cpunodebind", "-m", "--membind", "-p", "--preferred", "-c", "--physcpubind", "-i", "--interleave"]),
  },
  prlimit: {
    opts: new Set([
      "-p", "--pid", "-o", "--output",
      "--as", "--core", "--cpu", "--data", "--fsize", "--locks", "--memlock", "--msgqueue",
      "--nice", "--nofile", "--nproc", "--rss", "--rtprio", "--rttime", "--sigpending", "--stack",
    ]),
  },
  // The first operand is an arch name only when it names one; otherwise the command starts
  // there ("setarch -R rm x" has no arch operand). The linux32/linux64 links already carry
  // the arch, so they take no operand.
  setarch: {
    opts: new Set(),
    positional: 1,
    positionalMatch: /^(?:i[3-6]86|x86_64|amd64|aarch64|arm\w*|alpha|hppa\w*|ia64|m68k|mips\w*|parisc\w*|ppc\w*|riscv\w*|s390x?|sh\w*|sparc\w*|uname26|linux32|linux64|loongarch\w*)$/i,
  },
  linux32: { opts: new Set() },
  linux64: { opts: new Set() },
  // bwrap options pair a source and a destination (or a variable and a value).
  bwrap: {
    opts: new Set([
      "--proc", "--dev", "--dir", "--tmpfs", "--mqueue", "--remount-ro", "--size",
      "--perms", "--chdir", "--unsetenv", "--uid", "--gid", "--hostname", "--cap-add",
      "--cap-drop", "--userns", "--userns2", "--pidns", "--seccomp", "--add-seccomp-fd",
      "--exec-label", "--file-label", "--proc-label", "--sync-fd", "--info-fd",
      "--json-status-fd", "--block-fd", "--userns-block-fd", "--lock-file", "--args",
      "--argv0", "--level-prefix", "--overlay-src", "--tmp-overlay",
    ]),
    opts2: new Set([
      "--bind", "--bind-data", "--ro-bind", "--ro-bind-data", "--dev-bind",
      "--dev-bind-data", "--symlink", "--chmod", "--setenv", "--file", "--file-data",
      "--overlay", "--ro-overlay",
    ]),
  },
  proot: {
    opts: new Set(["-r", "-R", "-S", "--rootfs", "-b", "--bind", "-q", "--qemu", "-w", "--pwd", "--cwd", "-k", "--kernel-release"]),
  },
  strace: {
    opts: new Set([
      "-e", "--trace", "-p", "--attach", "-u", "--user", "-s", "--string-limit",
      "-E", "--env", "-P", "--trace-path", "-X", "--const-print-style", "-U", "--uprobes",
      "--columns", "--align", "--decode-pids", "--decode-fds", "--detach-on",
      "--syscall-limit", "--syscall-times", "--strings-in-hex", "--secontext", "--status",
      "--tips", "--absolute-timestamps", "--relative-timestamps",
    ]),
    writeOpts: new Set(["-o", "--output"]),
  },
  valgrind: {
    opts: new Set([
      "--tool", "--log-fd", "--xml-fd", "--xml-user-comment", "--num-callers",
      "--error-exitcode", "--max-threads", "--fullpath-after", "--extra-debuginfo-path",
      "--debuginfo-server", "--suppressions", "--sysinfo-file", "--vgdb-poll",
      "--db-command", "--input-fd", "--max-stackframe", "--main-stacksize",
      "--fair-sched", "--kernel-variant", "--merge-recursive-frames",
      "--num-transtab-sectors", "--avg-transtab-entry-size", "--px-file-size",
      "--px-default", "--soname-synonyms", "--smc-check", "--vgdb-stop-at", "--sim-hints",
      "--progress-interval", "--progress-signal", "--keep-stacktraces", "--freelist-vol",
      "--freelist-big-blocks", "--ignore-range-below-sp", "--sanity-level", "--gen-suppressions",
    ]),
    // The profiler back ends write their reports to these option targets.
    writeOpts: new Set(["--log-file", "--xml-file", "--callgrind-out-file", "--cachegrind-out-file", "--massif-out-file"]),
  },
  fakeroot: {
    opts: new Set(["-l", "--lib", "-f", "--faked", "-s", "--save-file", "-i", "--load-file", "-b", "--fd-base"]),
  },
  eatmydata: { opts: new Set() },
  // perf's first operand is the subcommand (record, stat, trace, …); the union of the
  // executing subcommands' value options is listed so their values do not hide the command.
  perf: {
    opts: new Set([
      "-e", "--event", "-F", "--freq", "-c", "--count", "-p", "--pid", "-t", "--tid",
      "-u", "--uid", "-C", "--cpu", "-G", "--cgroup", "--call-graph", "-m", "--mmap-pages",
      "--clockid", "--filter", "--user-regs", "--intr-regs", "-I", "--interval-print",
      "-M", "--metrics", "-r", "--repeat", "-x", "--field-separator", "--delay", "-z",
      "--compression-level", "--mmap-flush", "--aux-output", "--control-fifo", "--control-fd",
      "--proc-map-timeout", "--buildid-dir", "--vmlinux", "--kallsyms", "--branch-filter",
      "--cpu-list",
    ]),
    writeOpts: new Set(["-o", "--output"]),
    positional: 1,
  },
  // screen's single-letter options cluster freely ("-dmS name cmd"); a cluster ending in a
  // value letter consumes the next argument.
  screen: {
    opts: new Set(["-S", "-p", "-c", "-s", "-t", "-e", "-T", "-h", "-r", "-R", "-x", "-X"]),
    clusterValues: new Set(["S", "p", "c", "s", "t", "e", "T", "h", "r", "R", "x", "X"]),
  },
}
const WRITER_NAMES = new Set(WRITER.slice("(?:".length, -1).split("|"))
const IN_PLACE_CMDS = new Set(["sed", "perl", "ruby", "gsed"])
const IN_PLACE_FLAG = /^-[a-zA-Z]*i|^--in-place/
const GIT_SUBS = new Set(["checkout", "restore", "rm", "mv", "apply", "stash", "reset"])
const FIND_ACTIONS = new Set(["-delete", "-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fprint0", "-fprintf", "-fls"])
const SHELL_CMDS = new Set(["sh", "bash", "zsh", "dash", "ksh", "ash", "fish", "su"])
const XARGS_OPTS = new Set([
  "-I", "-J", "-L", "-n", "-P", "-s", "-E", "-e", "-d", "-a",
  "--arg-file", "--delimiter", "--eof", "--max-args", "--max-chars", "--max-lines", "--max-procs", "--replace", "--process-slot-var",
])
// tmux global options that consume a separate value before the subcommand word.
const TMUX_GLOBAL_VALUE = new Set(["-f", "-L", "-S", "-T"])
// tmux subcommands that execute their trailing arguments as a shell command; each entry
// lists that subcommand's options that consume a separate value so it is not judged.
const TMUX_EXEC: Record<string, ReadonlySet<string>> = {}
for (const [valueOpts, names] of [
  [["-c", "-e", "-F", "-f", "-n", "-s", "-t", "-x", "-y"], ["new-session", "new"]],
  [["-c", "-e", "-F", "-n", "-t"], ["new-window", "neww"]],
  [["-c", "-e", "-F", "-l", "-p", "-t"], ["split-window", "splitw"]],
  [["-d", "-F", "-t"], ["run-shell", "run"]],
  [["-c", "-e", "-t"], ["respawn-window", "respawnw", "respawn-pane", "respawnp"]],
  [["-t"], ["if-shell", "if"]],
  [["-p", "-t"], ["confirm-before", "confirm"]],
  [["-t"], ["pipe-pane", "pipep"]],
  [["-b", "-d", "-e", "-h", "-R", "-s", "-S", "-t", "-T", "-w", "-x", "-y"], ["display-popup", "popup"]],
  [["-N", "-t"], ["send-keys", "send"]],
] as const) for (const name of names) TMUX_EXEC[name] = new Set(valueOpts)
// Shell grammar words that open a command position without being commands themselves.
const KEYWORDS = new Set(["if", "then", "elif", "else", "fi", "for", "while", "until", "do", "done", "case", "esac", "select", "function", "time", "coproc", "!"])
// Builtins whose NAME=value operands assign in the current shell, so a later "$NAME" expands.
const ASSIGN_BUILTINS = new Set(["export", "declare", "local", "readonly", "typeset"])

interface Redirect {
  readonly write: boolean
  readonly target: string
}
interface Simple {
  readonly argv: string[]
  readonly redirects: Redirect[]
  readonly heredocs: string[]
  readonly pipeline: number
}
type Env = Map<string, string>
type Nested = (text: string) => void

const basenameOf = (word: string) => word.slice(word.lastIndexOf("/") + 1)

// Reads a balanced "(…)" group starting at text[i] (just past the opening paren), honoring
// quotes and escapes so a paren inside a string does not close it. Throws on unterminated input.
const captureParens = (text: string, i: number): [inner: string, next: number] => {
  const start = i
  let depth = 1
  while (i < text.length) {
    const c = text[i]!
    if (c === "\\") {
      i += 2
      continue
    }
    if (c === "'" || c === '"' || c === "`") {
      const end = text.indexOf(c, i + 1)
      if (end < 0) throw new Error("unterminated quote")
      i = end + 1
      continue
    }
    if (c === "(") depth++
    if (c === ")") {
      depth--
      if (depth === 0) return [text.slice(start, i), i + 1]
    }
    i++
  }
  throw new Error("unterminated substitution")
}

// An arithmetic expansion is not run as commands, but a "$(…)" inside it is a real command
// substitution and must still be reported. Scans the arithmetic text for substitutions while
// honoring quotes so a "$(" inside a string is skipped.
const scanArithmetic = (text: string, nested: Nested): void => {
  let i = 0
  while (i < text.length) {
    const c = text[i]!
    if (c === "\\") {
      i += 2
      continue
    }
    if (c === "'" || c === '"' || c === "`") {
      const end = text.indexOf(c, i + 1)
      if (end < 0) throw new Error("unterminated quote")
      i = end + 1
      continue
    }
    if (c === "$" && text[i + 1] === "(") {
      const [inner, next] = captureParens(text, i + 2)
      if (inner.startsWith("(")) scanArithmetic(inner, nested)
      else nested(inner)
      i = next
      continue
    }
    i++
  }
}

// Reads $NAME, ${NAME}, `…`, $(…) and $((…)) at text[i]. Substituted commands are reported to
// `nested` and kept verbatim in the word; variables expand from env or stay literal.
const readDollar = (text: string, i: number, env: Env, nested: Nested): [piece: string, next: number] => {
  if (text[i] === "`") {
    const end = text.indexOf("`", i + 1)
    if (end < 0) throw new Error("unterminated backtick")
    nested(text.slice(i + 1, end))
    return [text.slice(i, end + 1), end + 1]
  }
  const after = text[i + 1]
  if (after === "{") {
    const end = text.indexOf("}", i + 2)
    if (end < 0) throw new Error("unterminated expansion")
    const inner = text.slice(i + 2, end)
    const name = /^#?([A-Za-z_]\w*)$/.exec(inner)?.[1]
    return [name !== undefined && env.has(name) ? env.get(name)! : text.slice(i, end + 1), end + 1]
  }
  if (after === "(") {
    const [inner, next] = captureParens(text, i + 2)
    // "$( (" is an arithmetic expansion: its content is not run as commands, though a
    // command substitution inside it is.
    if (inner.startsWith("(")) scanArithmetic(inner, nested)
    else nested(inner)
    return [text.slice(i, next), next]
  }
  const name = /^[A-Za-z_]\w*/.exec(text.slice(i + 1))?.[0]
  if (name === undefined) return ["$", i + 1]
  return [env.get(name) ?? text.slice(i, i + 1 + name.length), i + 1 + name.length]
}

// Cooks one word starting at text[i]: removes quotes, resolves escapes, expands $NAME and
// ${NAME} from env, and reports $(…), `…`, <(…) and >(…) to `nested`. Returns the cooked word
// and the index of the delimiter that ended it, which the caller owns.
const readWord = (text: string, i: number, env: Env, nested: Nested): [word: string, next: number] => {
  let word = ""
  while (i < text.length) {
    const c = text[i]!
    if (" \t\n;&|<>".includes(c)) break
    if (c === "\\") {
      if (i + 1 >= text.length) throw new Error("trailing backslash")
      if (text[i + 1] !== "\n") word += text[i + 1]
      i += 2
      continue
    }
    if (c === "'") {
      const end = text.indexOf("'", i + 1)
      if (end < 0) throw new Error("unterminated quote")
      word += text.slice(i + 1, end)
      i = end + 1
      continue
    }
    if (c === '"') {
      i++
      let closed = false
      while (i < text.length) {
        const d = text[i]!
        if (d === '"') {
          closed = true
          i++
          break
        }
        if (d === "\\" && i + 1 < text.length && '$`"\\\n'.includes(text[i + 1]!)) {
          if (text[i + 1] !== "\n") word += text[i + 1]
          i += 2
          continue
        }
        if (d === "$" || d === "`") {
          const [piece, next] = readDollar(text, i, env, nested)
          word += piece
          i = next
          continue
        }
        word += d
        i++
      }
      if (!closed) throw new Error("unterminated quote")
      continue
    }
    if (c === "$" || c === "`") {
      const [piece, next] = readDollar(text, i, env, nested)
      word += piece
      i = next
      continue
    }
    word += c
    i++
  }
  return [word, i]
}

// Reads a redirection operator plus its target at text[i]; text[i] is "<" or ">". Heredoc
// delimiters are queued for the caller to consume at the end of the line; here-strings return
// their data word as an inline body.
const readRedirect = (
  text: string,
  i: number,
  env: Env,
  nested: Nested,
): [redirect: Redirect | undefined, heredoc: { delim: string; stripTabs: boolean } | undefined, body: string | undefined, next: number] => {
  let op = text[i]!
  i++
  const c = text[i]
  if (op === ">") {
    if (c === ">") {
      op = ">>"
      i++
    } else if (c === "|" || c === "&") {
      op += c
      i++
    }
  } else if (c === "<") {
    op = "<<"
    i++
    if (text[i] === "<") {
      op = "<<<"
      i++
    } else if (text[i] === "-") {
      op = "<<-"
      i++
    }
  } else if (c === ">" || c === "&") {
    op += c
    i++
  }
  while (text[i] === " " || text[i] === "\t") i++
  if (op === "<<" || op === "<<-") {
    const [delim, next] = readWord(text, i, env, nested)
    if (!delim) throw new Error("heredoc without delimiter")
    return [undefined, { delim, stripTabs: op === "<<-" }, undefined, next]
  }
  if ((text[i] === "<" || text[i] === ">") && text[i + 1] === "(") {
    // A process substitution as the redirect target: the inside is a nested command.
    const [inner, next] = captureParens(text, i + 2)
    nested(inner)
    return [{ write: op.includes(">"), target: text.slice(i, next) }, undefined, undefined, next]
  }
  const [target, next] = readWord(text, i, env, nested)
  if (!target) throw new Error("redirect without a target")
  if (op === "<<<") return [undefined, undefined, target, next]
  return [{ write: op.includes(">"), target }, undefined, undefined, next]
}

// Splits the command text into simple commands. Pipeline stages share a pipeline id; heredoc
// bodies are collected raw, per owning command, when each command line ends.
const lex = (text: string, env: Env, nested: Nested): Simple[] => {
  const commands: Simple[] = []
  let argv: string[] = []
  let redirects: Redirect[] = []
  let bodies: string[] = []
  let pending: { delim: string; stripTabs: boolean; sink: string[] }[] = []
  let pipeline = 0
  // "opts" while the words of a `time` keyword's option list are being skipped;
  // "value" when the next word is the value of a time option.
  let timeState: "off" | "opts" | "value" = "off"
  let timeOpt = ""
  let i = 0

  const pushWord = (word: string) => {
    if (timeState === "value") {
      timeState = "opts"
      if (TIME_WRITE_OPTS.has(timeOpt)) redirects.push({ write: true, target: word })
      return
    }
    if (timeState === "opts" && word.startsWith("-")) {
      if (TIME_VALUE_OPTS.has(word)) {
        timeOpt = word
        timeState = "value"
      }
      return
    }
    timeState = "off"
    if (argv.length === 0 && KEYWORDS.has(word)) {
      if (word === "time") timeState = "opts"
      return
    }
    // Shells only take VAR=value words in command position, and assignment builtins such as
    // export bind their NAME=value operands; a "name=value" argument elsewhere (echo F=x,
    // sudo F=x) is data and must not feed variable expansion.
    const assign = /^([A-Za-z_]\w*)=(.*)$/s.exec(word)
    const commandWord = argv.find((arg) => !/^[A-Za-z_]\w*=/.test(arg))
    if (assign && (commandWord === undefined || ASSIGN_BUILTINS.has(basenameOf(commandWord)))) {
      env.set(assign[1]!, assign[2]!)
    }
    argv.push(word)
  }
  const endCommand = (samePipeline: boolean) => {
    if (argv.length > 0 || redirects.length > 0 || bodies.length > 0 || pending.length > 0) {
      commands.push({ argv, redirects, heredocs: bodies, pipeline })
    }
    if (!samePipeline) pipeline++
    argv = []
    redirects = []
    bodies = []
    timeState = "off"
  }
  const consumeHeredocs = () => {
    for (const h of pending) {
      const lines: string[] = []
      let closed = false
      while (i < text.length) {
        const end = text.indexOf("\n", i)
        const line = end < 0 ? text.slice(i) : text.slice(i, end)
        if ((h.stripTabs ? line.replace(/^\t+/, "") : line) === h.delim) {
          closed = true
          i = end < 0 ? text.length : end + 1
          break
        }
        lines.push(line)
        if (end < 0) {
          i = text.length
          break
        }
        i = end + 1
      }
      if (!closed) throw new Error("unterminated heredoc")
      h.sink.push(lines.join("\n"))
    }
    pending = []
  }

  while (i < text.length) {
    const c = text[i]!
    if (c === " " || c === "\t") {
      i++
      continue
    }
    if (c === "\n") {
      i++
      endCommand(false)
      consumeHeredocs()
      continue
    }
    if (c === "#") {
      const end = text.indexOf("\n", i)
      i = end < 0 ? text.length : end
      continue
    }
    if (c === ";") {
      endCommand(false)
      i++
      continue
    }
    if (c === "&") {
      if (text[i + 1] === "&") {
        endCommand(false)
        i += 2
        continue
      }
      if (text[i + 1] === ">") {
        const [redirect, , , next] = readRedirect(text, i + 1, env, nested)
        i = next
        if (redirect) redirects.push(redirect)
        continue
      }
      endCommand(false)
      i++
      continue
    }
    if (c === "|") {
      if (text[i + 1] === "|") {
        endCommand(false)
        i += 2
        continue
      }
      endCommand(true)
      i += text[i + 1] === "&" ? 2 : 1
      continue
    }
    // "(", ")", "{" and "}" are shell syntax only in command position; after a command has
    // words they are literal word characters (an xargs "{}", a brace expansion "{a,b}").
    if ((c === "(" || c === ")" || c === "{" || c === "}") && argv.length === 0) {
      endCommand(false)
      i++
      continue
    }
    if (c === "<" || c === ">") {
      if (text[i + 1] === "(") {
        // "<(…)" and ">(…)" are process substitutions: the inside is a command, the whole
        // substitution is a word.
        const [inner, next] = captureParens(text, i + 2)
        nested(inner)
        pushWord(text.slice(i, next))
        i = next
        continue
      }
      const [redirect, heredoc, body, next] = readRedirect(text, i, env, nested)
      i = next
      if (redirect) redirects.push(redirect)
      if (heredoc) pending.push({ ...heredoc, sink: bodies })
      if (body !== undefined) bodies.push(body)
      continue
    }
    const [word, next] = readWord(text, i, env, nested)
    i = next
    // A bare number right before < or > is the redirection's fd, not an argument.
    if (/^\d+$/.test(word) && i < text.length && (text[i] === "<" || text[i] === ">")) {
      const [redirect, heredoc, body, after] = readRedirect(text, i, env, nested)
      i = after
      if (redirect) redirects.push(redirect)
      if (heredoc) pending.push({ ...heredoc, sink: bodies })
      if (body !== undefined) bodies.push(body)
      continue
    }
    pushWord(word)
  }
  endCommand(false)
  if (pending.length > 0) throw new Error("unterminated heredoc")
  return commands
}

// Turns a shell-out call's arguments into command text: a single quoted string is the command
// line itself, several strings are the argv, and a bare expression is used as-is.
const shellText = (call: string): string => {
  const parts = [...call.matchAll(/'([^'\\]*)'|"([^"\\]*)"/g)].map((match) => match[1] ?? match[2] ?? "")
  if (parts.length === 1) return parts[0]!
  return parts.length > 1 ? parts.map((part) => JSON.stringify(part)).join(" ") : call.trim()
}

// A name = "value" assignment inside script text; binds the identifiers a write API's path
// expression may use instead of a literal.
const SCRIPT_ASSIGN = /([A-Za-z_]\w*)\s*=\s*("[^"]*"|'[^']*'|[^\s;,()'"]*)/g

// A write API call in script text flags only when its own path expression names AGENTS.md,
// either literally or through an identifier the same script assigns an AGENTS.md value.
const scriptFlags = (text: string, run: (inner: string) => boolean): boolean => {
  let bindings: Map<string, string> | undefined
  const boundNames = (expr: string): boolean => {
    const ids = expr.replace(/"[^"]*"|'[^']*'/g, "").match(/[A-Za-z_]\w*/g)
    if (ids === null) return false
    bindings ??= new Map([...text.matchAll(SCRIPT_ASSIGN)].map((match) => [match[1]!, match[2]!]))
    return ids.some((id) => {
      const value = bindings!.get(id)
      return value !== undefined && exprNames(value)
    })
  }
  const names = (expr: string) => exprNames(expr) || boundNames(expr)
  for (const match of text.matchAll(METHOD_WRITE)) if (names(match[1]!)) return true
  for (const match of text.matchAll(RENAME_TARGET)) if (names(match[1]!)) return true
  for (const match of text.matchAll(OPEN_WRITE)) if (names(match[1]!)) return true
  for (const match of text.matchAll(PATH_WRITE)) if (names(match[1]!)) return true
  for (const match of text.matchAll(COPY_WRITE)) if (names(match[1]!) || names(match[2]!)) return true
  for (const match of text.matchAll(SHELL_OUT)) if (run(shellText(match[1]!))) return true
  return false
}

// Drops leading VAR=value words and command wrappers (sudo, env, nice, …) so argv[0] is the
// command that actually runs. An option that carries a command string (flock -c) is reported
// as "cmdString"; options may sit on either side of a wrapper's positional operands.
const unwrap = (
  argv: readonly string[],
): { cmd: string; args: readonly string[]; cmdString?: string; writes: readonly string[]; via: readonly string[] } => {
  let i = 0
  let cmdString: string | undefined
  const writes: string[] = []
  const via: string[] = []
  for (;;) {
    if (/^[A-Za-z_]\w*=/.test(argv[i] ?? "")) {
      i++
      continue
    }
    const name = basenameOf(argv[i] ?? "")
    const wrapper = WRAPPERS[name]
    if (wrapper === undefined) return { cmd: name, args: argv.slice(i + 1), cmdString, writes, via }
    via.push(name)
    i++
    let positional = wrapper.positional ?? 0
    for (;;) {
      while (i < argv.length && argv[i]!.startsWith("-")) {
        const opt = argv[i]!
        const writeOpt = [...(wrapper.writeOpts ?? [])].find((o) => opt === o || opt.startsWith(`${o}=`))
        if (writeOpt !== undefined) {
          if (opt === writeOpt) {
            if (argv[i + 1] !== undefined) writes.push(argv[i + 1]!)
            i += 2
            continue
          }
          writes.push(opt.slice(writeOpt.length + 1))
          i += 1
          continue
        }
        if (wrapper.cmdOpts?.has(opt)) {
          if (argv[i + 1] !== undefined) cmdString = argv[i + 1]
          i += 2
          continue
        }
        if (wrapper.opts2?.has(opt)) {
          i += 3
          continue
        }
        if (wrapper.positionalOpts?.has(opt)) {
          positional = 0
          i += 2
          continue
        }
        if (wrapper.opts.has(opt)) {
          i += 2
          continue
        }
        if (wrapper.clusterValues !== undefined && /^-[a-zA-Z]{2,}$/.test(opt)) {
          i += wrapper.clusterValues.has(opt.at(-1)!) ? 2 : 1
          continue
        }
        i += 1
      }
      while (wrapper.assigns === true && i < argv.length && /^[A-Za-z_]\w*=/.test(argv[i]!)) i++
      if (
        positional > 0 &&
        i < argv.length &&
        !argv[i]!.startsWith("-") &&
        (wrapper.positionalMatch === undefined || wrapper.positionalMatch.test(argv[i]!))
      ) {
        positional--
        i++
        continue
      }
      break
    }
  }
}

// Judges the command an argv runs: after unwrapping, argv[0] is the executed program. When
// "stdinNames" is set the command's input names AGENTS.md (an earlier pipeline stage produced
// it), so consumers like xargs turn that name into operands of the command they run.
const flagsExec = (argv: readonly string[], stdinNames: boolean, run: (inner: string) => boolean): boolean => {
  const { cmd, args, cmdString, writes, via } = unwrap(argv)
  // An option like flock's "-c" carries a command string: it is analyzed as a command.
  if (cmdString !== undefined && run(cmdString)) return true
  // An option like GNU time's "-o" carries a file the command writes.
  if (writes.some((word) => NAMES.test(word))) return true
  if (cmd === "ssh") {
    // The remote command runs on another machine, but -o options that carry a command
    // (ProxyCommand, LocalCommand) run it locally, so only those option values are judged.
    for (const [index, arg] of args.entries()) {
      const value = arg === "-o" ? args[index + 1] : arg.startsWith("-o") ? arg.slice(2) : undefined
      const option = value === undefined ? null : /^([A-Za-z]+)\s*(?:=|\s)\s*(.*)$/s.exec(value)
      if (option !== null && /^(?:proxycommand|localcommand)$/i.test(option[1]!) && run(option[2]!)) return true
    }
    return false
  }
  const names = (word: string) => NAMES.test(word)
  // eval joins its arguments into one command line and runs it.
  if (cmd === "eval" && args.length > 0 && run(args.join(" "))) return true
  if (cmd === "tmux") {
    // Global options take a socket or config value; "-c" itself runs a shell command.
    // An executing subcommand (new-session, run-shell, send-keys, …) runs the words that
    // follow its own options as a shell command, judged both per word and joined.
    let j = 0
    for (; j < args.length; j++) {
      const arg = args[j]!
      if (arg === "-c") {
        if (args[j + 1] !== undefined && run(args[j + 1]!)) return true
        j++
        continue
      }
      if (TMUX_GLOBAL_VALUE.has(arg)) {
        j++
        continue
      }
      if (!arg.startsWith("-")) break
    }
    const valueOpts = args[j] === undefined ? undefined : TMUX_EXEC[args[j]!]
    if (valueOpts === undefined) return false
    const rest: string[] = []
    for (let k = j + 1; k < args.length; k++) {
      const arg = args[k]!
      if (valueOpts.has(arg)) {
        k++
        continue
      }
      if (arg.startsWith("-")) continue
      rest.push(arg)
    }
    return rest.some((arg) => run(arg)) || (rest.length > 0 && run(rest.join(" ")))
  }
  // A shell's "-c" argument carries a nested command, alone or inside a single-dash
  // option cluster such as "-lc" or "-ec".
  if (SHELL_CMDS.has(cmd)) {
    for (const [index, arg] of args.entries()) {
      if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(arg) && args[index + 1] !== undefined && run(args[index + 1]!)) return true
    }
  }
  if (WRITER_NAMES.has(cmd) && args.some(names)) return true
  if (cmd === "xargs") {
    let j = 0
    let repl: string | undefined
    while (j < args.length && args[j]!.startsWith("-")) {
      if (args[j] === "-I") {
        repl = args[j + 1]
        j += 2
        continue
      }
      if (args[j]!.startsWith("-I") && args[j]!.length > 2) {
        repl = args[j]!.slice(2)
        j += 1
        continue
      }
      j += XARGS_OPTS.has(args[j]!) ? 2 : 1
    }
    const rest = args.slice(j)
    // The command xargs runs is judged on its own argv. Input lines name the file only when
    // an earlier pipeline stage does: they are appended as operands (a writer consumes them)
    // or substituted for -I's replace string wherever it appears in the executed argv.
    if (rest.length > 0 && flagsExec(rest, false, run)) return true
    if (stdinNames && repl !== undefined && flagsExec(rest.map((arg) => arg.replaceAll(repl, "AGENTS.md")), false, run)) return true
    if (stdinNames && repl === undefined && WRITER_NAMES.has(basenameOf(rest[0] ?? ""))) return true
  }
  // parallel appends its stdin lines as operands to the command it runs.
  if (stdinNames && via.includes("parallel") && WRITER_NAMES.has(cmd)) return true
  if (IN_PLACE_CMDS.has(cmd) && args.some((arg) => IN_PLACE_FLAG.test(arg)) && args.some(names)) return true
  if ((cmd === "sed" || cmd === "gsed") && args.some((arg) => /(?:^|[\s;'"/0-9p])w\s+\S*agents\.md(?:$|[^\w.])/i.test(arg))) return true
  if (cmd === "git" && args.some((arg) => GIT_SUBS.has(arg)) && args.some(names)) return true
  if (cmd === "find" && args.some((arg) => FIND_ACTIONS.has(arg)) && args.some(names)) return true
  if (
    args.some(
      (arg, index) =>
        (arg === "--output" && names(args[index + 1] ?? "")) ||
        (arg.startsWith("--output=") && names(arg.slice("--output=".length))) ||
        (cmd === "sort" && arg === "-o" && names(args[index + 1] ?? "")) ||
        (cmd === "sort" && /^-o.+/.test(arg) && names(arg.slice(2))),
    )
  )
    return true
  return argv.some((word) => scriptFlags(word, run))
}

// Receivers whose stdin is a command line: ssh feeds it to the remote shell, at and batch
// queue it to run later, and newgrp starts a shell that reads it. Shells and su execute
// stdin too, but only when argv does not already give them a program; they are handled
// through SHELL_CMDS below.
const STDIN_EXECS = new Set(["ssh", "at", "batch", "newgrp"])
// Wrappers that run a shell or read commands from stdin when argv carries no command:
// "sudo -s", "runuser -u root", "chroot /x" and friends start a shell, and parallel reads
// its job list from stdin.
const STDIN_SHELL_DEFAULT = new Set([
  "sudo", "doas", "runuser", "chroot", "unshare", "nsenter", "proot", "fakeroot",
  "firejail", "parallel", "setarch", "linux32", "linux64",
])
// Shell options that consume a separate value, so the value is not mistaken for a script
// file. su's operands are a user and shell selection, never a script.
const SHELL_VALUE_OPTS = new Set(["-o", "+o", "-O", "+O", "--rcfile", "--init-file", "--emulate"])

// A receiver gets its program from argv, so its stdin is data to that program, not commands:
// a shell's "-c" option or script file, su's "-c", or a "--" boundary followed by an operand.
// su keeps scanning past operands because its first one is a user, not a script.
const shellHasProgram = (cmd: string, args: readonly string[]): boolean => {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (/^[+-][a-zA-Z]*c[a-zA-Z]*$/.test(arg)) return true
    if (cmd === "su") continue
    if (cmd === "fish" && arg === "-C") {
      i++
      continue
    }
    if (arg === "--") return args[i + 1] !== undefined
    if (SHELL_VALUE_OPTS.has(arg)) {
      i++
      continue
    }
    if (!arg.startsWith("-") && !arg.startsWith("+")) return true
  }
  return false
}
// An interpreter also runs stdin as its program when argv holds no script file and no option
// supplies the program instead ("-c", "-e", "-m", …). Options in "value" consume a separate
// argument that is neither a script file nor the program.
const INTERPRETER_OPTS: Record<string, { program: ReadonlySet<string>; value: ReadonlySet<string> }> = {
  python: { program: new Set(["-c", "-m"]), value: new Set(["-W", "-X"]) },
  node: { program: new Set(["-e", "-p", "--eval", "--print", "--check"]), value: new Set(["-r", "--require", "--loader", "--import", "--conditions", "-C", "--env-file", "--icu-data-dir", "--redirect-warnings", "--title", "--diagnostic-dir"]) },
  perl: { program: new Set(["-e", "-E"]), value: new Set(["-m", "-M", "-I", "-F", "-x", "-C"]) },
  ruby: { program: new Set(["-e"]), value: new Set(["-r", "-I", "-C", "-X", "-S", "-E", "-F"]) },
  php: { program: new Set(["-r", "-R", "-B", "-E", "-f", "-F"]), value: new Set(["-d", "-c", "-z"]) },
  lua: { program: new Set(["-e"]), value: new Set(["-l"]) },
}
const interpreterOf = (cmd: string): (typeof INTERPRETER_OPTS)[string] | undefined => {
  if (/^(?:python|pypy)[\d.]*$/.test(cmd)) return INTERPRETER_OPTS.python
  if (/^(?:node(?:js)?|deno|bun)$/.test(cmd)) return INTERPRETER_OPTS.node
  if (/^perl[\d.]*$/.test(cmd)) return INTERPRETER_OPTS.perl
  if (/^(?:j?ruby|rbx)[\d.]*$/.test(cmd)) return INTERPRETER_OPTS.ruby
  if (/^php[\d.-]*$/.test(cmd)) return INTERPRETER_OPTS.php
  if (/^lua(?:jit)?[\d.]*$/.test(cmd)) return INTERPRETER_OPTS.lua
  return undefined
}
const stdinIsProgram = (cmd: string, args: readonly string[]): boolean => {
  const opts = interpreterOf(cmd)
  if (opts === undefined) return false
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === "-") continue
    if (!arg.startsWith("-")) return false
    if (opts.program.has(arg)) return false
    if (opts.value.has(arg)) i++
  }
  return true
}

// A heredoc body is judged only when a command that executes stdin receives it: the command
// it is written on, or a later stage of the same pipeline (cat <<EOF | sh). For data sinks
// such as cat or tee the body is inert and is not analyzed.
const stdinRunner = (simple: Simple): boolean => {
  const { cmd, args, via } = unwrap(simple.argv)
  if (SHELL_CMDS.has(cmd)) return !shellHasProgram(cmd, args)
  if (STDIN_EXECS.has(cmd)) return true
  if (stdinIsProgram(cmd, args)) return true
  // No command operand after the wrappers: they fall back to a shell (or a job list) on stdin.
  return cmd === "" && via.some((word) => STDIN_SHELL_DEFAULT.has(word))
}

// eval never reads stdin — but the textual scan flagged heredoc lines as commands of their
// own, so a heredoc into eval keeps that stricter verdict. Only the heredoc path uses this;
// piped stdin into eval stays inert.
const heredocRunner = (simple: Simple): boolean => stdinRunner(simple) || unwrap(simple.argv).cmd === "eval"

const flagsSimple = (simple: Simple, stages: readonly Simple[], run: (inner: string) => boolean): boolean => {
  if (simple.redirects.some((redirect) => redirect.write && NAMES.test(redirect.target))) return true
  const names = (word: string) => NAMES.test(word)
  const position = stages.indexOf(simple)
  const earlier = stages.slice(0, position).filter((stage) => stage.pipeline === simple.pipeline)
  const stdinNames = earlier.some((stage) => stage.argv.some(names))
  if (flagsExec(simple.argv, stdinNames, run)) return true
  // The heredoc overrides piped stdin: a stdin-executing receiver runs the body (or, for
  // eval, is judged on it for parity with the textual scan).
  if (simple.heredocs.length > 0 && heredocRunner(simple)) return simple.heredocs.some((body) => run(body))
  if (stdinRunner(simple)) {
    // The pipeline's output is this command's program text: the earlier stages' arguments
    // are the words it may execute, judged command by command rather than as one loose line.
    return earlier.some((stage) => {
      const { args } = unwrap(stage.argv)
      return args.length > 0 && run(args.join(" "))
    })
  }
  if (simple.heredocs.length === 0) return false
  const downstream = stages.slice(position + 1).some((stage) => stage.pipeline === simple.pipeline && heredocRunner(stage))
  return downstream && simple.heredocs.some((body) => run(body))
}

const analyze = (text: string, env: Env): boolean => {
  let nested = false
  const run = (inner: string) => {
    const flagged = analyze(inner, env)
    if (flagged) nested = true
    return flagged
  }
  const commands = lex(text, env, run)
  return nested || commands.some((simple) => flagsSimple(simple, commands, run))
}

export const flagsShellCommand = (command: string): boolean => {
  try {
    return analyze(command, new Map())
  } catch {
    return flagsTextualCommand(command)
  }
}
