// Shell commands are flagged only when their raw text shows a write to an AGENTS.md file; every
// other command runs. The scan is textual and ignores quoting, so a quoted ">" or writer name next
// to AGENTS.md is still flagged. Writes hidden behind indirection the text does not show (a path
// built at runtime, a script file) are out of scope here; the process guard covers those.
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

export const flagsShellCommand = (command: string): boolean => {
  const expanded = expandMentions(command)
  if (!MENTION.test(expanded)) return false
  if (REDIRECT.test(expanded) || OUTPUT_OPTION.test(expanded) || SED_WRITE.test(expanded)) return true
  if (expanded.split("\n").some((line) => MENTION.test(line) && SCRIPT_WRITE.test(line))) return true
  return commandsOf(expanded).some(
    (part) => MENTION.test(part) && (WRITERS.test(part) || IN_PLACE.test(part) || GIT_WRITE.test(part) || FIND_ACTION.test(part)),
  )
}
