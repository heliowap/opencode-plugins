import { afterEach, describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { afterToolResult, CONTINUATION, count, toolNames, type Script } from "./harness/fixture.ts"
import { Host, type Message } from "./harness/host.ts"

const TIMEOUT = 120_000
let host: Host | undefined

afterEach(async () => {
  await host?.stop()
  host = undefined
})

const continuations = (messages: Message[]) =>
  messages.filter((message) => message.type === "synthetic" && String(message.text).startsWith(CONTINUATION)).length

describe("lifecycle", () => {
  test(
    "A1 the plugin registers /goal and exposes its three tools to the model",
    async () => {
      host = await Host.start({
        script: (request) =>
          afterToolResult(request) ? { text: "Loaded." } : { tool: "goal_update", args: { status: "complete", note: "loaded" } },
      })
      const commands = (await host.json("GET", `/api/command?location[directory]=${encodeURIComponent(host.project)}`)) as {
        data: { name: string; description: string }[]
      }
      expect(commands.data.find((command) => command.name === "goal")).toEqual({
        name: "goal",
        description: "Set, show, edit, pause, resume, or clear the session's persistent goal",
      })

      const session = await host.session()
      await host.goal(session, "load check")
      await host.settle(session)
      const tools = toolNames(host.fixture.agentRequests()[0]!)
      expect(tools).toContain("goal_create")
      expect(tools).toContain("goal_get")
      expect(tools).toContain("goal_update")
    },
    TIMEOUT,
  )

  test(
    "A2 a goal continues turn after turn and stops once the model completes it",
    async () => {
      const script: Script = (request) => {
        if (afterToolResult(request)) return { text: "Step done." }
        const turn = count(request, CONTINUATION)
        if (turn === 1) return { tool: "write", args: { path: "a.txt", content: "1" } }
        if (turn === 2) return { tool: "write", args: { path: "b.txt", content: "2" } }
        return { tool: "goal_update", args: { status: "complete", note: "a.txt=1, b.txt=2 verified" } }
      }
      host = await Host.start({ script })
      const session = await host.session()
      await host.goal(session, "write a.txt and b.txt")
      await host.settle(session)

      expect(host.stored(session)).toMatchObject({
        objective: "write a.txt and b.txt",
        status: "complete",
        note: "a.txt=1, b.txt=2 verified",
      })
      expect(await readFile(join(host.project, "a.txt"), "utf8")).toBe("1")
      expect(await readFile(join(host.project, "b.txt"), "utf8")).toBe("2")
      expect(continuations(await host.messages(session))).toBe(3)
      expect(host.fixture.agentRequests()).toHaveLength(6)
    },
    TIMEOUT,
  )

  test(
    "A3 turns that only reply with text keep the goal going",
    async () => {
      host = await Host.start({
        script: (request) => {
          if (afterToolResult(request)) return { text: "Closing." }
          const turn = count(request, CONTINUATION)
          return turn < 3 ? { text: `Progress note ${turn}.` } : { tool: "goal_update", args: { status: "complete", note: "three notes" } }
        },
      })
      const session = await host.session()
      await host.goal(session, "write three progress notes")
      await host.settle(session)

      expect(host.stored(session)).toMatchObject({ status: "complete", emptyTurns: 0 })
      expect(continuations(await host.messages(session))).toBe(3)
    },
    TIMEOUT,
  )

  test(
    "A4 three empty turns in a row block the goal and stop the loop",
    async () => {
      host = await Host.start({ script: () => ({ empty: true }) })
      const session = await host.session()
      await host.goal(session, "never answers")
      await host.settle(session)

      expect(host.stored(session)).toMatchObject({
        status: "blocked",
        emptyTurns: 3,
        note: "3 consecutive turns produced no visible text or file edits. Run /goal resume to continue.",
      })
      expect(continuations(await host.messages(session))).toBe(3)
      expect(host.fixture.agentRequests()).toHaveLength(3)
    },
    TIMEOUT,
  )

  test(
    "A4b observation-only tool turns reach the empty-turn brake",
    async () => {
      host = await Host.start({
        script: (request) => afterToolResult(request) ? { empty: true } : { tool: "goal_get", args: {} },
      })
      const session = await host.session()
      await host.goal(session, "poll goal status")
      await host.until(() => host!.stored(session)?.status === "blocked")
      await host.settle(session)

      expect(host.stored(session)).toMatchObject({ status: "blocked", emptyTurns: 3 })
      expect(continuations(await host.messages(session))).toBe(3)
      expect(host.fixture.agentRequests()).toHaveLength(6)
    },
    TIMEOUT,
  )

  test(
    "A4c automatic continuations wait quietly and survive a location reload",
    async () => {
      const starts: number[] = []
      host = await Host.start({
        pluginOptions: { continuationDelayMs: 3_000 },
        script: (request) => {
          if (afterToolResult(request)) return { text: "Done." }
          starts.push(Date.now())
          return count(request, CONTINUATION) === 1
            ? { text: "First step." }
            : { tool: "goal_update", args: { status: "complete", note: "waited" } }
        },
      })
      const session = await host.session()
      await host.goal(session, "wait between automatic turns")
      await host.until(() => host!.stored(session)?.continueAt !== undefined)
      const due = host.stored(session)!.continueAt!
      expect(host.fixture.agentRequests()).toHaveLength(1)
      expect(continuations(await host.messages(session))).toBe(1)
      await host.json("POST", "/api/location/reload")
      await host.until(() => host!.stored(session)?.status === "complete")
      await host.settle(session)

      expect(starts).toHaveLength(2)
      expect(starts[1]! >= due).toBe(true)
      expect(starts[1]! - starts[0]! >= 3_000).toBe(true)
      expect(host.fixture.agentRequests()).toHaveLength(3)
      expect(continuations(await host.messages(session))).toBe(2)
    },
    TIMEOUT,
  )

  test(
    "A4d a successful file write resets an observation-only streak without text",
    async () => {
      host = await Host.start({
        script: (request) => {
          if (afterToolResult(request)) return { empty: true }
          return count(request, CONTINUATION) === 3
            ? { tool: "write", args: { path: "progress.txt", content: "made progress" } }
            : { tool: "goal_get", args: {} }
        },
      })
      const session = await host.session()
      await host.goal(session, "write once between polls")
      await host.until(() => host!.stored(session)?.status === "blocked")
      await host.settle(session)

      expect(host.stored(session)).toMatchObject({ status: "blocked", emptyTurns: 3 })
      expect(await readFile(join(host.project, "progress.txt"), "utf8")).toBe("made progress")
      expect(continuations(await host.messages(session))).toBe(6)
      expect(host.fixture.agentRequests()).toHaveLength(12)
    },
    TIMEOUT,
  )

  test(
    "A4e pausing during a cooldown prevents a stale continuation after reload",
    async () => {
      host = await Host.start({
        pluginOptions: { continuationDelayMs: 1_000 },
        script: () => ({ text: "Waiting." }),
      })
      const session = await host.session()
      await host.goal(session, "wait for the user")
      await host.until(() => host!.stored(session)?.continueAt !== undefined)
      await host.goal(session, "pause")
      await host.json("POST", "/api/location/reload")
      await Bun.sleep(1_500)
      await host.settle(session)

      expect(host.stored(session)?.status).toBe("paused")
      expect(continuations(await host.messages(session))).toBe(1)
      expect(host.fixture.agentRequests()).toHaveLength(1)
    },
    TIMEOUT,
  )

  test(
    "A4f failed file writes do not reset the empty-turn brake",
    async () => {
      host = await Host.start({
        script: (request) => afterToolResult(request)
          ? { empty: true }
          : { tool: "write", args: { path: ".", content: "not a file" } },
      })
      const session = await host.session()
      await host.goal(session, "cannot write a directory")
      await host.until(() => host!.stored(session)?.status === "blocked")
      await host.settle(session)

      expect(host.stored(session)).toMatchObject({ status: "blocked", emptyTurns: 3 })
      expect(continuations(await host.messages(session))).toBe(3)
      expect(host.fixture.agentRequests()).toHaveLength(6)
    },
    TIMEOUT,
  )

  test(
    "A9 a plan-agent turn neither counts tokens nor continues",
    async () => {
      host = await Host.start({ script: () => ({ text: "Here is a plan." }) })
      const session = await host.session("plan")
      await host.goal(session, "plan the work")
      await host.settle(session)

      expect(host.stored(session)).toMatchObject({ status: "active", tokensUsed: 0, emptyTurns: 0 })
      expect(continuations(await host.messages(session))).toBe(1)
      const last = host.fixture.agentRequests().at(-1)!
      expect(count(last, CONTINUATION)).toBe(1)
    },
    TIMEOUT,
  )
})
