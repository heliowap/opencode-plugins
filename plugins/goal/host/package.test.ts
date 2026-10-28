import { afterEach, describe, expect, test } from "bun:test"
import { afterToolResult, CONTINUATION, count } from "./harness/fixture.ts"
import { Host } from "./harness/host.ts"

const spec = process.env.GOAL_PLUGIN_SPEC
let host: Host | undefined

afterEach(async () => {
  await host?.stop()
  host = undefined
})

describe("installed package", () => {
  test.skipIf(!spec)(
    "A14 the plugin installed from its package spec loads its templates and runs a goal",
    async () => {
      host = await Host.start({
        pluginSpec: spec!,
        script: (request) => {
          if (afterToolResult(request)) return { text: "Closing." }
          return count(request, CONTINUATION) >= 2
            ? { tool: "goal_update", args: { status: "complete", note: "package works" } }
            : { text: "Step." }
        },
      })
      const session = await host.session()
      await host.goal(session, "run from the package")
      await host.settle(session)

      expect(host.stored(session)).toMatchObject({ status: "complete", note: "package works" })
      const first = host.fixture.agentRequests()[0]!
      expect(count(first, CONTINUATION)).toBe(1)
    },
    300_000,
  )
})
