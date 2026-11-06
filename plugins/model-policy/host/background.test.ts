import { afterEach, describe, expect, test } from "bun:test"
import { run, stopRuns, text, toolResults, type Call, type ChatRequest, type Reply } from "./harness/fixture.ts"

const TIMEOUT = 120_000
const CHILD_PROMPT = "child task"
const GRANDCHILD_PROMPT = "nested task"
// OpenCode refuses a subagent call from a child session at the default depth of 1.
const NESTED = { experimental: { subagent_depth: 2 } }

afterEach(stopRuns)

const promptedWith = (request: ChatRequest, prompt: string) =>
  request.messages.some((message) => message.role === "user" && text(message).includes(prompt))

const shell = (command: string): Reply => ({ tool: "shell", args: { command, background: true } })

// The parent dispatches a foreground child, then runs a background shell command of its own.
// The child asks for a background shell command and a background grandchild.
const script = (call: Call): Reply => {
  const { request } = call
  const done = toolResults(request).length
  if (promptedWith(request, GRANDCHILD_PROMPT)) return { text: "grandchild answer" }
  if (promptedWith(request, CHILD_PROMPT)) {
    if (done === 0) return shell("sleep 1 && echo child-shell-finished")
    if (done === 1)
      return { tool: "subagent", args: { agent: "general", description: "nested", prompt: GRANDCHILD_PROMPT, background: true } }
    return { text: "child done" }
  }
  if (done === 0) return { tool: "subagent", args: { agent: "general", description: "delegate", prompt: CHILD_PROMPT } }
  if (done === 1) return shell("sleep 1 && echo parent-shell-finished")
  return { text: "parent done" }
}

type ToolSchema = { function: { name: string; parameters: { properties: Record<string, unknown> } } }

const optionsOf = (request: ChatRequest, name: string) =>
  Object.keys((request.tools as unknown as ToolSchema[]).find((tool) => tool.function.name === name)!.function.parameters.properties)

const isParent = (call: Call) => !promptedWith(call.request, CHILD_PROMPT) && !promptedWith(call.request, GRANDCHILD_PROMPT)

describe("background in child sessions", () => {
  test(
    "a child session's shell and subagent offer no background option, and its background calls wait in its own turn",
    async () => {
      const { host } = await run({ script, config: NESTED })
      const calls = host.fixture.agentCalls()
      const child = calls.filter((call) => promptedWith(call.request, CHILD_PROMPT))
      const parent = calls.filter(isParent)

      // Shell, nested subagent, final answer: a background call would add a resumed turn.
      expect(child).toHaveLength(3)
      expect(optionsOf(child[0]!.request, "shell")).toEqual(["command", "workdir", "timeout"])
      expect(optionsOf(child[0]!.request, "subagent")).toEqual(["agent", "description", "prompt", "model", "sessionID"])
      expect(optionsOf(parent[0]!.request, "shell")).toEqual(["command", "workdir", "timeout", "background"])
      expect(optionsOf(parent[0]!.request, "subagent")).toEqual(["agent", "description", "prompt", "model", "sessionID", "background"])

      const childResults = toolResults(child.at(-1)!.request)
      expect(childResults[0]).toContain("child-shell-finished")
      expect(childResults[1]).toContain("grandchild answer")
    },
    TIMEOUT,
  )

  test(
    "a top-level session's background shell call still returns before the command finishes",
    async () => {
      const { host } = await run({ script, config: NESTED })
      const parent = host.fixture.agentCalls().filter(isParent)
      const afterShell = parent.find((call) => toolResults(call.request).length === 2)!

      expect(toolResults(afterShell.request)[0]).toContain("child done")
      expect(toolResults(afterShell.request)[1]).toContain("Command moved to the background")
    },
    TIMEOUT,
  )
})
