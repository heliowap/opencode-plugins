import { afterEach, describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { afterToolResult, CONTINUATION, count, mentions, text, toolNames, toolResults, type Script } from "./harness/fixture.ts"
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
      // OpenCode 2.2.5 ships a built-in `goal` command that wins the listing, so the plugin's
      // description cannot be asserted here; executing /goal still reaches this plugin, as the
      // goal_* tools below and the end-to-end canaries prove.
      expect(commands.data.some((command) => command.name === "goal")).toBe(true)

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
        note: "3 consecutive turns produced no visible text or progress. Run /goal resume to continue.",
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
    "A18 two steps of one goal turn receive byte-identical goal_context (#5)",
    async () => {
      host = await Host.start({
        script: (request) => {
          const results = toolResults(request).length
          if (results === 0) return { tool: "write", args: { path: "a.txt", content: "1" } }
          if (results === 1) return { tool: "goal_update", args: { status: "complete", note: "done" } }
          return { text: "Done." }
        },
      })
      const session = await host.session()
      await host.goal(session, "stable context")
      await host.settle(session)

      const contexts = host.fixture.agentRequests().map((request) => {
        const system = request.messages.filter((message) => message.role === "system").map(text).join("\n")
        return /<goal_context>[\s\S]*?<\/goal_context>/.exec(system)?.[0]
      })
      expect(contexts).toHaveLength(3)
      expect(contexts[0]).toContain("<goal_context>")
      expect(contexts[1]).toBe(contexts[0])
      // The goal settled, so the last request's system text carries no goal_context, while usage kept counting.
      expect(contexts[2]).toBeUndefined()
      // The two goal-context requests differed in charged usage (120 then 240), so identical text is not vacuous.
      expect(host.stored(session)).toMatchObject({ status: "complete", tokensUsed: 240 })
    },
    TIMEOUT,
  )

  test(
    "A20 turns without progress back off exponentially instead of polling every cooldown (#6)",
    async () => {
      const starts: number[] = []
      host = await Host.start({
        pluginOptions: { continuationDelayMs: 400 },
        script: () => {
          starts.push(Date.now())
          return { text: "Same reply." }
        },
      })
      const session = await host.session()
      await host.goal(session, "keep replying")
      await host.until(() => starts.length >= 6, 60_000)

      // The first request is the goal's first turn; each later request waits idleTurns * 400 ms.
      const bounds = [350, 750, 1550, 3150, 6350]
      const gaps = starts.slice(1).map((start, index) => start - starts[index]!)
      for (const [index, gap] of gaps.entries()) {
        expect(gap).toBeGreaterThanOrEqual(bounds[index]!)
      }
      await host.until(() => host!.stored(session)?.idleTurns === 6, 30_000)
      expect(host.stored(session)).toMatchObject({ status: "active", emptyTurns: 0 })
      expect(continuations(await host.messages(session))).toBe(6)
    },
    TIMEOUT,
  )

  test(
    "A21 a running child suppresses the parent's continuation, and the child's end emits exactly one (#6)",
    async () => {
      const CHILD = "QUIET-CHILD"
      const script: Script = (request) => {
        // The child session answers slowly; the parent replies and ends its turn while it runs.
        if (mentions(request, CHILD)) return { text: "child done", delayMs: 4_000 }
        if (toolResults(request).length === 0) {
          return count(request, CONTINUATION) >= 2
            ? { tool: "goal_update", args: { status: "complete", note: "child reported" } }
            : { text: "Parent working." }
        }
        return { text: "Parent done." }
      }
      host = await Host.start({ allowAll: true, script })
      const session = await host.session()
      const child = await host.session("build", session.id)
      await host.prompt(child, CHILD)
      await host.goal(session, "wait for the child report")

      // The parent's turn ends while the child is still answering (4 s delay): no continuation.
      await host.until(() => host!.stored(session)?.idleTurns === 1)
      await Bun.sleep(1_500)
      expect(host.fixture.agentRequests().filter((request) => !mentions(request, CHILD))).toHaveLength(1)
      expect(continuations(await host.messages(session))).toBe(1)

      // The child's end schedules the parent's one continuation, which completes the goal.
      await host.until(() => host!.stored(session)?.status === "complete")
      await host.settle(session)
      expect(host.stored(session)).toMatchObject({ status: "complete", note: "child reported", idleTurns: 1 })
      expect(host.fixture.agentRequests()).toHaveLength(4)
      expect(continuations(await host.messages(session))).toBe(2)
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
