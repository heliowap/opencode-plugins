import { describe, expect, test } from "bun:test"
import { isPolicied, resolve } from "../src/policy.ts"
import { FLOOR_PERCENT } from "../src/quota.ts"
import type { CatalogModel } from "../src/route.ts"

const EFFORTS = ["low", "medium", "high", "xhigh", "max"]
const DIRECT: CatalogModel = { providerID: "openai", id: "gpt-6.1-sol", variants: EFFORTS }
const PROXY_SOL: CatalogModel = { providerID: "cli_proxy_openai", id: "gpt-6.1-sol", variants: EFFORTS }
const OPUS: CatalogModel = { providerID: "cli_proxy", id: "cpa-claude-opus-5-5", variants: EFFORTS }
const SONNET: CatalogModel = { providerID: "cli_proxy", id: "cpa-claude-sonnet-5-5", variants: EFFORTS }
const HAIKU: CatalogModel = { providerID: "cli_proxy", id: "cpa-claude-haiku-5-5", variants: EFFORTS }
const DEVIN_SOL: CatalogModel = { providerID: "cli_proxy_openai", id: "devin/gpt-6-1-sol", variants: EFFORTS }
const DEEPSEEK: CatalogModel = {
  providerID: "cli_proxy",
  id: "devin/deepseek-v4-1-flash-1017",
  variants: ["none", "low", "high", "max"],
}
const FULL = [DIRECT, PROXY_SOL, DEVIN_SOL, DEEPSEEK, OPUS, SONNET, HAIKU]
const DEEPSEEK_ROUTE = "cli_proxy/devin/deepseek-v4-1-flash-1017"
const HAIKU_ROUTE = "cli_proxy/cpa-claude-haiku-5-5"
const SONNET_ROUTE = "cli_proxy/cpa-claude-sonnet-5-5"
const OPUS_ROUTE = "cli_proxy/cpa-claude-opus-5-5"
const SOL_ROUTE = "cli_proxy_openai/gpt-6.1-sol"
const SKIP_REASON = `account quota below ${FLOOR_PERCENT}%`

describe("roles without an approved policy", () => {
  test.each(["general", "poteto-agent", "build", "comment-sicko", "constructor"])("%s is not policied", (agent) => {
    expect(isPolicied(agent)).toBe(false)
  })

  test("the approved roles are policied", () => {
    for (const agent of ["researcher", "explore", "planner", "implementer"]) expect(isPolicied(agent)).toBe(true)
  })
})

describe("implementer policy", () => {
  test("Haiku 5.5 comes first, then Sonnet 5.5, then Sol, all at medium effort", () => {
    expect(resolve("implementer", FULL)).toEqual({
      routes: [
        { providerID: "cli_proxy", model: "cpa-claude-haiku-5-5", variant: "medium" },
        { providerID: "cli_proxy", model: "cpa-claude-sonnet-5-5", variant: "medium" },
        { providerID: "cli_proxy_openai", model: "gpt-6.1-sol", variant: "medium" },
      ],
      skipped: [],
    })
  })

  test("Haiku 5.5 without a medium variant is skipped with a reason", () => {
    const haikuWithoutMedium = { ...HAIKU, variants: ["low", "high"] }

    expect(resolve("implementer", [haikuWithoutMedium, SONNET, PROXY_SOL])).toEqual({
      routes: [
        { providerID: "cli_proxy", model: "cpa-claude-sonnet-5-5", variant: "medium" },
        { providerID: "cli_proxy_openai", model: "gpt-6.1-sol", variant: "medium" },
      ],
      skipped: [{ route: HAIKU_ROUTE, reason: "variant medium is not available" }],
    })
  })

  test("an exhausted Haiku 5.5 leaves Sonnet 5.5 alone, with a skip entry", () => {
    expect(resolve("implementer", FULL, { exhausted: new Set([HAIKU_ROUTE]) })).toEqual({
      routes: [
        { providerID: "cli_proxy", model: "cpa-claude-sonnet-5-5", variant: "medium" },
        { providerID: "cli_proxy_openai", model: "gpt-6.1-sol", variant: "medium" },
      ],
      skipped: [{ route: HAIKU_ROUTE, reason: SKIP_REASON }],
    })
  })

  test("both Claude routes exhausted send the implementer to Sol at medium effort", () => {
    expect(resolve("implementer", FULL, { exhausted: new Set([HAIKU_ROUTE, SONNET_ROUTE]) })).toEqual({
      routes: [{ providerID: "cli_proxy_openai", model: "gpt-6.1-sol", variant: "medium" }],
      skipped: [
        { route: HAIKU_ROUTE, reason: SKIP_REASON },
        { route: SONNET_ROUTE, reason: SKIP_REASON },
      ],
    })
  })

  test("when every route is exhausted, the declared order is kept and nothing is skipped", () => {
    expect(resolve("implementer", FULL, { exhausted: new Set([HAIKU_ROUTE, SONNET_ROUTE, SOL_ROUTE]) })).toEqual({
      routes: [
        { providerID: "cli_proxy", model: "cpa-claude-haiku-5-5", variant: "medium" },
        { providerID: "cli_proxy", model: "cpa-claude-sonnet-5-5", variant: "medium" },
        { providerID: "cli_proxy_openai", model: "gpt-6.1-sol", variant: "medium" },
      ],
      skipped: [],
    })
  })

  test("with every route exhausted, an unhealthy route still moves behind the other", () => {
    expect(
      resolve("implementer", FULL, {
        unhealthy: new Set([HAIKU_ROUTE]),
        exhausted: new Set([HAIKU_ROUTE, SONNET_ROUTE, SOL_ROUTE]),
      }),
    ).toMatchObject({
      routes: [{ model: "cpa-claude-sonnet-5-5" }, { model: "gpt-6.1-sol" }, { model: "cpa-claude-haiku-5-5" }],
      skipped: [],
    })
  })

  test("an exhausted route outside the policy has no effect", () => {
    expect(resolve("implementer", FULL, { exhausted: new Set([OPUS_ROUTE]) })).toEqual(resolve("implementer", FULL))
  })
})

describe("explore policy", () => {
  test("explore follows the research routes", () => {
    expect(resolve("explore", FULL)).toEqual(resolve("researcher", FULL))
  })
})

describe("planner policy", () => {
  test("a planner runs on Opus 5.5 at high effort, falling back to Devin Sol at high effort", () => {
    expect(resolve("planner", FULL)).toEqual({
      routes: [
        { providerID: "cli_proxy", model: "cpa-claude-opus-5-5", variant: "high" },
        { providerID: "cli_proxy_openai", model: "devin/gpt-6-1-sol", variant: "high" },
      ],
      skipped: [],
    })
  })

  test("an exhausted Opus 5.5 sends the planner to Devin Sol at high effort", () => {
    expect(resolve("planner", FULL, { exhausted: new Set([OPUS_ROUTE]) })).toMatchObject({
      routes: [{ providerID: "cli_proxy_openai", model: "devin/gpt-6-1-sol", variant: "high" }],
      skipped: [{ route: OPUS_ROUTE, reason: SKIP_REASON }],
    })
  })
})

describe("research policy", () => {
  test("Devin DeepSeek V4.1 Flash comes first, at max effort", () => {
    const { routes } = resolve("researcher", FULL)

    expect(routes[0]).toEqual({
      providerID: "cli_proxy",
      model: "devin/deepseek-v4-1-flash-1017",
      variant: "max",
    })
  })

  test("falls back to Sonnet 5.5 at medium effort, then to Opus 5.5 at low effort, with no Sol route", () => {
    expect(resolve("researcher", FULL)).toEqual({
      routes: [
        { providerID: "cli_proxy", model: "devin/deepseek-v4-1-flash-1017", variant: "max" },
        { providerID: "cli_proxy", model: "cpa-claude-sonnet-5-5", variant: "medium" },
        { providerID: "cli_proxy", model: "cpa-claude-opus-5-5", variant: "low" },
      ],
      skipped: [],
    })
  })

  test("never routes to the direct OpenAI provider", () => {
    expect(resolve("researcher", [DIRECT])).toEqual({
      routes: [],
      skipped: [
        { route: DEEPSEEK_ROUTE, reason: "not in the available model catalog" },
        { route: "cli_proxy/cpa-claude-sonnet-5-5", reason: "not in the available model catalog" },
        { route: "cli_proxy/cpa-claude-opus-5-5", reason: "not in the available model catalog" },
      ],
    })
  })

  test("routes missing from the catalog or lacking the effort variant are skipped with a reason", () => {
    const opusWithoutLow = { ...OPUS, variants: ["high", "max"] }

    expect(resolve("researcher", [opusWithoutLow])).toEqual({
      routes: [],
      skipped: [
        { route: DEEPSEEK_ROUTE, reason: "not in the available model catalog" },
        { route: "cli_proxy/cpa-claude-sonnet-5-5", reason: "not in the available model catalog" },
        { route: "cli_proxy/cpa-claude-opus-5-5", reason: "variant low is not available" },
      ],
    })
  })

  test("a route that recently failed at the provider moves behind the healthy ones", () => {
    const resolution = resolve("researcher", FULL, { unhealthy: new Set([DEEPSEEK_ROUTE]) })

    expect(resolution).toMatchObject({
      routes: [
        { model: "cpa-claude-sonnet-5-5", variant: "medium" },
        { model: "cpa-claude-opus-5-5", variant: "low" },
        { model: "devin/deepseek-v4-1-flash-1017", variant: "max" },
      ],
    })
  })

  test("with every route failing, the declared order is kept", () => {
    const all = new Set([DEEPSEEK_ROUTE, SONNET_ROUTE, OPUS_ROUTE])

    expect(resolve("researcher", FULL, { unhealthy: all })).toMatchObject({
      routes: [
        { model: "devin/deepseek-v4-1-flash-1017" },
        { model: "cpa-claude-sonnet-5-5" },
        { model: "cpa-claude-opus-5-5" },
      ],
    })
  })
})
