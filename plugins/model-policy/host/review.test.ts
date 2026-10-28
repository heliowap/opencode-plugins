import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { childRoutes, OPUS, SONNET, text, toolResults, type Call, type Reply } from "./harness/fixture.ts"
import { Host } from "./harness/host.ts"

const TIMEOUT = 120_000
const SKILL_PATH = join(homedir(), ".agents", "skills", "code-review", "SKILL.md")
const HAS_SKILL = existsSync(SKILL_PATH)
const CODE_REVIEW = HAS_SKILL ? readFileSync(SKILL_PATH, "utf8") : ""
const SKILL_FILES = { "skills/code-review/SKILL.md": CODE_REVIEW }
const USER_MODEL = `${OPUS}#high`
const CHILD_MARKER = "You are a subagent spawned by another session."

let host: Host | undefined

afterEach(async () => {
  await host?.stop()
  host = undefined
})

const isChild = (call: Call) => call.request.messages.some((message) => message.role === "user" && text(message).includes(CHILD_MARKER))

const loadSkillThenDispatch =
  (dispatch: Record<string, unknown>) =>
  (call: Call): Reply => {
    if (call.provider !== "fixture") return { text: "review findings" }
    const results = toolResults(call.request)
    if (results.length === 0) return { tool: "skill", args: { id: "code-review" } }
    if (results.length === 1) return { tool: "subagent", args: { description: "standards review", prompt: "review the diff", ...dispatch } }
    return { text: "review done" }
  }

const runPrompt = async (script: (call: Call) => Reply) => {
  host = await Host.start({ script, configFiles: SKILL_FILES })
  const session = await host.session()
  await host.prompt(session, `Review since main with the code-review skill, using ${USER_MODEL}`)
  await host.settle(session)
  return host
}

describe.skipIf(!HAS_SKILL)("code-review skill activation", () => {
  test(
    "the skill loads, and a researcher it dispatches with a user-named model is still routed by the policy",
    async () => {
      const host = await runPrompt(loadSkillThenDispatch({ agent: "researcher", model: USER_MODEL }))

      const parentCalls = host.fixture.calls.filter((call) => call.provider === "fixture")
      expect(parentCalls.some((call) => toolResults(call.request).some((result) => result.includes("Two-axis review")))).toBe(true)
      expect(childRoutes(host.fixture.agentCalls())).toEqual([`${SONNET}#medium`])
    },
    TIMEOUT,
  )

  test(
    "a general reviewer it dispatches keeps the model the user named",
    async () => {
      const host = await runPrompt(loadSkillThenDispatch({ agent: "general", model: USER_MODEL }))

      expect(childRoutes(host.fixture.agentCalls())).toEqual([`${OPUS}#high`])
    },
    TIMEOUT,
  )
})

describe.skipIf(!HAS_SKILL)("commands that run as a subagent", () => {
  test(
    "a subagent command for a researcher with its own model bypasses the policy",
    async () => {
      host = await Host.start({
        script: () => ({ text: "review findings" }),
        configFiles: {
          ...SKILL_FILES,
          "commands/code-review.md": `---\nagent: researcher\nmodel: ${USER_MODEL}\nsubagent: true\n---\n\nLoad the code-review skill and review since $1.\n`,
        },
      })
      const session = await host.session()
      await host.command(session, "code-review", "main")
      await host.until(() => host!.fixture.agentCalls().some((call) => call.provider !== "fixture"))
      await host.settle(session)

      expect(childRoutes(host.fixture.agentCalls())).toEqual([`${OPUS}#high`])
    },
    TIMEOUT,
  )

  test(
    "reviewers started from inside a subagent command hit the default nesting limit",
    async () => {
      host = await Host.start({
        script: (call) => {
          if (call.provider !== "fixture" || !isChild(call)) return { text: "parent done" }
          if (toolResults(call.request).length === 0) {
            return { tool: "subagent", args: { agent: "general", description: "standards review", prompt: "review the diff" } }
          }
          return { text: "child done" }
        },
        configFiles: {
          ...SKILL_FILES,
          "commands/code-review.md": `---\nagent: general\nsubagent: true\n---\n\nLoad the code-review skill and review since $1.\n`,
        },
      })
      const session = await host.session()
      await host.command(session, "code-review", "main")
      await host.until(() => host!.fixture.agentCalls().some((call) => isChild(call) && toolResults(call.request).length > 0))
      await host.settle(session)

      const nested = host.fixture.agentCalls().flatMap((call) => (isChild(call) ? toolResults(call.request) : []))
      expect(nested.join("\n")).toContain("Subagent depth limit reached (1)")
    },
    TIMEOUT,
  )
})
