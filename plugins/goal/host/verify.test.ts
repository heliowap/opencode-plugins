import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { toolResults } from "./harness/fixture.ts"
import { Host } from "./harness/host.ts"

const TIMEOUT = 120_000
let host: Host | undefined

afterEach(async () => {
  await host?.stop()
  host = undefined
})

const complete = { tool: "goal_update", args: { status: "complete", note: "done.txt exists" } } as const
const VERIFY = "test -f done.txt || { echo missing done.txt; exit 3; }"

describe("verify command", () => {
  test(
    "V1 a failing check refuses completion until the check passes in the goal's directory",
    async () => {
      host = await Host.start({
        script: (request) => {
          const results = toolResults(request).length
          if (results === 0) return complete
          if (results === 1) {
            writeFileSync(join(host!.project, "done.txt"), "")
            return complete
          }
          return { text: "Closing." }
        },
      })
      const session = await host.session()
      await host.goal(session, `--verify "${VERIFY}" write done.txt`)
      await host.settle(session)

      const results = toolResults(host.fixture.agentRequests().at(-1)!)
      expect(results[0]).toContain(
        `The goal is not complete: the verify command \`${VERIFY}\` exited with code 3 (failed check 1).`,
      )
      expect(results[0]).toContain("missing done.txt")
      expect(results[1]).toBe("Goal complete.")
      expect(host.stored(session)).toMatchObject({
        status: "complete",
        verify: VERIFY,
        verifyFailures: 1,
        lastExitCode: 0,
        note: "done.txt exists",
      })
    },
    TIMEOUT,
  )

  test(
    "V2 interrupting a running check stops the command and pauses the goal",
    async () => {
      host = await Host.start({
        script: (request) => (toolResults(request).length === 0 ? complete : { text: "Closing." }),
      })
      const session = await host.session()
      await host.goal(session, '--verify "sleep 4; touch late.txt" slow check')
      await host.until(() => host!.fixture.agentRequests().length >= 1)
      await Bun.sleep(1_000)
      await host.interrupt(session)
      await host.settle(session)
      await Bun.sleep(5_000)

      expect(existsSync(join(host.project, "late.txt"))).toBe(false)
      expect(host.stored(session)).toMatchObject({ status: "paused", note: "Interrupted by the user." })
      expect(host.stored(session)?.verifyFailures).toBeUndefined()
    },
    TIMEOUT,
  )
})
