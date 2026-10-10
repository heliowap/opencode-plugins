import { expect, test } from "bun:test"
import { OPUS, text, toolResults, type Call, type Reply } from "../harness/fixture.ts"
import { Host } from "../harness/host.ts"

// Upstream OpenCode bug: once a plugin wraps a tool's execute through tool.transform, parallel
// calls that fail all report the first failure's error. Marked failing until OpenCode fixes it;
// when this starts passing, bun reports it so the marker can be removed.

const CASES = [1, 3, 5, 7]

const caseOf = (call: Call) => {
  for (const message of call.request.messages) {
    const found = message.role === "user" ? text(message).match(/case-(\d+)/) : null
    if (found) return Number(found[1])
  }
  return -1
}

test.failing(
  "parallel failing calls of a wrapped tool each report their own error",
  async () => {
    const host = await Host.start({
      pluginDir: `${import.meta.dir}/passthrough-plugin`,
      script: (call: Call): Reply => {
        if (call.provider !== "fixture") return { status: 400, error: `invalid request ${caseOf(call)}` }
        if (toolResults(call.request).length) return { text: "done" }
        return {
          tools: CASES.map((index) => ({
            tool: "subagent",
            args: { agent: "implementer", model: `${OPUS}#low`, description: `case ${index}`, prompt: `case-${index}` },
          })),
        }
      },
    })
    try {
      const session = await host.session()
      await host.prompt(session, "go")
      await host.settle(session)
      const results = toolResults(host.fixture.calls.filter((call) => call.provider === "fixture").at(-1)!.request)

      expect(results.map((result) => result.match(/invalid request \d/)?.[0])).toEqual(CASES.map((index) => `invalid request ${index}`))
    } finally {
      await host.stop()
    }
  },
  120_000,
)
