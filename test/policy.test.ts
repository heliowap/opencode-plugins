import { describe, expect, test } from "bun:test"
import { resolve, type CatalogModel } from "../src/policy.ts"

const EFFORTS = ["low", "medium", "high", "xhigh", "max"]
const DIRECT: CatalogModel = { providerID: "openai", id: "gpt-6.1-sol", variants: EFFORTS }
const PROXY_SOL: CatalogModel = { providerID: "cli_proxy_openai", id: "gpt-6.1-sol", variants: EFFORTS }
const OPUS: CatalogModel = { providerID: "cli_proxy", id: "cpa-claude-opus-5-5", variants: EFFORTS }
const SONNET: CatalogModel = { providerID: "cli_proxy", id: "cpa-claude-sonnet-5-5", variants: EFFORTS }
const HAIKU: CatalogModel = { providerID: "cli_proxy", id: "cpa-claude-haiku-5-5", variants: EFFORTS }
const FULL = [DIRECT, PROXY_SOL, OPUS, SONNET, HAIKU]
const HAIKU_ROUTE = "cli_proxy/cpa-claude-haiku-5-5"
const SONNET_ROUTE = "cli_proxy/cpa-claude-sonnet-5-5"
const OPUS_ROUTE = "cli_proxy/cpa-claude-opus-5-5"
const SOL_ROUTE = "cli_proxy_openai/gpt-6.1-sol"

describe("roles without an approved policy", () => {
  test.each(["general", "poteto-agent", "build", "comment-sicko"])("%s keeps its own model selection", (agent) => {
    expect(resolve(agent, FULL)).toEqual({ kind: "unenforced" })
  })
})

describe("implementer policy", () => {
  test("Haiku 5.5 comes first, then Sonnet 5.5, then Sol, all at medium effort", () => {
    expect(resolve("implementer", FULL)).toEqual({
      kind: "routes",
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
      kind: "routes",
      routes: [
        { providerID: "cli_proxy", model: "cpa-claude-sonnet-5-5", variant: "medium" },
        { providerID: "cli_proxy_openai", model: "gpt-6.1-sol", variant: "medium" },
      ],
      skipped: [{ route: HAIKU_ROUTE, reason: "variant medium is not available" }],
    })
  })

  test("an exhausted Haiku 5.5 leaves Sonnet 5.5 alone, with a skip entry", () => {
    expect(resolve("implementer", FULL, new Set(), new Set([HAIKU_ROUTE]))).toEqual({
      kind: "routes",
      routes: [
        { providerID: "cli_proxy", model: "cpa-claude-sonnet-5-5", variant: "medium" },
        { providerID: "cli_proxy_openai", model: "gpt-6.1-sol", variant: "medium" },
      ],
      skipped: [{ route: HAIKU_ROUTE, reason: "account quota below 5%" }],
    })
  })

  test("both Claude routes exhausted send the implementer to Sol at medium effort", () => {
    expect(resolve("implementer", FULL, new Set(), new Set([HAIKU_ROUTE, SONNET_ROUTE]))).toEqual({
      kind: "routes",
      routes: [{ providerID: "cli_proxy_openai", model: "gpt-6.1-sol", variant: "medium" }],
      skipped: [
        { route: HAIKU_ROUTE, reason: "account quota below 5%" },
        { route: SONNET_ROUTE, reason: "account quota below 5%" },
      ],
    })
  })

  test("when every route is exhausted, the declared order is kept and nothing is skipped", () => {
    expect(resolve("implementer", FULL, new Set(), new Set([HAIKU_ROUTE, SONNET_ROUTE, SOL_ROUTE]))).toEqual({
      kind: "routes",
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
      resolve("implementer", FULL, new Set([HAIKU_ROUTE]), new Set([HAIKU_ROUTE, SONNET_ROUTE, SOL_ROUTE])),
    ).toMatchObject({
      routes: [{ model: "cpa-claude-sonnet-5-5" }, { model: "gpt-6.1-sol" }, { model: "cpa-claude-haiku-5-5" }],
      skipped: [],
    })
  })

  test("an exhausted route outside the policy has no effect", () => {
    expect(resolve("implementer", FULL, new Set(), new Set([OPUS_ROUTE]))).toEqual(resolve("implementer", FULL))
  })
})

describe("explore policy", () => {
  test("explore follows the research routes", () => {
    expect(resolve("explore", FULL)).toEqual(resolve("researcher", FULL))
  })
})

describe("planner policy", () => {
  test("a planner runs on Opus 5.5 at high effort, falling back to Sol at high effort", () => {
    expect(resolve("planner", FULL)).toEqual({
      kind: "routes",
      routes: [
        { providerID: "cli_proxy", model: "cpa-claude-opus-5-5", variant: "high" },
        { providerID: "cli_proxy_openai", model: "gpt-6.1-sol", variant: "high" },
      ],
      skipped: [],
    })
  })

  test("an exhausted Opus 5.5 sends the planner to Sol at high effort", () => {
    expect(resolve("planner", FULL, new Set(), new Set([OPUS_ROUTE]))).toMatchObject({
      routes: [{ providerID: "cli_proxy_openai", model: "gpt-6.1-sol", variant: "high" }],
      skipped: [{ route: OPUS_ROUTE, reason: "account quota below 5%" }],
    })
  })
})

describe("research policy", () => {
  test("Sonnet 5.5 comes first, at medium effort", () => {
    const resolution = resolve("researcher", FULL)

    expect(resolution.kind).toBe("routes")
    if (resolution.kind !== "routes") return
    expect(resolution.routes[0]).toEqual({ providerID: "cli_proxy", model: "cpa-claude-sonnet-5-5", variant: "medium" })
  })

  test("falls back to Opus 5.5 at low effort, then to Sol at medium effort", () => {
    expect(resolve("researcher", FULL)).toEqual({
      kind: "routes",
      routes: [
        { providerID: "cli_proxy", model: "cpa-claude-sonnet-5-5", variant: "medium" },
        { providerID: "cli_proxy", model: "cpa-claude-opus-5-5", variant: "low" },
        { providerID: "cli_proxy_openai", model: "gpt-6.1-sol", variant: "medium" },
      ],
      skipped: [],
    })
  })

  test("never routes to the direct OpenAI provider", () => {
    const resolution = resolve("researcher", [DIRECT])

    expect(resolution).toEqual({
      kind: "routes",
      routes: [],
      skipped: [
        { route: "cli_proxy/cpa-claude-sonnet-5-5", reason: "not in the available model catalog" },
        { route: "cli_proxy/cpa-claude-opus-5-5", reason: "not in the available model catalog" },
        { route: "cli_proxy_openai/gpt-6.1-sol", reason: "not in the available model catalog" },
      ],
    })
  })

  test("routes missing from the catalog or lacking the effort variant are skipped with a reason", () => {
    const opusWithoutLow = { ...OPUS, variants: ["high", "max"] }

    expect(resolve("researcher", [opusWithoutLow])).toEqual({
      kind: "routes",
      routes: [],
      skipped: [
        { route: "cli_proxy/cpa-claude-sonnet-5-5", reason: "not in the available model catalog" },
        { route: "cli_proxy/cpa-claude-opus-5-5", reason: "variant low is not available" },
        { route: "cli_proxy_openai/gpt-6.1-sol", reason: "not in the available model catalog" },
      ],
    })
  })

  test("a route that recently failed at the provider moves behind the healthy one", () => {
    const resolution = resolve("researcher", FULL, new Set(["cli_proxy/cpa-claude-sonnet-5-5"]))

    expect(resolution).toMatchObject({
      routes: [
        { model: "cpa-claude-opus-5-5", variant: "low" },
        { model: "gpt-6.1-sol", variant: "medium" },
        { model: "cpa-claude-sonnet-5-5", variant: "medium" },
      ],
    })
  })

  test("with every route failing, the declared order is kept", () => {
    const all = new Set(["cli_proxy/cpa-claude-sonnet-5-5", "cli_proxy/cpa-claude-opus-5-5", SOL_ROUTE])

    expect(resolve("researcher", FULL, all)).toMatchObject({
      routes: [{ model: "cpa-claude-sonnet-5-5" }, { model: "cpa-claude-opus-5-5" }, { model: "gpt-6.1-sol" }],
    })
  })
})
