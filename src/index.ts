import { Plugin } from "@opencode/plugin"
import { realpathSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"

// Agents may edit the global AGENTS.md only after the user answers "Yes" to QUESTION through the
// question tool, and only until the user's next message in that session. Edits are denied rather
// than asked because an auto-accepting client approves every permission ask; the question form is
// answered by the user. Shell commands are matched on their raw text, because the permission
// scanner does not report redirection targets.
const CONFIG_DIR = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "opencode")
const PROTECTED = join(CONFIG_DIR, "AGENTS.md")
const QUESTION = "Do you want to proceed with editing the global AGENTS.md?"
const YES = "Yes"
const MESSAGE = [
  "The global AGENTS.md is protected.",
  `Ask the user with the question tool: header "AGENTS.md edit", question exactly "${QUESTION}",`,
  `options "${YES}" (apply the edit) and "No" (leave it unchanged).`,
  `Retry the edit only after the answer "${YES}". If you cannot use the question tool, report this to your parent.`,
].join(" ")
const MENTIONS_FILE = /AGENTS\.md/
const MENTIONS_CONFIG_DIR = [
  /~\/\.config\/opencode/,
  /\$\{?HOME\}?\/\.config\/opencode/,
  /\$\{?XDG_CONFIG_HOME\}?\/opencode/,
]

interface QuestionInput {
  readonly questions?: ReadonlyArray<{ readonly question?: unknown }>
}

const canonical = (path: string) => {
  try {
    return realpathSync(path)
  } catch {
    try {
      return join(realpathSync(dirname(path)), path.slice(dirname(path).length + 1))
    } catch {
      return path
    }
  }
}

const expandHome = (path: string) => (path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(1)) : path)

export default Plugin.define({
  id: "protect-agents-md",
  async setup(ctx) {
    const target = canonical(PROTECTED)
    const configDir = canonical(CONFIG_DIR)
    const flaggedShellCalls = new Set<string>()
    const unlocked = new Set<string>()

    const isProtected = (path: string) => canonical(resolve(ctx.location.directory, expandHome(path))) === target

    const touchesProtected = (command: string, workdir: string | undefined) => {
      if (!MENTIONS_FILE.test(command)) return false
      if (command.includes(CONFIG_DIR) || command.includes(configDir)) return true
      if (MENTIONS_CONFIG_DIR.some((pattern) => pattern.test(command))) return true
      return canonical(resolve(ctx.location.directory, expandHome(workdir ?? "."))) === configDir
    }

    await ctx.session.hook("prompt", (event) => {
      unlocked.delete(event.sessionID)
    })

    await ctx.tool.hook("execute.before", (event) => {
      if (event.tool !== "shell" || typeof event.input !== "object" || event.input === null) return
      const { command, workdir } = event.input as { command?: unknown; workdir?: unknown }
      if (typeof command !== "string") return
      if (touchesProtected(command, typeof workdir === "string" ? workdir : undefined)) flaggedShellCalls.add(event.id)
    })

    await ctx.tool.hook("execute.after", (event) => {
      flaggedShellCalls.delete(event.id)
      if (event.tool !== "question" || event.status !== "completed") return
      const questions = (event.input as QuestionInput | undefined)?.questions ?? []
      const answers = (event.result.metadata as { answers?: unknown } | undefined)?.answers
      if (!Array.isArray(answers)) return
      const approved = questions.some((question, index) => {
        const answer = answers[index]
        return question.question === QUESTION && Array.isArray(answer) && answer.length === 1 && answer[0] === YES
      })
      if (approved) unlocked.add(event.sessionID)
    })

    await ctx.permission.hook("evaluate", (event) => {
      if (event.effect === "deny" || unlocked.has(event.sessionID)) return
      const flagged =
        (event.action === "edit" && event.resources.some(isProtected)) ||
        (event.action === "shell" && event.source?.type === "tool" && flaggedShellCalls.has(event.source.id))
      if (!flagged) return
      event.effect = "deny"
      event.message = MESSAGE
    })
  },
})
