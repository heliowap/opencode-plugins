import { afterEach, describe, expect, test } from "bun:test"
import { afterToolResult } from "./harness/fixture.ts"
import { Host } from "./harness/host.ts"

const TIMEOUT = 120_000
let host: Host | undefined

afterEach(async () => {
  await host?.stop()
  host = undefined
})

describe("failures", () => {
  test(
    "A8 a turn the provider rejects blocks the goal instead of looping",
    async () => {
      host = await Host.start({ script: () => ({ status: 400, error: "fixture rejects every request" }) })
      const session = await host.session()
      await host.goal(session, "cannot run")
      await host.settle(session)

      const stored = host.stored(session)!
      expect(stored.status).toBe("blocked")
      expect(stored.note).toStartWith("Turn failed: ")
      expect(stored.note).toContain("fixture rejects every request")
      expect(host.fixture.agentRequests()).toHaveLength(1)
    },
    TIMEOUT,
  )

  test(
    "A8b a server error is retried, and the goal finishes without the user",
    async () => {
      let failures = 0
      host = await Host.start({
        noHostRetry: true,
        env: { GOAL_RETRY_DELAYS_MS: "500,500,500" },
        script: (request) => {
          if (failures === 0) {
            failures++
            return { status: 503, error: "upstream unavailable" }
          }
          return afterToolResult(request) ? { text: "Done." } : { tool: "goal_update", args: { status: "complete", note: "done" } }
        },
      })
      const session = await host.session()
      await host.goal(session, "survive one outage")
      await host.until(() => host!.stored(session)?.status === "complete", 60_000)
      await host.settle(session)

      expect(host.stored(session)).toMatchObject({ status: "complete", note: "done", failedTurns: 1 })
      expect(host.fixture.agentRequests()).toHaveLength(3)
    },
    TIMEOUT,
  )

  test(
    "A8c a server error that persists blocks the goal after three retries",
    async () => {
      host = await Host.start({
        noHostRetry: true,
        env: { GOAL_RETRY_DELAYS_MS: "300,300,300" },
        script: () => ({ status: 503, error: "upstream unavailable" }),
      })
      const session = await host.session()
      await host.goal(session, "cannot run")
      await host.until(() => host!.stored(session)?.status === "blocked", 60_000)
      await host.settle(session)

      const stored = host.stored(session)!
      expect(stored).toMatchObject({ status: "blocked", failedTurns: 3 })
      expect(stored.note).toStartWith("Turn failed after 3 retries: ")
      expect(stored.note).toContain("upstream unavailable")
      expect(host.fixture.agentRequests()).toHaveLength(4)
    },
    TIMEOUT,
  )
})
