import { describe, expect, test } from "bun:test"
import { resolve, type CatalogModel } from "../src/policy.ts"

const EFFORTS = ["low", "medium", "high", "xhigh", "max"]
const DIRECT: CatalogModel = { providerID: "openai", id: "gpt-6.1-sol", variants: EFFORTS }
const PROXY_SOL: CatalogModel = { providerID: "cli_proxy_openai", id: "gpt-6.1-sol", variants: EFFORTS }
const OPUS: CatalogModel = { providerID: "cli_proxy", id: "cpa-claude-opus-5-5", variants: EFFORTS }
const SONNET: CatalogModel = { providerID: "cli_proxy", id: "cpa-claude-sonnet-5-5", variants: EFFORTS }
const FULL = [DIRECT, PROXY_SOL, OPUS, SONNET]

describe("roles without an approved policy", () => {
  test.each(["implementer", "general", "build", "comment-sicko"])("%s keeps its own model selection", (agent) => {
    expect(resolve(agent, FULL)).toEqual({ kind: "unenforced" })
  })
})

describe("explore policy", () => {
  test("explore follows the research routes", () => {
    expect(resolve("explore", FULL)).toEqual(resolve("researcher", FULL))
  })
})

describe("planner policy", () => {
  test("a planner runs only on Opus 5.5 at high effort", () => {
    expect(resolve("planner", FULL)).toEqual({
      kind: "routes",
      routes: [{ providerID: "cli_proxy", model: "cpa-claude-opus-5-5", variant: "high" }],
      skipped: [],
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

  test("falls back only to Opus 5.5 at low effort, never to Sol", () => {
    expect(resolve("researcher", FULL)).toEqual({
      kind: "routes",
      routes: [
        { providerID: "cli_proxy", model: "cpa-claude-sonnet-5-5", variant: "medium" },
        { providerID: "cli_proxy", model: "cpa-claude-opus-5-5", variant: "low" },
      ],
      skipped: [],
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
      ],
    })
  })

  test("a route that recently failed at the provider moves behind the healthy one", () => {
    const resolution = resolve("researcher", FULL, new Set(["cli_proxy/cpa-claude-sonnet-5-5"]))

    expect(resolution).toMatchObject({
      routes: [
        { model: "cpa-claude-opus-5-5", variant: "low" },
        { model: "cpa-claude-sonnet-5-5", variant: "medium" },
      ],
    })
  })

  test("with every route failing, the declared order is kept", () => {
    const all = new Set(["cli_proxy/cpa-claude-sonnet-5-5", "cli_proxy/cpa-claude-opus-5-5"])

    expect(resolve("researcher", FULL, all)).toMatchObject({
      routes: [{ model: "cpa-claude-sonnet-5-5" }, { model: "cpa-claude-opus-5-5" }],
    })
  })
})
