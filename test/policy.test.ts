import { describe, expect, test } from "bun:test"
import { resolve, type CatalogModel } from "../src/policy.ts"

const EFFORTS = ["low", "medium", "high", "xhigh", "max"]
const DIRECT: CatalogModel = { providerID: "openai", id: "gpt-6.1-sol", variants: EFFORTS }
const PROXY_SOL: CatalogModel = {
  providerID: "cli_proxy_openai",
  id: "gpt-6.1-sol",
  variants: [...EFFORTS, "fast", "fast-low", "fast-medium"],
}
const OPUS: CatalogModel = { providerID: "cli_proxy", id: "cpa-claude-opus-5-5", variants: EFFORTS }
const FULL = [DIRECT, PROXY_SOL, OPUS]

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

  test("a planner does not switch to fast mode even when Opus offers it", () => {
    const fastOpus = { ...OPUS, variants: [...EFFORTS, "fast-high"] }

    expect(resolve("planner", [fastOpus])).toMatchObject({ routes: [{ variant: "high" }] })
  })
})

describe("research policy", () => {
  test("the direct OpenAI route comes first, at low effort", () => {
    const resolution = resolve("researcher", FULL)

    expect(resolution.kind).toBe("routes")
    if (resolution.kind !== "routes") return
    expect(resolution.routes[0]).toEqual({ providerID: "openai", model: "gpt-6.1-sol", variant: "low" })
  })

  test("falls back to proxied Sol in fast mode, then Opus, both at low effort", () => {
    const resolution = resolve("researcher", FULL)

    expect(resolution).toMatchObject({
      kind: "routes",
      routes: [
        { providerID: "openai", model: "gpt-6.1-sol", variant: "low" },
        { providerID: "cli_proxy_openai", model: "gpt-6.1-sol", variant: "fast-low" },
        { providerID: "cli_proxy", model: "cpa-claude-opus-5-5", variant: "low" },
      ],
    })
  })

  test("routes missing from the catalog or lacking the effort variant are skipped with a reason", () => {
    const opusWithoutLow = { ...OPUS, variants: ["high", "max"] }
    const resolution = resolve("researcher", [PROXY_SOL, opusWithoutLow])

    expect(resolution).toEqual({
      kind: "routes",
      routes: [{ providerID: "cli_proxy_openai", model: "gpt-6.1-sol", variant: "fast-low" }],
      skipped: [
        { route: "openai/gpt-6.1-sol", reason: "not in the available model catalog" },
        { route: "cli_proxy/cpa-claude-opus-5-5", reason: "variant low is not available" },
      ],
    })
  })

  test("a route that recently failed at the provider moves behind the healthy ones", () => {
    const resolution = resolve("researcher", FULL, new Set(["openai/gpt-6.1-sol"]))

    expect(resolution).toMatchObject({
      routes: [
        { providerID: "cli_proxy_openai", variant: "fast-low" },
        { providerID: "cli_proxy", variant: "low" },
        { providerID: "openai", variant: "low" },
      ],
    })
  })

  test("with every route failing, the declared order is kept", () => {
    const all = new Set(["openai/gpt-6.1-sol", "cli_proxy_openai/gpt-6.1-sol", "cli_proxy/cpa-claude-opus-5-5"])
    const resolution = resolve("researcher", FULL, all)

    expect(resolution).toMatchObject({
      routes: [{ providerID: "openai" }, { providerID: "cli_proxy_openai" }, { providerID: "cli_proxy" }],
    })
  })
})
