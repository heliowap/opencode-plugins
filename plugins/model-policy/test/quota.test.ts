import { describe, expect, test } from "bun:test"
import { claudeQuota, exhaustedRoutes, isClaudeRoute } from "../src/quota.ts"

const NOW = Date.parse("2026-10-25T12:00:00Z")
const FUTURE = String(NOW / 1000 + 3600)
const PAST = String(NOW / 1000 - 60)
const HAIKU_ROUTE = "cli_proxy/cpa-claude-haiku-5-5"
const SONNET_ROUTE = "cli_proxy/cpa-claude-sonnet-5-5"
const SOL_ROUTE = "cli_proxy_openai/gpt-6.1-sol"

const fiveHour = (utilization: string, reset = FUTURE) => ({
  "Anthropic-Ratelimit-Unified-5h-Utilization": utilization,
  "Anthropic-Ratelimit-Unified-5h-Reset": reset,
})

const sevenDay = (utilization: string, reset = FUTURE) => ({
  "Anthropic-Ratelimit-Unified-7d-Utilization": utilization,
  "Anthropic-Ratelimit-Unified-7d-Reset": reset,
})

const claude = (signals: Record<string, string>, extra: Record<string, unknown> = {}) => ({
  provider: "claude",
  ...extra,
  quota: { signals },
})

const pool = (...files: unknown[]) => ({ files })

describe("claude pool exhaustion", () => {
  test("a 5h window at 96% used leaves 4% and exhausts the pool", () => {
    expect(claudeQuota(pool(claude({ ...fiveHour("0.96"), ...sevenDay("0.4") })), NOW)).toEqual({ _tag: "Known", exhausted: true })
  })

  test("a 5h window at 95% used leaves exactly 5% and does not exhaust the pool", () => {
    expect(claudeQuota(pool(claude({ ...fiveHour("0.95"), ...sevenDay("0.4") })), NOW)).toEqual({ _tag: "Known", exhausted: false })
  })

  test("a 7d window at 96% used exhausts the pool", () => {
    expect(claudeQuota(pool(claude({ ...fiveHour("0.2"), ...sevenDay("0.96") })), NOW)).toEqual({ _tag: "Known", exhausted: true })
  })

  test("a 7d window at 95% used does not exhaust the pool", () => {
    expect(claudeQuota(pool(claude({ ...fiveHour("0.2"), ...sevenDay("0.95") })), NOW)).toEqual({ _tag: "Known", exhausted: false })
  })

  test("a window whose reset time has passed counts as fully available", () => {
    expect(claudeQuota(pool(claude({ ...fiveHour("0.99", PAST), ...sevenDay("0.2") })), NOW)).toEqual({ _tag: "Known", exhausted: false })
  })

  test("a missing window signal counts as fully available", () => {
    expect(claudeQuota(pool(claude(fiveHour("0.2"))), NOW)).toEqual({ _tag: "Known", exhausted: false })
    expect(claudeQuota(pool(claude(fiveHour("0.99"))), NOW)).toEqual({ _tag: "Known", exhausted: true })
  })

  test("the pool is exhausted only when every enabled Claude account is exhausted", () => {
    expect(
      claudeQuota(pool(claude({ ...fiveHour("0.99"), ...sevenDay("0.2") }), claude({ ...fiveHour("0.2"), ...sevenDay("0.4") })), NOW),
    ).toEqual({ _tag: "Known", exhausted: false })
    expect(
      claudeQuota(pool(claude({ ...fiveHour("0.99"), ...sevenDay("0.2") }), claude({ ...fiveHour("0.2"), ...sevenDay("0.97") })), NOW),
    ).toEqual({ _tag: "Known", exhausted: true })
  })

  test("a disabled account is ignored", () => {
    expect(claudeQuota(pool(claude(fiveHour("0.99"), { disabled: true }), claude(fiveHour("0.2"))), NOW)).toEqual({
      _tag: "Known",
      exhausted: false,
    })
    expect(claudeQuota(pool(claude(fiveHour("0.99"), { disabled: true })), NOW)).toEqual({ _tag: "Unknown" })
  })

  test("accounts of other providers are ignored", () => {
    expect(claudeQuota(pool({ provider: "codex", quota: { signals: fiveHour("0.99") } }), NOW)).toEqual({ _tag: "Unknown" })
  })

  test("the provider name is matched case-insensitively", () => {
    expect(claudeQuota(pool(claude(fiveHour("0.99"), { provider: "Claude" })), NOW)).toEqual({ _tag: "Known", exhausted: true })
  })

  test.each([null, "claude", {}, { files: "claude" }, { files: [] }, { files: [null, "claude"] }])(
    "a malformed body %j is unknown",
    (body) => {
      expect(claudeQuota(body, NOW)).toEqual({ _tag: "Unknown" })
    },
  )
})

describe("claude route identity", () => {
  test.each([
    ["cli_proxy", "cpa-claude-haiku-5-5", true],
    ["cli_proxy", "cpa-claude-opus-5-5", true],
    ["cli_proxy", "gpt-6.1-sol", false],
    ["cli_proxy_openai", "gpt-6.1-sol", false],
    ["cli_proxy_openai", "cpa-claude-haiku-5-5", false],
  ])("%s/%s is a Claude route: %p", (providerID, model, expected) => {
    expect(isClaudeRoute(providerID, model)).toBe(expected)
  })
})

describe("exhausted routes", () => {
  const catalog = [
    { providerID: "cli_proxy", id: "cpa-claude-haiku-5-5", variants: ["medium"] },
    { providerID: "cli_proxy", id: "cpa-claude-sonnet-5-5", variants: ["medium"] },
    { providerID: "cli_proxy_openai", id: "gpt-6.1-sol", variants: ["medium"] },
  ]

  test("an exhausted pool marks every Claude route in the catalog, and nothing else", () => {
    const quota = claudeQuota(pool(claude({ ...fiveHour("0.99"), ...sevenDay("0.2") })), NOW)

    expect(exhaustedRoutes(catalog, quota)).toEqual(new Set([HAIKU_ROUTE, SONNET_ROUTE]))
    expect(exhaustedRoutes(catalog, quota).has(SOL_ROUTE)).toBe(false)
  })

  test("a pool with quota left marks nothing", () => {
    expect(exhaustedRoutes(catalog, claudeQuota(pool(claude(fiveHour("0.2"))), NOW))).toEqual(new Set())
  })

  test("unknown quota marks nothing", () => {
    expect(exhaustedRoutes(catalog, claudeQuota({ files: [] }, NOW))).toEqual(new Set())
  })
})
