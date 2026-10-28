import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { afterToolResult, text, toolResults, type Script } from "./harness/fixture.ts"
import { Host } from "./harness/host.ts"

const TIMEOUT = 120_000
let host: Host | undefined

afterEach(async () => {
  await host?.stop()
  host = undefined
})

const script: Script = (request) => {
  if (text(request.messages.at(-1)!).startsWith("[goal]")) return { text: "Noted." }
  const results = toolResults(request)
  if (!afterToolResult(request)) return { tool: "goal_create", args: { objective: "a second goal" } }
  if (results.length === 1) return { tool: "goal_update", args: { status: "complete", note: "done" } }
  return { text: "Done." }
}

const logFile = (host: Host) => join(host.root, "data", "opencode", "log", "goal.jsonl")

const records = (host: Host) =>
  readFileSync(logFile(host), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>)

describe("trace log", () => {
  test(
    "L1 the log records typed commands, transitions, and failed tool calls",
    async () => {
      host = await Host.start({ script })
      const session = await host.session()
      // The two notices wait in the inbox and reach the goal's first turn, which answers them in one more step.
      await host.goal(session, "pause")
      await host.goal(session, "--tokens nope go")
      await host.goal(session, "trace me")
      await host.until(() => host!.stored(session)?.status === "complete")
      await host.settle(session)

      const own = records(host).filter((record) => record.sessionID === session.id)
      expect(own.map(({ at: _at, ...rest }) => rest)).toEqual([
        { _tag: "Command", sessionID: session.id, text: "pause", result: "Pause" },
        { _tag: "Transition", sessionID: session.id, event: "Pause", from: "none", to: "none", effect: "Refuse", text: "No goal is set for this session." },
        {
          _tag: "Command",
          sessionID: session.id,
          text: "--tokens nope go",
          result: "Invalid",
          message: '--tokens needs a positive number such as 50000, 250K or 1.5M, got "nope".',
        },
        { _tag: "Command", sessionID: session.id, text: "trace me", result: "Set" },
        { _tag: "Transition", sessionID: session.id, event: "Set", from: "none", to: "active", effect: "Continue", tokensUsed: 0, objective: "trace me" },
        {
          _tag: "ToolError",
          sessionID: session.id,
          tool: "goal_create",
          message: "This session already has an unfinished goal (active). Finish it, or ask the user to replace it with /goal <objective>.",
        },
        { _tag: "Transition", sessionID: session.id, event: "Complete", from: "active", to: "complete", effect: "None", tokensUsed: 360, note: "done" },
      ])
    },
    TIMEOUT,
  )

  test(
    "L2 OPENCODE_GOAL_LOG=0 writes no log",
    async () => {
      host = await Host.start({ script, env: { OPENCODE_GOAL_LOG: "0" } })
      const session = await host.session()
      await host.goal(session, "--tokens nope go")
      await host.goal(session, "trace me")
      await host.until(() => host!.stored(session)?.status === "complete")
      await host.settle(session)

      expect(existsSync(logFile(host))).toBe(false)
    },
    TIMEOUT,
  )

  test(
    "L3 the plugin option log: false writes no log",
    async () => {
      host = await Host.start({ script, pluginOptions: { log: false } })
      const session = await host.session()
      await host.goal(session, "--tokens nope go")
      await host.goal(session, "trace me")
      await host.until(() => host!.stored(session)?.status === "complete")
      await host.settle(session)

      expect(existsSync(logFile(host))).toBe(false)
    },
    TIMEOUT,
  )

  test(
    "L4 the same package spec without options writes the log",
    async () => {
      host = await Host.start({ script, pluginOptions: {} })
      const session = await host.session()
      await host.goal(session, "trace me")
      await host.until(() => host!.stored(session)?.status === "complete")
      await host.settle(session)

      expect(existsSync(logFile(host))).toBe(true)
    },
    TIMEOUT,
  )
})
