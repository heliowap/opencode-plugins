import { afterAll, beforeEach, describe, expect, test } from "bun:test"
import type { ClaudeQuota } from "../src/quota.ts"
import { quotaSettings, quotaSource } from "../src/quota-source.ts"

const NOW = Date.parse("2026-10-25T12:00:00Z")
const FUTURE = String(NOW / 1000 + 3600)
const CREDENTIALS = {
  files: [
    {
      provider: "claude",
      label: "claude-a",
      quota: {
        signals: {
          "Anthropic-Ratelimit-Unified-5h-Utilization": "0.2",
          "Anthropic-Ratelimit-Unified-5h-Reset": FUTURE,
          "Anthropic-Ratelimit-Unified-7d-Utilization": "0.4",
          "Anthropic-Ratelimit-Unified-7d-Reset": FUTURE,
        },
      },
    },
  ],
}
const AVAILABLE: ClaudeQuota = { _tag: "Known", exhausted: false }

let requests: { path: string; key: string | null }[] = []
let respond: (request: Request) => Response | Promise<Response> = () => Response.json(CREDENTIALS)

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(request) {
    const url = new URL(request.url)
    requests.push({ path: url.pathname, key: request.headers.get("x-management-key") })
    return respond(request)
  },
})

const settings = { baseURL: `http://127.0.0.1:${server.port}`, managementKey: "secret" }

beforeEach(() => {
  requests = []
  respond = () => Response.json(CREDENTIALS)
})

afterAll(() => server.stop(true))

describe("quota settings", () => {
  test("default to the local proxy with no management key", () => {
    expect(quotaSettings({})).toEqual({ baseURL: "http://127.0.0.1:8317", managementKey: "" })
  })

  test("an empty CLIPROXY_URL falls back to the default proxy", () => {
    expect(quotaSettings({ CLIPROXY_URL: "", CLIPROXY_MANAGEMENT_KEY: "k" })).toEqual({
      baseURL: "http://127.0.0.1:8317",
      managementKey: "k",
    })
  })

  test("come from the proxy environment, without trailing slashes", () => {
    expect(quotaSettings({ CLIPROXY_URL: "http://proxy.example:9000///", CLIPROXY_MANAGEMENT_KEY: "k" })).toEqual({
      baseURL: "http://proxy.example:9000",
      managementKey: "k",
    })
  })
})

describe("claude quota source", () => {
  test("reads the credentials endpoint with the management key", async () => {
    const source = quotaSource(settings)

    expect(await source.claude()).toEqual(AVAILABLE)
    expect(requests).toEqual([{ path: "/v8/management/credentials", key: "secret" }])
  })

  test("a second call within the TTL sends nothing", async () => {
    const source = quotaSource(settings)

    const first = await source.claude()
    const second = await source.claude()

    expect(second).toEqual(first)
    expect(requests).toHaveLength(1)
  })

  test("concurrent calls share one in-flight request", async () => {
    respond = async () => {
      await Bun.sleep(50)
      return Response.json(CREDENTIALS)
    }
    const source = quotaSource(settings)

    const results = await Promise.all([source.claude(), source.claude(), source.claude()])

    expect(results).toEqual([AVAILABLE, AVAILABLE, AVAILABLE])
    expect(requests).toHaveLength(1)
  })

  test.each([401, 403, 429])("after a %i nothing is sent within the backoff", async (status) => {
    respond = () => Response.json({ error: "rejected" }, { status })
    const source = quotaSource(settings, { ttlMs: 0, backoffMs: 60_000 })

    expect(await source.claude()).toEqual({ _tag: "Unknown" })
    respond = () => Response.json(CREDENTIALS)
    expect(await source.claude()).toEqual({ _tag: "Unknown" })

    expect(requests).toHaveLength(1)
  })

  test("after the backoff has passed, the next call requests again", async () => {
    let clock = NOW
    respond = () => Response.json({ error: "rejected" }, { status: 429 })
    const source = quotaSource(settings, { ttlMs: 0, backoffMs: 1_000, now: () => clock })

    await source.claude()
    clock += 1_001
    respond = () => Response.json(CREDENTIALS)

    expect(await source.claude()).toEqual(AVAILABLE)
    expect(requests).toHaveLength(2)
  })

  test("a response slower than the timeout is unknown", async () => {
    respond = async () => {
      await Bun.sleep(1_000)
      return Response.json(CREDENTIALS)
    }

    expect(await quotaSource(settings, { timeoutMs: 100 }).claude()).toEqual({ _tag: "Unknown" })
  })

  test("without a management key nothing is sent and the quota is unknown", async () => {
    const source = quotaSource({ ...settings, managementKey: "" })

    expect(await source.claude()).toEqual({ _tag: "Unknown" })
    expect(requests).toHaveLength(0)
  })

  test("a server error is unknown", async () => {
    respond = () => new Response("upstream exploded", { status: 500 })

    expect(await quotaSource(settings).claude()).toEqual({ _tag: "Unknown" })
  })

  test("a malformed body is unknown", async () => {
    respond = () => new Response("<html>login</html>", { status: 200 })

    expect(await quotaSource(settings).claude()).toEqual({ _tag: "Unknown" })
  })

  test("an unreachable proxy is unknown", async () => {
    const closed = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() })
    const port = closed.port
    closed.stop(true)

    expect(await quotaSource({ ...settings, baseURL: `http://127.0.0.1:${port}` }).claude()).toEqual({ _tag: "Unknown" })
  })
})
