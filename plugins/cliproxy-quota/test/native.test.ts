import { afterAll, describe, expect, test } from "bun:test"
import { fetchNativeAccounts } from "../src/native.ts"
import { NATIVE_SOURCES } from "../src/quota.ts"

const seen: { authorization: string | null; account: string | null }[] = []
const server = Bun.serve({
  port: 0,
  fetch(request) {
    seen.push({
      authorization: request.headers.get("authorization"),
      account: request.headers.get("chatgpt-account-id"),
    })
    const path = new URL(request.url).pathname
    if (path === "/rejected") return Response.json({ error: "expired" }, { status: 401 })
    if (path === "/html") return new Response("<html>login</html>")
    if (path === "/empty") return Response.json({ rate_limit: null })
    if (path === "/weekly")
      return Response.json({ rate_limit: { primary_window: { used_percent: 29, limit_window_seconds: 604800, reset_at: 1791589256 }, secondary_window: null } })
    if (path === "/go")
      return Response.json({
        usage: {
          rolling: { status: "ok", percent: 2, resetsAt: "2026-10-12T17:39:02.000Z" },
          weekly: { status: "ok", percent: 6, resetsAt: "2026-10-19T00:00:00.000Z" },
          monthly: { status: "ok", percent: 26, resetsAt: "2026-12-25T16:14:00.000Z" },
        },
      })
    if (path === "/go-limited")
      return Response.json({
        usage: {
          rolling: { status: "ok", percent: 12, resetsAt: "2026-10-12T17:39:02.000Z" },
          weekly: { status: "rate-limited", resetsAt: "2026-10-19T00:00:00.000Z" },
        },
      })
    if (path === "/go-empty") return Response.json({ usage: {} })
    return Response.json({
      rate_limit: {
        primary_window: { used_percent: 42, limit_window_seconds: 18000, reset_at: 1791298800 },
        secondary_window: { used_percent: 86, limit_window_seconds: 604800, reset_at: 1791589256 },
      },
    })
  },
})

afterAll(() => server.stop(true))

const connection = { id: "native-1", label: "ChatGPT Pro" }
const credential = { type: "oauth", methodID: "chatgpt-browser", access: "native-token", metadata: { accountID: "acct-native" } }
const goConnection = { id: "go-1", label: "Go" }
const goCredential = { type: "key", key: "test-key" }
const now = 1791288000_000

describe("fetchNativeAccounts", () => {
  test("reads native OpenAI OAuth quota with the resolved token and account, without a proxy key", async () => {
    expect(await fetchNativeAccounts("openai", NATIVE_SOURCES.openai, connection, credential, now, server.url.href)).toEqual({
      ok: true,
      accounts: [{
        provider: "codex",
        label: "ChatGPT Pro",
        authIndex: "openai:native-1",
        observedAt: 1791288000_000,
        windows: [
          { kind: "5h", usedPercent: 42, resetAt: 1791298800_000 },
          { kind: "week", usedPercent: 86, resetAt: 1791589256_000 },
        ],
      }],
    })
    expect(seen.at(-1)).toEqual({ authorization: "Bearer native-token", account: "acct-native" })
  })

  test("reads a weekly-only native OpenAI plan without inventing a five-hour allowance", async () => {
    expect(await fetchNativeAccounts("openai", NATIVE_SOURCES.openai, connection, { ...credential, methodID: "chatgpt-headless", metadata: {} }, now, `${server.url.origin}/weekly`)).toEqual({
      ok: true,
      accounts: [{ provider: "codex", label: "ChatGPT Pro", authIndex: "openai:native-1", observedAt: 1791288000_000,
        windows: [{ kind: "week", usedPercent: 29, resetAt: 1791589256_000 }] }],
    })
    expect(seen.at(-1)).toEqual({ authorization: "Bearer native-token", account: null })
  })

  test("does not send API keys, disconnected credentials, or token-sharing grants to Codex", async () => {
    const before = seen.length
    expect(await fetchNativeAccounts("openai", NATIVE_SOURCES.openai, connection, { ...credential, methodID: "chatgpt-token-sharing" }, now, server.url.href)).toEqual({
      ok: false, error: "Manage ChatGPT token sharing usage at https://chatgpt.com/settings/usage",
    })
    expect(await fetchNativeAccounts("openai", NATIVE_SOURCES.openai, connection, { type: "key" }, now, server.url.href)).toEqual({ ok: true, accounts: [] })
    expect(await fetchNativeAccounts("openai", NATIVE_SOURCES.openai, connection, undefined, now, server.url.href)).toEqual({ ok: true, accounts: [] })
    expect(await fetchNativeAccounts("openai", NATIVE_SOURCES.openai, undefined, credential, now, server.url.href)).toEqual({ ok: true, accounts: [] })
    expect(seen.length).toBe(before)
  })

  test("reports failed or malformed upstream answers instead of keeping another account's quota", async () => {
    expect(await fetchNativeAccounts("openai", NATIVE_SOURCES.openai, connection, credential, now, `${server.url.origin}/rejected`)).toEqual({ ok: false, error: "OpenAI quota: HTTP 401" })
    expect(await fetchNativeAccounts("openai", NATIVE_SOURCES.openai, connection, credential, now, `${server.url.origin}/html`)).toEqual({ ok: false, error: "OpenAI returned no quota data" })
    expect(await fetchNativeAccounts("openai", NATIVE_SOURCES.openai, connection, credential, now, `${server.url.origin}/empty`)).toEqual({ ok: false, error: "OpenAI returned no quota data" })
  })

  test("returns a safe error for unreachable or cancelled upstream requests", async () => {
    expect(await fetchNativeAccounts("openai", NATIVE_SOURCES.openai, connection, credential, now, "http://127.0.0.1:1")).toEqual({ ok: false, error: "Unable to fetch OpenAI quota" })
    expect(await fetchNativeAccounts("openai", NATIVE_SOURCES.openai, connection, credential, now, server.url.href, AbortSignal.abort())).toEqual({ ok: false, error: "Unable to fetch OpenAI quota" })
  })
})

describe("fetchNativeAccounts for OpenCode Go", () => {
  test("reads Go quota with the saved API key", async () => {
    expect(await fetchNativeAccounts("opencode-go", NATIVE_SOURCES["opencode-go"], goConnection, goCredential, now, `${server.url.origin}/go`)).toEqual({
      ok: true,
      accounts: [{
        provider: "opencode-go",
        label: "Go",
        authIndex: "opencode-go:go-1",
        observedAt: 1791288000_000,
        windows: [
          { kind: "5h", usedPercent: 2, resetAt: 1791826742000 },
          { kind: "week", usedPercent: 6, resetAt: 1792368000000 },
          { kind: "month", usedPercent: 26, resetAt: 1798215240000 },
        ],
      }],
    })
    expect(seen.at(-1)).toEqual({ authorization: "Bearer test-key", account: null })
  })

  test("marks a rate-limited Go window as fully used, since it omits the percent", async () => {
    expect(await fetchNativeAccounts("opencode-go", NATIVE_SOURCES["opencode-go"], goConnection, goCredential, now, `${server.url.origin}/go-limited`)).toEqual({
      ok: true,
      accounts: [{
        provider: "opencode-go",
        label: "Go",
        authIndex: "opencode-go:go-1",
        observedAt: 1791288000_000,
        windows: [
          { kind: "5h", usedPercent: 12, resetAt: 1791826742000 },
          { kind: "week", usedPercent: 100, resetAt: 1792368000000 },
        ],
      }],
    })
  })

  test("does not call OpenCode Go without a usable key", async () => {
    const before = seen.length
    expect(await fetchNativeAccounts("opencode-go", NATIVE_SOURCES["opencode-go"], goConnection, { type: "oauth", access: "native-token" }, now, `${server.url.origin}/go`)).toEqual({ ok: true, accounts: [] })
    expect(await fetchNativeAccounts("opencode-go", NATIVE_SOURCES["opencode-go"], goConnection, { type: "key" }, now, `${server.url.origin}/go`)).toEqual({ ok: true, accounts: [] })
    expect(await fetchNativeAccounts("opencode-go", NATIVE_SOURCES["opencode-go"], goConnection, { type: "key", key: "  " }, now, `${server.url.origin}/go`)).toEqual({ ok: true, accounts: [] })
    expect(await fetchNativeAccounts("opencode-go", NATIVE_SOURCES["opencode-go"], goConnection, undefined, now, `${server.url.origin}/go`)).toEqual({ ok: true, accounts: [] })
    expect(await fetchNativeAccounts("opencode-go", NATIVE_SOURCES["opencode-go"], undefined, goCredential, now, `${server.url.origin}/go`)).toEqual({ ok: true, accounts: [] })
    expect(seen.length).toBe(before)
  })

  test("reports failed or malformed Go answers", async () => {
    expect(await fetchNativeAccounts("opencode-go", NATIVE_SOURCES["opencode-go"], goConnection, goCredential, now, `${server.url.origin}/rejected`)).toEqual({ ok: false, error: "OpenCode Go quota: HTTP 401" })
    expect(await fetchNativeAccounts("opencode-go", NATIVE_SOURCES["opencode-go"], goConnection, goCredential, now, `${server.url.origin}/html`)).toEqual({ ok: false, error: "OpenCode Go returned no quota data" })
    expect(await fetchNativeAccounts("opencode-go", NATIVE_SOURCES["opencode-go"], goConnection, goCredential, now, `${server.url.origin}/go-empty`)).toEqual({ ok: false, error: "OpenCode Go returned no quota data" })
  })

  test("returns a safe error for unreachable or cancelled Go requests", async () => {
    expect(await fetchNativeAccounts("opencode-go", NATIVE_SOURCES["opencode-go"], goConnection, goCredential, now, "http://127.0.0.1:1")).toEqual({ ok: false, error: "Unable to fetch OpenCode Go quota" })
    expect(await fetchNativeAccounts("opencode-go", NATIVE_SOURCES["opencode-go"], goConnection, goCredential, now, `${server.url.origin}/go`, AbortSignal.abort())).toEqual({ ok: false, error: "Unable to fetch OpenCode Go quota" })
  })
})
