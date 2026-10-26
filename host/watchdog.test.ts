import { afterEach, describe, expect, test } from "bun:test"
import { afterToolResult, mentions, toolResults, type ChatRequest, type Script } from "./harness/fixture.ts"
import { Host } from "./harness/host.ts"

const TIMEOUT = 120_000
const CHILD = "STALL-CHILD"
const WATCHDOG = "[goal] Watchdog: subagent session"
let host: Host | undefined

afterEach(async () => {
  await host?.stop()
  host = undefined
})

const dispatch = { tool: "subagent", args: { agent: "general", description: "stall", prompt: CHILD } }

const parent = (request: ChatRequest) => {
  if (mentions(request, WATCHDOG)) return { text: "Noted the stall." }
  if (afterToolResult(request)) return { text: "Parent done." }
  return dispatch
}

describe("watchdog", () => {
  test(
    "W1 a silent subagent is interrupted and the parent receives a notice",
    async () => {
      const script: Script = (request) =>
        mentions(request, CHILD) ? { text: "late reply", delayMs: 30_000 } : parent(request)
      host = await Host.start({ allowAll: true, pluginOptions: { watchdogStallMs: 1500 }, script })
      const session = await host.session()

      const started = Date.now()
      await host.prompt(session, "dispatch the stalling subagent")
      await host.settle(session)
      expect(Date.now() - started).toBeLessThan(30_000)

      const results = host.fixture.agentRequests().flatMap(toolResults)
      expect(results.some((result) => result.includes("Subagent cancelled (sessionID:"))).toBe(true)
      expect(host.fixture.requests.filter((request) => mentions(request, CHILD))).toHaveLength(1)
      expect(host.fixture.requests.filter((request) => mentions(request, WATCHDOG))).toHaveLength(1)
    },
    TIMEOUT,
  )

  test(
    "W2 a subagent running a shell command is not stalled while the call is open",
    async () => {
      const child = (request: ChatRequest) =>
        afterToolResult(request) ? { text: "child done" } : { tool: "shell", args: { command: "sleep 3" } }
      const script: Script = (request) => (mentions(request, CHILD) ? child(request) : parent(request))
      host = await Host.start({ allowAll: true, pluginOptions: { watchdogStallMs: 1500 }, script })
      const session = await host.session()

      await host.prompt(session, "dispatch the subagent with a slow command")
      await host.settle(session)

      const results = host.fixture.agentRequests().flatMap(toolResults)
      expect(results.some((result) => result.includes("child done"))).toBe(true)
      await Bun.sleep(3_000)
      expect(host.fixture.requests.filter((request) => mentions(request, WATCHDOG))).toHaveLength(0)
    },
    TIMEOUT,
  )
})
