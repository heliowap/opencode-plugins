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
// consume a separate value.
const TIME_VALUE_OPTS = new Set(["-f", "--format", "-o", "--output"])

// Commands whose argv[0] wraps another command; option-with-value arguments are skipped so the
// wrapped command becomes argv[0]. env and sudo also take VAR=value words, timeout takes a
// duration. "cmdOpts" are options whose value is itself a command string (flock -c),
// "positional" counts leading operands that are not the command (chroot's directory, flock's
// lock file, taskset's mask), and "positionalOpts" are value options that satisfy that
// operand themselves (taskset -c gives the mask inline).
const WRAPPERS: Record<
  string,
  {
    opts: ReadonlySet<string>
    assigns?: boolean
    positional?: number
    cmdOpts?: ReadonlySet<string>
    positionalOpts?: ReadonlySet<string>
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
  time: { opts: TIME_VALUE_OPTS },
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
// Shell grammar words that open a command position without being commands themselves.
const KEYWORDS = new Set(["if", "then", "elif", "else", "fi", "for", "while", "until", "do", "done", "case", "esac", "select", "function", "time", "coproc", "!"])

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
  let i = 0

  const pushWord = (word: string) => {
    if (timeState === "value") {
      timeState = "opts"
      return
    }
    if (timeState === "opts" && word.startsWith("-")) {
      if (TIME_VALUE_OPTS.has(word)) timeState = "value"
      return
    }
    timeState = "off"
    if (argv.length === 0 && KEYWORDS.has(word)) {
      if (word === "time") timeState = "opts"
      return
    }
    // Shells only take VAR=value words in command position; a "name=value" argument
    // elsewhere (echo F=x) is data and must not feed variable expansion.
    const assign = /^([A-Za-z_]\w*)=(.*)$/s.exec(word)
    if (assign && argv.every((arg) => /^[A-Za-z_]\w*=/.test(arg))) env.set(assign[1]!, assign[2]!)
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
    if (c === "(" || c === ")" || c === "{" || c === "}") {
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

// A write API call in script text flags only when its own path expression names AGENTS.md.
const scriptFlags = (text: string, run: (inner: string) => boolean): boolean => {
  for (const match of text.matchAll(METHOD_WRITE)) if (exprNames(match[1]!)) return true
  for (const match of text.matchAll(RENAME_TARGET)) if (exprNames(match[1]!)) return true
  for (const match of text.matchAll(OPEN_WRITE)) if (exprNames(match[1]!)) return true
  for (const match of text.matchAll(PATH_WRITE)) if (exprNames(match[1]!)) return true
  for (const match of text.matchAll(COPY_WRITE)) if (exprNames(match[1]!) || exprNames(match[2]!)) return true
  for (const match of text.matchAll(SHELL_OUT)) if (run(shellText(match[1]!))) return true
  return false
}

// Drops leading VAR=value words and command wrappers (sudo, env, nice, …) so argv[0] is the
// command that actually runs. An option that carries a command string (flock -c) is reported
// as "cmdString"; options may sit on either side of a wrapper's positional operands.
const unwrap = (argv: readonly string[]): { cmd: string; args: readonly string[]; cmdString?: string } => {
  let i = 0
  let cmdString: string | undefined
  for (;;) {
    if (/^[A-Za-z_]\w*=/.test(argv[i] ?? "")) {
      i++
      continue
    }
    const wrapper = WRAPPERS[basenameOf(argv[i] ?? "")]
    if (wrapper === undefined) return { cmd: basenameOf(argv[i] ?? ""), args: argv.slice(i + 1), cmdString }
    i++
    let positional = wrapper.positional ?? 0
    for (;;) {
      while (i < argv.length && argv[i]!.startsWith("-")) {
        const opt = argv[i]!
        if (wrapper.cmdOpts?.has(opt)) {
          if (argv[i + 1] !== undefined) cmdString = argv[i + 1]
          i += 2
          continue
        }
        if (wrapper.positionalOpts?.has(opt)) {
          positional = 0
          i += 2
          continue
        }
        i += wrapper.opts.has(opt) ? 2 : 1
      }
      while (wrapper.assigns === true && i < argv.length && /^[A-Za-z_]\w*=/.test(argv[i]!)) i++
      if (positional > 0 && i < argv.length && !argv[i]!.startsWith("-")) {
        positional--
        i++
        continue
      }
      break
    }
  }
}

const flagsSimple = (simple: Simple, stages: readonly Simple[], run: (inner: string) => boolean): boolean => {
  if (simple.redirects.some((redirect) => redirect.write && NAMES.test(redirect.target))) return true
  const { cmd, args, cmdString } = unwrap(simple.argv)
  // An option like flock's "-c" carries a command string: it is analyzed as a command.
  if (cmdString !== undefined && run(cmdString)) return true
  // The remote command of ssh runs on another machine; only its local redirects count.
  if (cmd === "ssh") return false
  const names = (word: string) => NAMES.test(word)
  // A shell's "-c" argument carries a nested command, alone or inside a single-dash
  // option cluster such as "-lc" or "-ec".
  if (SHELL_CMDS.has(cmd)) {
    for (const [index, arg] of args.entries()) {
      if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(arg) && args[index + 1] !== undefined && run(args[index + 1]!)) return true
    }
  }
  if (WRITER_NAMES.has(cmd) && args.some(names)) return true
  if (cmd === "xargs") {
    // xargs gets its arguments from the pipe: "… AGENTS.md | xargs rm" removes them.
    let j = 0
    while (j < args.length && args[j]!.startsWith("-")) j += XARGS_OPTS.has(args[j]!) ? 2 : 1
    if (WRITER_NAMES.has(basenameOf(args[j] ?? ""))) {
      const earlier = stages.slice(0, stages.indexOf(simple)).filter((stage) => stage.pipeline === simple.pipeline)
      if (args.some(names) || earlier.some((stage) => stage.argv.some(names))) return true
    }
  }
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
  if (simple.argv.some((word) => scriptFlags(word, run))) return true
  return simple.heredocs.some((body) => run(body))
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
