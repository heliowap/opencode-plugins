import { afterEach, describe, expect, test } from "bun:test"
import { childRoutes, dispatch, HAIKU, OPUS, run, SONNET, stopRuns, toolResults } from "./harness/fixture.ts"
import { isBlockedModel } from "../src/routes.ts"
import { Host } from "./harness/host.ts"

const TIMEOUT = 120_000
const ANTHROPIC_SONNET = "anthropic/claude-sonnet-5-5"
// Config-defined models are not removable by a catalog transform, so these placeholders only activate the providers
// whose built-in models the filter is expected to remove.
const CATALOG = {
  anthropic: { "placeholder-chat": "placeholder" },
  openrouter: { "placeholder-chat": "placeholder" },
  azure: { "placeholder-chat": "placeholder" },
}
const ALLOWED_MODELS = [ANTHROPIC_SONNET, "anthropic/claude-haiku-5-5"]

afterEach(stopRuns)

const catalogOf = async (host: Host) =>
  ((await host.json("GET", "/api/model?limit=2000")) as { data: { providerID: string; id: string; family?: string }[] }).data

const key = (model: { providerID: string; id: string }) => `${model.providerID}/${model.id}`

const parentResult = (host: Host) =>
  toolResults(host.fixture.calls.filter((call) => call.provider === "fixture").at(-1)!.request).at(-1)

describe("model-policy with the catalog filter and the user-only block", () => {
  test(
    "an unpolicied agent asking for an Anthropic API model is rejected",
    async () => {
      const { host } = await run({ catalog: CATALOG, script: dispatch({ agent: "general", model: ANTHROPIC_SONNET }) })

      expect(parentResult(host)).toContain(`${ANTHROPIC_SONNET} is user-only`)
      expect(childRoutes(host.fixture.agentCalls())).toEqual([])
    },
    TIMEOUT,
  )

  test(
    "a policied agent asking for an Anthropic API model is rewritten to its route and accepted",
    async () => {
      const { host } = await run({ catalog: CATALOG, script: dispatch({ agent: "implementer", model: ANTHROPIC_SONNET }) })

      expect(childRoutes(host.fixture.agentCalls())).toEqual([`${HAIKU}#medium`])
      expect(parentResult(host)).toContain('state="completed"')
      expect(parentResult(host)).not.toContain("user-only")
    },
    TIMEOUT,
  )

  test(
    "the catalog loses non-allowed Anthropic and OpenAI family models and keeps the approved ones",
    async () => {
      const { host } = await run({ catalog: CATALOG, script: () => ({ text: "idle" }) })
      const catalog = await catalogOf(host)
      const kept = catalog.map(key)

      expect(kept.filter((model) => model.startsWith("anthropic/")).sort()).toEqual(
        [...ALLOWED_MODELS, "anthropic/placeholder-chat"].sort(),
      )
      expect(kept).toEqual(expect.arrayContaining([SONNET, HAIKU, OPUS, "openai/gpt-6.1-sol", "openrouter/placeholder-chat"]))
      const leaked = catalog.filter(isBlockedModel)
      expect(leaked.map(key)).toEqual([])
    },
    TIMEOUT,
  )
})
