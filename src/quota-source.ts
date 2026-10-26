import { claudeQuota, type ClaudeQuota } from "./quota.ts"

export interface QuotaSettings {
  readonly baseURL: string
  readonly managementKey: string
}

export interface QuotaSourceOptions {
  readonly ttlMs?: number
  readonly backoffMs?: number
  readonly timeoutMs?: number
  readonly now?: () => number
}

export interface QuotaSource {
  readonly claude: () => Promise<ClaudeQuota>
}

const UNKNOWN: ClaudeQuota = { _tag: "Unknown" }

// Rejected or rate-limited management calls are not retried until the backoff passes.
const BLOCKING_STATUSES = new Set([401, 403, 429])

export const quotaSettings = (env: Readonly<Record<string, string | undefined>>): QuotaSettings => ({
  baseURL: (env.CLIPROXY_URL ?? "http://127.0.0.1:8317").replace(/\/+$/, ""),
  managementKey: env.CLIPROXY_MANAGEMENT_KEY ?? "",
})

// Reads quota from the proxy's management API. It never throws: any failure reads as unknown quota, which blocks nothing.
export function quotaSource(settings: QuotaSettings, options: QuotaSourceOptions = {}): QuotaSource {
  const { ttlMs = 60_000, backoffMs = 600_000, timeoutMs = 2_000, now = Date.now } = options
  let cached: { readonly quota: ClaudeQuota; readonly until: number } | undefined
  let inflight: Promise<ClaudeQuota> | undefined
  let blockedUntil = 0

  const fetchCredentials = async (): Promise<ClaudeQuota> => {
    try {
      const response = await fetch(`${settings.baseURL}/v8/management/credentials`, {
        headers: { "X-Management-Key": settings.managementKey },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (BLOCKING_STATUSES.has(response.status)) {
        blockedUntil = now() + backoffMs
        return UNKNOWN
      }
      if (!response.ok) return UNKNOWN
      return claudeQuota(await response.json().catch(() => undefined), now())
    } catch {
      return UNKNOWN
    }
  }

  const load = async (): Promise<ClaudeQuota> => {
    const quota = now() < blockedUntil ? UNKNOWN : await fetchCredentials()
    cached = { quota, until: now() + ttlMs }
    return quota
  }

  return {
    claude() {
      if (settings.managementKey === "") return Promise.resolve(UNKNOWN)
      if (cached && now() < cached.until) return Promise.resolve(cached.quota)
      inflight ??= load().finally(() => {
        inflight = undefined
      })
      return inflight
    },
  }
}
