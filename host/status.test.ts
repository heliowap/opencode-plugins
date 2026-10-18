import { afterEach, describe, expect, test } from "bun:test"
import { Host } from "./harness/host.ts"

const TIMEOUT = 120_000
let host: Host | undefined

afterEach(async () => {
  await host?.stop()
  host = undefined
})

describe("status for the terminal", () => {
  test(
    "A15 goal.get returns the stored goal, and goal.changed fires on every transition",
    async () => {
      host = await Host.start({ script: () => ({ text: "Step.", delayMs: 2_000 }) })
      const session = await host.session()
      const events = host.events((type) => type === "rpc.goal.changed")
      await Bun.sleep(500)
      expect(await host.rpc("get", { sessionID: session.id })).toEqual({ goal: null })

      await host.goal(session, "--tokens 50K show me")
      await host.until(() => host!.fixture.agentRequests().length === 1)
      await host.goal(session, "pause")
      await host.settle(session)

      const stored = host.stored(session)!
      expect(stored).toMatchObject({ status: "paused", tokenBudget: 50_000 })
      expect(await host.rpc("get", { sessionID: session.id })).toEqual({ goal: stored })
      await host.until(() => events.seen.some((event) => (event.data as { goal: { status: string } | null }).goal?.status === "paused"))
      events.stop()
      const goals = events.seen.map((event) => event.data as { sessionID: string; goal: { status: string; tokensUsed: number } })
      expect(goals.map((data) => [data.sessionID, data.goal.status])).toEqual([
        [session.id, "active"],
        ...goals.slice(1, -1).map(() => [session.id, "active"]),
        [session.id, "paused"],
      ])
      expect(goals.at(-1)!.goal).toEqual(stored)

      const cleared = host.events((type) => type === "rpc.goal.changed")
      await Bun.sleep(500)
      await host.goal(session, "clear")
      await host.until(() => cleared.seen.length > 0)
      cleared.stop()
      expect(cleared.seen.map((event) => event.data)).toEqual([{ sessionID: session.id, goal: null }])
      expect(await host.rpc("get", { sessionID: session.id })).toEqual({ goal: null })
    },
    TIMEOUT,
  )

  test(
    "A17 a bare /goal edit hands the full objective to the terminal, and apply Edit saves the new one",
    async () => {
      host = await Host.start({ script: () => ({ text: "Step." }) })
      const empty = await host.session()
      const refused = host.events((type) => type === "rpc.goal.editRequested")
      await Bun.sleep(500)
      await host.goal(empty, "edit")
      await host.until(async () => (await host!.inbox(empty)).includes("[goal] No goal is set for this session."))
      refused.stop()
      expect(refused.seen).toEqual([])

      const session = await host.session()
      const objective = "make the checkout suite pass\n\nwithout changing the public API"
      await host.goal(session, objective)
      await host.goal(session, "pause")
      await host.settle(session)
      expect(host.stored(session)).toMatchObject({ objective, status: "paused" })

      const requested = host.events((type) => type === "rpc.goal.editRequested")
      await Bun.sleep(500)
      await host.goal(session, "edit")
      await host.until(() => requested.seen.length > 0)
      requested.stop()
      expect(requested.seen.map((event) => event.data)).toEqual([{ sessionID: session.id, objective }])

      const saved = (await host.rpc("apply", { sessionID: session.id, action: { _tag: "Edit", objective: "only the login test" } })) as { goal: unknown }
      const stored = host.stored(session)
      expect(stored).toMatchObject({ objective: "only the login test", status: "paused" })
      expect(saved).toEqual({ goal: stored })
      await host.until(async () =>
        (await host!.inbox(session)).includes("[goal] Objective updated. The goal is paused; run /goal resume to continue."),
      )
    },
    TIMEOUT,
  )
})
