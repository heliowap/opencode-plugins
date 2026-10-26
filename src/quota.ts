import { routeKey, type CatalogModel } from "./policy.ts"

export type ClaudeQuota = { readonly _tag: "Unknown" } | { readonly _tag: "Known"; readonly exhausted: boolean }

// A route whose account pool has less than this much quota left, in percent, is skipped.
const FLOOR_PERCENT = 5

type Window = "5h" | "7d"

const UTILIZATION: Readonly<Record<Window, string>> = {
  "5h": "Anthropic-Ratelimit-Unified-5h-Utilization",
  "7d": "Anthropic-Ratelimit-Unified-7d-Utilization",
}

const RESET: Readonly<Record<Window, string>> = {
  "5h": "Anthropic-Ratelimit-Unified-5h-Reset",
  "7d": "Anthropic-Ratelimit-Unified-7d-Reset",
}

const WINDOWS: readonly Window[] = ["5h", "7d"]

const UNKNOWN: ClaudeQuota = { _tag: "Unknown" }

// Reads the credential list of the CLIProxyAPI management API, as the cliproxy-quota plugin does for Claude.
export function claudeQuota(body: unknown, now: number): ClaudeQuota {
  if (!isRecord(body) || !Array.isArray(body.files)) return UNKNOWN
  const accounts = body.files.filter(isRecord).filter((file) => isClaude(file) && file.disabled !== true)
  if (accounts.length === 0) return UNKNOWN
  return { _tag: "Known", exhausted: accounts.every((file) => accountExhausted(signalsOf(file), now)) }
}

export const isClaudeRoute = (providerID: string, model: string) => providerID === "cli_proxy" && model.startsWith("cpa-claude-")

export function exhaustedRoutes(catalog: readonly CatalogModel[], quota: ClaudeQuota): ReadonlySet<string> {
  if (quota._tag !== "Known" || !quota.exhausted) return new Set()
  return new Set(
    catalog
      .filter((model) => isClaudeRoute(model.providerID, model.id))
      .map((model) => routeKey({ providerID: model.providerID, model: model.id })),
  )
}

const isClaude = (file: Record<string, unknown>) => typeof file.provider === "string" && file.provider.trim().toLowerCase() === "claude"

const signalsOf = (file: Record<string, unknown>): Record<string, unknown> => {
  const quota = isRecord(file.quota) ? file.quota : undefined
  return quota && isRecord(quota.signals) ? quota.signals : {}
}

const accountExhausted = (signals: Record<string, unknown>, now: number) =>
  WINDOWS.some((window) => leftPercent(signals, window, now) < FLOOR_PERCENT)

// A window whose reset has passed, or that has no utilization signal, counts as fully available.
function leftPercent(signals: Record<string, unknown>, window: Window, now: number) {
  const reset = number(signals[RESET[window]])
  if (reset !== undefined && reset * 1000 <= now) return 100
  const utilization = number(signals[UTILIZATION[window]])
  if (utilization === undefined) return 100
  // Rounding trims floating-point noise, so that utilization 0.95 leaves exactly 5.
  return 100 - Math.round(utilization * 10_000) / 100
}

function number(value: unknown) {
  if (typeof value !== "string" || value.trim() === "") return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
