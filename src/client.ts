import { mergeAccounts, parseCredentials, parseProbe, probeTargets, type Account, type QuotaResult } from "./quota.ts"

export type Settings = { readonly baseURL: string; readonly managementKey: string }

export type FetchResult = QuotaResult

type ProbeEntry = { readonly attemptedAt: number; readonly live: readonly Account[] }
type ManagementEntry = { readonly retryAt: number; readonly error: string }
export type ProbeMemory = Map<string, ProbeEntry>

const DEFAULT_URL = "http://127.0.0.1:8317"
const DEFAULT_INTERVAL_MS = 60_000
const MIN_INTERVAL_MS = 10_000

// Anthropic allows a few oauth/usage requests per token every few minutes and answers 429 with Retry-After: 0.
const PROBE_INTERVAL_MS: Readonly<Record<string, number>> = { claude: 300_000 }
const managementMemory = new WeakMap<ProbeMemory, Map<string, ManagementEntry>>()
const refreshMemory = new WeakMap<ProbeMemory, Map<string, Promise<FetchResult>>>()

export function fetchAccounts(settings: Settings, now: number, memory: ProbeMemory = new Map()): Promise<FetchResult> {
  if (!settings.managementKey)
    return Promise.resolve({ ok: false, error: "Set the CLIPROXY_MANAGEMENT_KEY environment variable or the managementKey plugin option" })
  const key = settingsKey(settings)
  const inFlight = refreshMemory.get(memory)?.get(key)
  if (inFlight) return inFlight
  const promise = fetchAccountsOnce(settings, now, memory, key)
  const refreshes = refreshMemory.get(memory) ?? new Map<string, Promise<FetchResult>>()
  refreshes.set(key, promise)
  refreshMemory.set(memory, refreshes)
  void promise.then(
    () => {
      if (refreshes.get(key) === promise) refreshes.delete(key)
    },
    () => {
      if (refreshes.get(key) === promise) refreshes.delete(key)
    },
  )
  return promise
}

async function fetchAccountsOnce(settings: Settings, now: number, memory: ProbeMemory, key: string): Promise<FetchResult> {
  const blocked = managementMemory.get(memory)?.get(operationKey(key, "credentials"))
  if (blocked && now < blocked.retryAt) return { ok: false, error: blocked.error }
  managementMemory.get(memory)?.delete(operationKey(key, "credentials"))
  const response = await management(settings, "/v8/management/credentials", undefined, now)
  if (!response.ok) {
    if (response.retryAfterMs !== undefined) {
      const entries = managementMemory.get(memory) ?? new Map<string, ManagementEntry>()
      entries.set(operationKey(key, "credentials"), { retryAt: now + response.retryAfterMs, error: response.error })
      managementMemory.set(memory, entries)
    }
    return { ok: false, error: response.error }
  }
  const live = (
    await Promise.all(
      probeTargets(response.body).map(async (target) => {
        const previous = memory.get(target.authIndex)
        if (previous && now - previous.attemptedAt < (PROBE_INTERVAL_MS[target.provider] ?? 0)) return previous.live
        const probeKey = operationKey(key, `probe:${target.authIndex}`)
        const blockedProbe = managementMemory.get(memory)?.get(probeKey)
        if (blockedProbe && now < blockedProbe.retryAt) return previous?.live ?? []
        managementMemory.get(memory)?.delete(probeKey)
        memory.set(target.authIndex, { attemptedAt: now, live: previous?.live ?? [] })
        const probe = await management(settings, "/v8/management/requests/api-call", target.call, now)
        if (!probe.ok) {
          if (probe.retryAfterMs !== undefined) {
            const entries = managementMemory.get(memory) ?? new Map<string, ManagementEntry>()
            entries.set(probeKey, { retryAt: now + probe.retryAfterMs, error: probe.error })
            managementMemory.set(memory, entries)
          }
          return previous?.live ?? []
        }
        const results = parseProbe(target.provider, await upstreamBody(probe.body))
        if (results.length === 0) return previous?.live ?? []
        const accounts = results.map((result) => ({
          provider: result.provider,
          label: target.label,
          authIndex: target.authIndex,
          observedAt: now,
          windows: result.windows,
        }))
        memory.set(target.authIndex, { attemptedAt: now, live: accounts })
        return accounts
      }),
    )
  ).flat()
  return { ok: true, accounts: mergeAccounts(parseCredentials(response.body, now), live, now) }
}

export function resolveSettings(
  options: Readonly<Record<string, unknown>>,
  env: Readonly<Record<string, string | undefined>>,
) {
  const seconds = typeof options.intervalSeconds === "number" ? options.intervalSeconds : undefined
  return {
    baseURL: (stringOption(options.baseURL) ?? env.CLIPROXY_URL ?? DEFAULT_URL).replace(/\/+$/, ""),
    managementKey: stringOption(options.managementKey) ?? env.CLIPROXY_MANAGEMENT_KEY ?? "",
    intervalMs: seconds === undefined ? DEFAULT_INTERVAL_MS : Math.max(MIN_INTERVAL_MS, seconds * 1000),
    providers: Array.isArray(options.providers)
      ? options.providers.filter((item): item is string => typeof item === "string")
      : [],
  }
}

async function management(settings: Settings, path: string, body?: object, now = Date.now()) {
  const response = await fetch(`${settings.baseURL}${path}`, {
    method: body ? "POST" : "GET",
    headers: { "X-Management-Key": settings.managementKey, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  }).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))))
  if (response instanceof Error) return { ok: false as const, error: response.message, retryAfterMs: undefined }
  const json: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const message = errorMessage(json) ?? response.statusText
    const retryAfterMs = response.status === 403 || response.status === 429 ? retryAfterMsFrom(response, message, now) : undefined
    return { ok: false as const, error: `HTTP ${response.status}: ${message}`, retryAfterMs }
  }
  return { ok: true as const, body: json }
}

async function upstreamBody(value: unknown): Promise<unknown> {
  if (typeof value !== "object" || value === null || !("status_code" in value) || !("body" in value)) return undefined
  if (value.status_code !== 200 || typeof value.body !== "string") return undefined
  return new Response(value.body).json().catch(() => undefined)
}

function stringOption(value: unknown) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined
}

function errorMessage(body: unknown) {
  if (typeof body !== "object" || body === null || !("error" in body)) return undefined
  return typeof body.error === "string" ? body.error : undefined
}

function retryAfterMsFrom(response: Response, message: string, now: number) {
  const header = response.headers.get("retry-after")
  if (header && /^\d+(?:\.\d+)?$/.test(header)) return Number(header) * 1000
  if (header) {
    const timestamp = Date.parse(header)
    if (!Number.isNaN(timestamp)) return Math.max(0, timestamp - now)
  }
  const match = message.match(/\b(?:try again|retry)\s+(?:in|after)\s+((?:\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b\s*(?:and|,)?\s*)+)/i)
  if (!match) return undefined
  const duration = match[1] ?? ""
  const values = [...duration.matchAll(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/gi)]
  const milliseconds = values.reduce((total, value) => {
    const amount = Number(value[1])
    const unit = (value[2] ?? "").toLowerCase()
    if (unit.startsWith("h")) return total + amount * 3_600_000
    if (unit.startsWith("m")) return total + amount * 60_000
    return total + amount * 1_000
  }, 0)
  return milliseconds > 0 ? milliseconds : undefined
}

function settingsKey(settings: Settings) {
  return `${settings.baseURL}\u0000${settings.managementKey}`
}

function operationKey(settings: string, operation: string) {
  return `${settings}\u0000${operation}`
}
