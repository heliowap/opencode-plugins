import { Plugin } from "@opencode/plugin"
import { realpathSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { flagsShellCommand } from "./shell-write.ts"

// Agents may edit any AGENTS.md (the global one and every repo's, including new ones) only after
// the user answers "Yes" through the question tool to QUESTION or to the question this plugin
// issued (see `approves`), and only until the user's next message in that session. Edits are
// denied rather than asked because an auto-accepting client approves every permission ask; the
// question form is answered by the user. Shell commands are matched on their raw text, because the permission scanner does not
// report redirection targets; only commands whose text shows a write to AGENTS.md are flagged
// (see shell-write.ts).
const FILE_NAME = "agents.md"
const QUESTION = "Do you want to proceed with editing AGENTS.md?"
const YES = "Yes"
const MAX_COMMAND = 300
const MAX_CHANGE = 500

const HEADER = "AGENTS.md edit"
const OPTIONS = [
  { label: YES, description: "apply the edit" },
  { label: "No", description: "leave it unchanged" },
]

const ask = (target: string) => ({
  questions: [{ header: HEADER, question: `${QUESTION} ${target}. Change: <change>`, options: OPTIONS }],
})

// The message leads with the action and carries the question tool input, so the agent copies
// it instead of assembling the call from prose. The target and the agent's <change> give the
// user what the bare question lacked: which file and what the edit does.
const message = (target: string) =>
  [
    `Stop and call the question tool with this input, replacing <change> with what the edit changes and why, then retry only if the answer is "${YES}":`,
    JSON.stringify(ask(target)),
    "Keep the question's first sentence and target as written. If you cannot use the question tool, report this to your parent.",
  ].join("\n")

// Control, format and line-separator characters: line breaks, bidi overrides, terminal escapes.
// They could make agent-written text in the question read as a different question.
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u

// Also rejected in the agent's <change>: private-use, unassigned and surrogate code points,
// blank-looking letters (Hangul fillers, braille blank), variation selectors, and runs of
// whitespace that could pad text onto what looks like a new line.
const UNREADABLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cn}\p{Cs}\u115F\u1160\u3164\uFFA0\u2800\uFE00-\uFE0F]|\s{2,}/u

// The target text comes from the agent (its command or path), so invisible characters are shown
// as \u{…} escapes and the question stays one visible line.
const visible = (text: string) =>
  text.replace(new RegExp(INVISIBLE.source, "gu"), (char) => `\\u{${char.codePointAt(0)!.toString(16)}}`)

// Keeps the head and the tail, where a redirect target such as `> AGENTS.md` usually sits, and
// cuts on code points so an emoji is never split.
const shorten = (command: string) => {
  const points = Array.from(command)
  if (points.length <= MAX_COMMAND) return command
  const half = MAX_COMMAND / 2
  return `${points.slice(0, half).join("")} … ${points.slice(-half).join("")}`
}

interface Question {
  readonly header?: unknown
  readonly question?: unknown
  readonly options?: unknown
}

interface QuestionInput {
  readonly questions?: ReadonlyArray<Question>
}

// Approval accepts the plugin's header and options around the bare question, or exactly the
// question this plugin issued for a target in the session with a one-line readable change. Any
// other agent-written text (a free-form tail, another header, reworded options) could reframe
// what the user's Yes answers.
// Compared field by field: models reorder object keys when they copy JSON.
const sameOptions = (options: unknown) =>
  Array.isArray(options) &&
  options.length === OPTIONS.length &&
  options.every((option: { label?: unknown; description?: unknown } | null, index) => {
    const expected = OPTIONS[index]!
    return (
      typeof option === "object" &&
      option !== null &&
      Object.keys(option).length === 2 &&
      option.label === expected.label &&
      option.description === expected.description
    )
  })

const approves = (entry: Question, targets: ReadonlySet<string>) => {
  if (entry.header !== HEADER || !sameOptions(entry.options)) return false
  const question = entry.question
  if (typeof question !== "string") return false
  if (question === QUESTION) return true
  for (const target of targets) {
    const lead = `${QUESTION} ${target}. Change: `
    if (!question.startsWith(lead)) continue
    const change = question.slice(lead.length)
    if (change.length > 0 && change.length <= MAX_CHANGE && !UNREADABLE.test(change)) return true
  }
  return false
}

const canonical = (path: string) => {
  try {
    return realpathSync(path)
  } catch {
    try {
      return join(realpathSync(dirname(path)), basename(path))
    } catch {
      return path
    }
  }
}

const expandHome = (path: string) => (path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(1)) : path)

export default Plugin.define({
  id: "protect-agents-md",
  async setup(ctx) {
    const flaggedShellCalls = new Map<string, string>()
    const unlocked = new Set<string>()
    const issued = new Map<string, Set<string>>()

    const absolute = (path: string) => resolve(ctx.location.directory, expandHome(path))
    const isProtected = (path: string) => basename(canonical(absolute(path))).toLowerCase() === FILE_NAME

    await ctx.session.hook("prompt", (event) => {
      unlocked.delete(event.sessionID)
      issued.delete(event.sessionID)
    })

    await ctx.tool.hook("execute.before", (event) => {
      if (event.tool !== "shell" || typeof event.input !== "object" || event.input === null) return
      const { command } = event.input as { command?: unknown }
      if (typeof command === "string" && flagsShellCommand(command)) flaggedShellCalls.set(event.id, command)
    })

    await ctx.tool.hook("execute.after", (event) => {
      flaggedShellCalls.delete(event.id)
      if (event.tool !== "question" || event.status !== "completed") return
      const questions = (event.input as QuestionInput | undefined)?.questions ?? []
      const answers = (event.result.metadata as { answers?: unknown } | undefined)?.answers
      if (!Array.isArray(answers)) return
      const targets = issued.get(event.sessionID) ?? new Set<string>()
      const approved = questions.some((question, index) => {
        const answer = answers[index]
        return (
          approves(question, targets) &&
          Array.isArray(answer) &&
          answer.length === 1 &&
          answer[0] === YES
        )
      })
      if (approved) unlocked.add(event.sessionID)
    })

    await ctx.permission.hook("evaluate", (event) => {
      if (event.effect === "deny" || unlocked.has(event.sessionID)) return
      const files = event.action === "edit" ? [...new Set(event.resources.filter(isProtected).map((path) => canonical(absolute(path))))] : []
      const command =
        event.action === "shell" && event.source?.type === "tool" ? flaggedShellCalls.get(event.source.id) : undefined
      const raw = files.length > 0 ? `File: ${files.join(", ")}` : command !== undefined ? `Command: ${shorten(command)}` : undefined
      if (raw === undefined) return
      const target = visible(raw)
      issued.set(event.sessionID, (issued.get(event.sessionID) ?? new Set<string>()).add(target))
      event.effect = "deny"
      event.message = message(target)
    })
  },
})
