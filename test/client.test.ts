import { afterAll, describe, expect, test } from "bun:test"
import { fetchAccounts, resolveSettings } from "../src/client.ts"
import type { Account } from "../src/quota.ts"

const seen: { path: string; key: string | null }[] = []
const probes: unknown[] = []
const claude = { status: 200, probes: 0, observedAt: "2026-10-06T12:00:00Z", fiveHour: "0.2", sevenDay: "0.4" }
let concurrentBannedRequests = 0
let recoveryRequests = 0
let probeBannedRequests = 0
const claudeSettings = () => ({ baseURL: `${server.url.origin}/claude`, managementKey: "secret" })

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    seen.push({ path: url.pathname, key: request.headers.get("x-management-key") })
    if (request.headers.get("x-management-key") !== "secret") return Response.json({ error: "invalid management key" }, { status: 401 })
    if (url.pathname === "/broken/v8/management/credentials") return new Response("upstream exploded", { status: 502, statusText: "Bad Gateway" })
    if (url.pathname === "/banned/v8/management/credentials")
      return Response.json({ error: "IP banned due to too many failed attempts. Try again in 2m" }, { status: 403 })
    if (url.pathname === "/banned-worded/v8/management/credentials")
      return Response.json({ error: "IP banned due to too many failed attempts. Try again in 30 seconds" }, { status: 429 })
    if (url.pathname === "/retry-header/v8/management/credentials")
      return Response.json({ error: "temporarily unavailable" }, { status: 429, headers: { "Retry-After": "3" } })
    if (url.pathname === "/retry-date/v8/management/credentials")
      return Response.json({ error: "temporarily unavailable" }, { status: 429, headers: { "Retry-After": "Thu, 01 Jan 1970 00:02:03 GMT" } })
    if (url.pathname === "/banned-concurrent/v8/management/credentials") {
      concurrentBannedRequests++
      await Bun.sleep(10)
      return Response.json({ error: "IP banned due to too many failed attempts. Try again in 2m" }, { status: 403 })
    }
    if (url.pathname === "/recover/v8/management/credentials") {
      recoveryRequests++
      if (recoveryRequests === 1)
        return Response.json({ error: "IP banned due to too many failed attempts. Try again in 2m" }, { status: 403 })
      return Response.json({ files: [{ provider: "codex", label: "recovered", quota: { signals: { "X-Codex-Primary-Used-Percent": "12" } } }] })
    }
    if (url.pathname === "/probe-banned/v8/management/credentials")
      return Response.json({ files: [{ provider: "codex", auth_index: "probe-banned", label: "recorded", quota: { signals: { "X-Codex-Primary-Used-Percent": "9" } } }] })
    if (url.pathname === "/probe-banned/v8/management/requests/api-call") {
      probeBannedRequests++
      return Response.json({ error: "IP banned due to too many failed attempts. Try again in 2m" }, { status: 403 })
    }
    if (url.pathname === "/html/v8/management/credentials")
      return Response.json({
        files: [{ provider: "codex", auth_index: "h1", label: "h", quota: { signals: { "X-Codex-Primary-Used-Percent": "3" } } }],
      })
    if (url.pathname === "/html/v8/management/requests/api-call") return Response.json({ status_code: 200, header: {}, body: "<html>login</html>" })
    if (url.pathname === "/failing/v8/management/credentials")
      return Response.json({
        files: [{ provider: "codex", auth_index: "x1", label: "x", quota: { signals: { "X-Codex-Primary-Used-Percent": "9" } } }],
      })
    if (url.pathname === "/failing/v8/management/requests/api-call") return Response.json({ status_code: 401, header: {}, body: "{}" })
    if (url.pathname === "/claude/v8/management/credentials")
      return Response.json({
        files: [
          {
            provider: "claude",
            auth_index: "c1",
            label: "claude-a",
            quota: {
              observed_at: claude.observedAt,
              signals: {
                "Anthropic-Ratelimit-Unified-5h-Utilization": claude.fiveHour,
                "Anthropic-Ratelimit-Unified-5h-Reset": "1791298800",
                "Anthropic-Ratelimit-Unified-7d-Utilization": claude.sevenDay,
                "Anthropic-Ratelimit-Unified-7d-Reset": "1791514800",
              },
            },
          },
        ],
      })
    if (url.pathname === "/claude/v8/management/requests/api-call") {
      claude.probes++
      if (claude.status === 429)
        return Response.json({
          status_code: 429,
          header: { "Retry-After": ["0"] },
          body: JSON.stringify({ error: { type: "rate_limit_error", message: "Rate limited. Please try again later." } }),
        })
      return Response.json({
        status_code: 200,
        header: {},
        body: JSON.stringify({
          five_hour: { utilization: 34, resets_at: "2026-10-06T15:00:00Z" },
          seven_day: { utilization: 61, resets_at: "2026-10-09T03:00:00Z" },
          limits: [{ kind: "weekly_scoped", percent: 25, resets_at: "2026-10-06T13:00:00Z", scope: { model: { display_name: "Fable" } }, is_active: true }],
        }),
      })
    }
    if (url.pathname.endsWith("/v8/management/requests/api-call")) {
      const body = await request.json()
      probes.push(body)
      return Response.json({
        status_code: 200,
        header: {},
        body: JSON.stringify({ userStatus: { planStatus: { dailyQuotaRemainingPercent: 75, weeklyQuotaRemainingPercent: 40 } } }),
      })
    }
    if (url.pathname === "/devin/v8/management/credentials")
      return Response.json({ files: [{ provider: "devin", auth_index: "d1", label: "dev", quota: { signals: {} } }] })
    return Response.json({
      files: [{ provider: "codex", label: "a", quota: { signals: { "X-Codex-Primary-Used-Percent": "12" } } }],
    })
  },
})

afterAll(() => server.stop(true))

describe("fetchAccounts", () => {
  test("reads credentials from the v8 management API with the management key", async () => {
    expect(await fetchAccounts({ baseURL: server.url.origin, managementKey: "secret" }, 0)).toEqual({
      ok: true,
      accounts: [{ provider: "codex", label: "a", authIndex: undefined, observedAt: undefined, windows: [{ kind: "5h", usedPercent: 12, resetAt: undefined }] }],
    })
    expect(seen.at(-1)).toEqual({ path: "/v8/management/credentials", key: "secret" })
  })

  test("probes each Devin credential through the proxy's api-call and reads the answer", async () => {
    const result = await fetchAccounts({ baseURL: `${server.url.origin}/devin`, managementKey: "secret" }, 0)
    expect(result).toEqual({
      ok: true,
      accounts: [
        {
          provider: "devin",
          label: "dev",
          authIndex: "d1",
          observedAt: 0,
          windows: [
            { kind: "day", usedPercent: 25, resetAt: undefined },
            { kind: "week", usedPercent: 60, resetAt: undefined },
          ],
        },
      ],
    })
    expect(probes.map((probe) => (probe as { auth_index: string }).auth_index)).toEqual(["d1"])
  })

  test("keeps the recorded signals of a credential whose probe fails", async () => {
    expect(await fetchAccounts({ baseURL: `${server.url.origin}/failing`, managementKey: "secret" }, 0)).toEqual({
      ok: true,
      accounts: [
        { provider: "codex", label: "x", authIndex: "x1", observedAt: undefined, windows: [{ kind: "5h", usedPercent: 9, resetAt: undefined }] },
      ],
    })
  })

  test("keeps the last live Claude windows, including Fable, when a later probe is rate limited", async () => {
    Object.assign(claude, { status: 200, probes: 0, observedAt: "2026-10-06T12:00:00Z", fiveHour: "0.2", sevenDay: "0.4" })
    const memory = new Map()
    const live: Account = {
      provider: "claude",
      label: "claude-a",
      authIndex: "c1",
      observedAt: 1791288600_000,
      windows: [
        { kind: "5h", usedPercent: 34, resetAt: 1791298800_000 },
        { kind: "week", usedPercent: 61, resetAt: 1791514800_000 },
        { kind: "fable", usedPercent: 25, resetAt: 1791291600_000 },
      ],
    }
    expect(await fetchAccounts(claudeSettings(), 1791288600_000, memory)).toEqual({ ok: true, accounts: [live] })
    claude.status = 429
    expect(await fetchAccounts(claudeSettings(), 1791288900_000, memory)).toEqual({ ok: true, accounts: [live] })
    expect(claude.probes).toBe(2)
  })

  test("asks Anthropic about a Claude credential at most once every five minutes", async () => {
    Object.assign(claude, { status: 200, probes: 0, observedAt: "2026-10-06T12:00:00Z", fiveHour: "0.2", sevenDay: "0.4" })
    const memory = new Map()
    const counts: number[] = []
    for (const now of [1791288600_000, 1791288660_000, 1791288899_000, 1791288900_000]) {
      await fetchAccounts(claudeSettings(), now, memory)
      counts.push(claude.probes)
    }
    expect(counts).toEqual([1, 1, 1, 2])
  })

  test("shows each Claude window from its newest observation and keeps Fable from the last probe", async () => {
    Object.assign(claude, { status: 200, probes: 0, observedAt: "2026-10-06T12:00:00Z", fiveHour: "0.2", sevenDay: "0.4" })
    const memory = new Map()
    await fetchAccounts(claudeSettings(), 1791288600_000, memory)
    Object.assign(claude, { observedAt: "2026-10-06T12:12:00Z", fiveHour: "0.5", sevenDay: "0.62" })
    expect(await fetchAccounts(claudeSettings(), 1791288780_000, memory)).toEqual({
      ok: true,
      accounts: [
        {
          provider: "claude",
          label: "claude-a",
          authIndex: "c1",
          observedAt: 1791288720_000,
          windows: [
            { kind: "5h", usedPercent: 50, resetAt: 1791298800_000 },
            { kind: "week", usedPercent: 62, resetAt: 1791514800_000 },
            { kind: "fable", usedPercent: 25, resetAt: 1791291600_000 },
          ],
        },
      ],
    })
  })

  test("treats a kept live window whose reset time has passed as renewed", async () => {
    Object.assign(claude, { status: 200, probes: 0, observedAt: "2026-10-06T12:00:00Z", fiveHour: "0.2", sevenDay: "0.4" })
    const memory = new Map()
    await fetchAccounts(claudeSettings(), 1791288600_000, memory)
    claude.status = 429
    const later = await fetchAccounts(claudeSettings(), 1791295800_000, memory)
    expect(later.ok && later.accounts.map((account) => account.windows)).toEqual([
      [
        { kind: "5h", usedPercent: 34, resetAt: 1791298800_000 },
        { kind: "week", usedPercent: 61, resetAt: 1791514800_000 },
        { kind: "fable", usedPercent: 0, resetAt: undefined },
      ],
    ])
  })

  test("reports the HTTP status when the proxy answers with something other than JSON", async () => {
    expect(await fetchAccounts({ baseURL: `${server.url.origin}/broken`, managementKey: "secret" }, 0)).toEqual({
      ok: false,
      error: "HTTP 502: Bad Gateway",
    })
  })

  test("keeps the recorded signals when the upstream answers a probe with something other than JSON", async () => {
    expect(await fetchAccounts({ baseURL: `${server.url.origin}/html`, managementKey: "secret" }, 0)).toEqual({
      ok: true,
      accounts: [
        { provider: "codex", label: "h", authIndex: "h1", observedAt: undefined, windows: [{ kind: "5h", usedPercent: 3, resetAt: undefined }] },
      ],
    })
  })

  test("reports the proxy's error message on a rejected key", async () => {
    expect(await fetchAccounts({ baseURL: server.url.origin, managementKey: "wrong" }, 0)).toEqual({
      ok: false,
      error: "HTTP 401: invalid management key",
    })
  })

  test("does not repeat a temporarily blocked management request before its retry time", async () => {
    const memory = new Map()
    const settings = { baseURL: `${server.url.origin}/banned`, managementKey: "secret" }
    const first = await fetchAccounts(settings, 1_000, memory)
    const requestsAfterFirst = seen.length
    expect(first).toEqual({ ok: false, error: "HTTP 403: IP banned due to too many failed attempts. Try again in 2m" })

    expect(await fetchAccounts(settings, 61_000, memory)).toEqual(first)
    expect(seen.length).toBe(requestsAfterFirst)
    expect((await fetchAccounts({ baseURL: server.url.origin, managementKey: "secret" }, 61_000, memory)).ok).toBe(true)
    expect(seen.length).toBe(requestsAfterFirst + 1)
    expect((await fetchAccounts(settings, 121_000, memory)).ok).toBe(false)
    expect(seen.length).toBe(requestsAfterFirst + 2)
  })

  test("parses worded retry durations and Retry-After seconds", async () => {
    const wordedMemory = new Map()
    const worded = { baseURL: `${server.url.origin}/banned-worded`, managementKey: "secret" }
    await fetchAccounts(worded, 1_000, wordedMemory)
    const afterWorded = seen.length
    await fetchAccounts(worded, 30_000, wordedMemory)
    expect(seen.length).toBe(afterWorded)

    const headerMemory = new Map()
    const header = { baseURL: `${server.url.origin}/retry-header`, managementKey: "secret" }
    await fetchAccounts(header, 1_000, headerMemory)
    const afterHeader = seen.length
    await fetchAccounts(header, 3_000, headerMemory)
    expect(seen.length).toBe(afterHeader)
    await fetchAccounts(header, 4_000, headerMemory)
    expect(seen.length).toBe(afterHeader + 1)

    const dateMemory = new Map()
    const date = { baseURL: `${server.url.origin}/retry-date`, managementKey: "secret" }
    await fetchAccounts(date, 1_000, dateMemory)
    const afterDate = seen.length
    await fetchAccounts(date, 122_000, dateMemory)
    expect(seen.length).toBe(afterDate)
    await fetchAccounts(date, 123_000, dateMemory)
    expect(seen.length).toBe(afterDate + 1)
  })

  test("deduplicates overlapping blocked refreshes and resumes normal reads after expiry", async () => {
    const memory = new Map()
    const concurrent = { baseURL: `${server.url.origin}/banned-concurrent`, managementKey: "secret" }
    await Promise.all([fetchAccounts(concurrent, 1_000, memory), fetchAccounts(concurrent, 1_000, memory)])
    expect(concurrentBannedRequests).toBe(1)

    const recovery = { baseURL: `${server.url.origin}/recover`, managementKey: "secret" }
    const recoveryMemory = new Map()
    expect(await fetchAccounts(recovery, 1_000, recoveryMemory)).toEqual({ ok: false, error: "HTTP 403: IP banned due to too many failed attempts. Try again in 2m" })
    expect(await fetchAccounts(recovery, 121_000, recoveryMemory)).toEqual({
      ok: true,
      accounts: [{ provider: "codex", label: "recovered", authIndex: undefined, observedAt: undefined, windows: [{ kind: "5h", usedPercent: 12, resetAt: undefined }] }],
    })
    expect(recoveryRequests).toBe(2)
  })

  test("backs off a rate-limited quota probe while keeping recorded signals", async () => {
    const memory = new Map()
    const settings = { baseURL: `${server.url.origin}/probe-banned`, managementKey: "secret" }
    expect(await fetchAccounts(settings, 1_000, memory)).toEqual({
      ok: true,
      accounts: [{ provider: "codex", label: "recorded", authIndex: "probe-banned", observedAt: undefined, windows: [{ kind: "5h", usedPercent: 9, resetAt: undefined }] }],
    })
    expect(await fetchAccounts(settings, 61_000, memory)).toEqual({
      ok: true,
      accounts: [{ provider: "codex", label: "recorded", authIndex: "probe-banned", observedAt: undefined, windows: [{ kind: "5h", usedPercent: 9, resetAt: undefined }] }],
    })
    expect(probeBannedRequests).toBe(1)
  })

  test("reports a missing key without calling the proxy", async () => {
    const before = seen.length
    expect(await fetchAccounts({ baseURL: server.url.origin, managementKey: "" }, 0)).toEqual({
      ok: false,
      error: "Set the CLIPROXY_MANAGEMENT_KEY environment variable or the managementKey plugin option",
    })
    expect(seen.length).toBe(before)
  })

  test("reports an unreachable proxy with the runtime's connection error", async () => {
    expect(await fetchAccounts({ baseURL: "http://127.0.0.1:1", managementKey: "secret" }, 0)).toEqual({
      ok: false,
      error: expect.stringContaining("Unable to connect. Is the computer able to access the url?"),
    })
  })
})

describe("resolveSettings", () => {
  test("prefers plugin options over the environment and trims a trailing slash", () => {
    const env = { CLIPROXY_MANAGEMENT_KEY: "env", CLIPROXY_URL: "http://env:1" }
    const settings = resolveSettings({ baseURL: "http://proxy:9000/", managementKey: "opt" }, env)
    expect([settings.baseURL, settings.managementKey]).toEqual(["http://proxy:9000", "opt"])
  })

  test("falls back to the environment when options are missing or blank", () => {
    const settings = resolveSettings({ managementKey: "  " }, { CLIPROXY_MANAGEMENT_KEY: "env", CLIPROXY_URL: "http://127.0.0.1:8400" })
    expect([settings.baseURL, settings.managementKey]).toEqual(["http://127.0.0.1:8400", "env"])
  })

  test("converts the refresh interval from seconds and clamps it to a 10 second floor", () => {
    expect(resolveSettings({ intervalSeconds: 30 }, {}).intervalMs).toBe(30_000)
    expect(resolveSettings({ intervalSeconds: 1 }, {}).intervalMs).toBe(10_000)
  })

  test("keeps only the string provider IDs", () => {
    expect(resolveSettings({ providers: ["proxy", 3, "cpa"] }, {}).providers).toEqual(["proxy", "cpa"])
  })
})
