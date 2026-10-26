import { afterEach, describe, expect, test } from "bun:test"
import { toolResults, type Script } from "./harness/fixture.ts"
import { Host } from "./harness/host.ts"

const TIMEOUT = 120_000
const LOOP = "[goal] Loop guard:"
let host: Host | undefined

afterEach(async () => {
  await host?.stop()
  host = undefined
})

describe("loop guard", () => {
  test(
    "L1 the third identical shell command gets a warning, and no other result does",
    async () => {
      const script: Script = (request) => {
        const done = toolResults(request).length
        if (done === 4) return { text: "Done." }
        return { tool: "shell", args: { command: done === 2 ? " echo loop " : "echo loop" } }
      }
      host = await Host.start({ allowAll: true, script })
      const session = await host.session()

      await host.prompt(session, "run the same command")
      await host.settle(session)

      const last = host.fixture.agentRequests().at(-1)!
      expect(toolResults(last).map((result) => result.includes(LOOP))).toEqual([false, false, true, false])
      expect(host.fixture.agentRequests()).toHaveLength(5)
    },
    TIMEOUT,
  )

  test(
    "L2 alternating commands never reach the loop limit",
    async () => {
      const script: Script = (request) => {
        const done = toolResults(request).length
        if (done === 5) return { text: "Done." }
        return done % 2 === 0
          ? { tool: "shell", args: { command: "echo loop" } }
          : { tool: "write", args: { path: "a.txt", content: String(done) } }
      }
      host = await Host.start({ allowAll: true, script })
      const session = await host.session()

      await host.prompt(session, "alternate commands and writes")
      await host.settle(session)

      expect(host.fixture.agentRequests().flatMap(toolResults).some((result) => result.includes(LOOP))).toBe(false)
      expect(host.fixture.agentRequests()).toHaveLength(6)
    },
    TIMEOUT,
  )
})
