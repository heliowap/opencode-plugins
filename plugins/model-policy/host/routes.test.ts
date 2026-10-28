import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { childRoutes, dispatch, HAIKU, OPUS, run, SONNET, stopRuns, toolResults } from "./harness/fixture.ts"
import { Host } from "./harness/host.ts"

const TIMEOUT = 120_000
const ANTHROPIC_SONNET = "anthropic/claude-sonnet-5-5"
const ROUTES_SRC = resolve(import.meta.dir, "../../model-routes/src/index.ts")
// Config-defined models are not removable by a catalog transform, so these placeholders only activate the providers
// whose built-in models the filter is expected to remove.
const CATALOG = {
  anthropic: { "placeholder-chat": "placeholder" },
  openrouter: { "placeholder-chat": "placeholder" },
  azure: { "placeholder-chat": "placeholder" },
}
const ALLOWED_PROVIDERS = ["openai", "cli_proxy", "cli_proxy_openai", "opencode-go"]
const ALLOWED_MODELS = [ANTHROPIC_SONNET, "anthropic/claude-haiku-5-5"]

let scratch: string | undefined

afterEach(async () => {
  await stopRuns()
  if (scratch) await rm(scratch, { recursive: true, force: true })
  scratch = undefined
})

// The live setup loads model-policy first, then model-routes: the extra plugin sorts after "model-policy".
const withRoutes = async () => {
  scratch = await mkdtemp(join(tmpdir(), "model-routes-link-"))
  const link = join(scratch, "model-routes.ts")
  await symlink(ROUTES_SRC, link)
  return { extraPlugins: [link], catalog: CATALOG }
}

const catalogOf = async (host: Host) =>
  ((await host.json("GET", "/api/model?limit=2000")) as { data: { providerID: string; id: string; family?: string }[] }).data

const key = (model: { providerID: string; id: string }) => `${model.providerID}/${model.id}`

const parentResult = (host: Host) =>
  toolResults(host.fixture.calls.filter((call) => call.provider === "fixture").at(-1)!.request).at(-1)

describe("model-policy and model-routes loaded together, policy first", () => {
  test(
    "an unpolicied agent asking for an Anthropic API model is rejected",
    async () => {
      const { host } = await run({ ...(await withRoutes()), script: dispatch({ agent: "general", model: ANTHROPIC_SONNET }) })

      expect(parentResult(host)).toContain(`${ANTHROPIC_SONNET} is user-only`)
      expect(childRoutes(host.fixture.agentCalls())).toEqual([])
    },
    TIMEOUT,
  )

  test(
    "a policied agent asking for an Anthropic API model is rewritten to its route and accepted",
    async () => {
      const { host } = await run({ ...(await withRoutes()), script: dispatch({ agent: "implementer", model: ANTHROPIC_SONNET }) })

      expect(childRoutes(host.fixture.agentCalls())).toEqual([`${HAIKU}#medium`])
      expect(parentResult(host)).toContain('state="completed"')
      expect(parentResult(host)).not.toContain("user-only")
    },
    TIMEOUT,
  )

  test(
    "the catalog loses non-allowed Anthropic and OpenAI family models and keeps the approved ones",
    async () => {
      const { host } = await run({ ...(await withRoutes()), script: () => ({ text: "idle" }) })
      const catalog = await catalogOf(host)
      const kept = catalog.map(key)

      expect(kept.filter((model) => model.startsWith("anthropic/")).sort()).toEqual(
        [...ALLOWED_MODELS, "anthropic/placeholder-chat"].sort(),
      )
      expect(kept).toEqual(expect.arrayContaining([SONNET, HAIKU, OPUS, "openai/gpt-6.1-sol", "openrouter/placeholder-chat"]))
      const leaked = catalog.filter(
        (model) =>
          !ALLOWED_PROVIDERS.includes(model.providerID) &&
          !ALLOWED_MODELS.includes(key(model)) &&
          (/^~?(openai|anthropic)\//.test(model.id) || /^(gpt|claude)/.test(model.family ?? "")),
      )
      expect(leaked.map(key)).toEqual([])
    },
    TIMEOUT,
  )
})
