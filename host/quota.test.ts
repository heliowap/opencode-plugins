import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test"
import { FLOOR_PERCENT } from "../src/quota.ts"
import {
  childRoutes,
  dispatch,
  HAIKU,
  OPUS,
  redispatching,
  routeOf,
  run,
  SOL,
  SONNET,
  stopRuns,
  toolParts,
  type Call,
  type Reply,
} from "./harness/fixture.ts"
import { Host } from "./harness/host.ts"

const TIMEOUT = 120_000
// The test waits out the 60-second quota cache and a rate-limited child, so it needs more than TIMEOUT.
const LONG_TIMEOUT = 180_000
const KEY = "stub-key"
const SKIP_REASON = `account quota below ${FLOOR_PERCENT}%`

let respond: () => Response = () => Response.json(credentials("0.2"))
let requests: { path: string; key: string | null }[] = []

// Stands in for the CLIProxyAPI management API and records every request it receives.
const stub = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(request) {
    const url = new URL(request.url)
    requests.push({ path: url.pathname, key: request.headers.get("x-management-key") })
    return respond()
  },
})

beforeEach(() => {
  requests = []
  respond = () => Response.json(credentials("0.2"))
})

afterEach(() => stopRuns())

afterAll(() => stub.stop(true))

// One enabled Claude account whose 5h window is at `utilization`, with both windows resetting in the future.
function credentials(utilization: string) {
  const now = Math.floor(Date.now() / 1000)
  return {
    files: [
      {
        provider: "claude",
        label: "claude-a",
        quota: {
          signals: {
            "Anthropic-Ratelimit-Unified-5h-Utilization": utilization,
            "Anthropic-Ratelimit-Unified-5h-Reset": String(now + 3600),
            "Anthropic-Ratelimit-Unified-7d-Utilization": "0.2",
            "Anthropic-Ratelimit-Unified-7d-Reset": String(now + 86_400),
          },
        },
      },
    ],
  }
}

const quotaEnv = () => ({ CLIPROXY_URL: `http://127.0.0.1:${stub.port}`, CLIPROXY_MANAGEMENT_KEY: KEY })

const runWithQuota = (args: Record<string, unknown>) => run({ script: dispatch(args), env: quotaEnv() })

const modelPolicyTrails = async (host: Host, session: { id: string }) =>
  (await toolParts(host, session)).map((part) => part.state.metadata.modelPolicy)

describe("implementer dispatch with Claude quota exhausted", () => {
  test(
    "an implementer skips the exhausted Claude routes and runs on GPT-6.1 Sol at medium effort",
    async () => {
      respond = () => Response.json(credentials("0.99"))
      const { host: running, session } = await runWithQuota({ agent: "implementer" })

      expect(childRoutes(running.fixture.agentCalls())).toEqual([`${SOL}#medium`])
      const [trail] = await modelPolicyTrails(running, session)
      expect(trail).toMatchObject({
        route: `${SOL}#medium`,
        skipped: [
          { route: HAIKU, reason: SKIP_REASON },
          { route: SONNET, reason: SKIP_REASON },
        ],
      })
      expect(requests.length).toBeGreaterThanOrEqual(1)
      expect(requests.every((request) => request.path === "/v8/management/credentials" && request.key === KEY)).toBe(true)
    },
    TIMEOUT,
  )
})

describe("retry with Claude quota exhausted", () => {
  test(
    "a rate-limited GPT-6.1 Sol route with no Claude fallback is retried on Sol, not failed back to the parent",
    async () => {
      respond = () => Response.json(credentials("0.99"))
      let solCalls = 0
      const script = dispatch({ agent: "implementer" }, (call) =>
        routeOf(call) === SOL && solCalls++ === 0 ? { status: 429, error: "rate limited" } : { text: "child answer" },
      )
      const { host: running, session } = await run({ script, env: quotaEnv() })

      expect((await toolParts(running, session)).map((part) => part.state.status)).toEqual(["completed"])
      expect(childRoutes(running.fixture.agentCalls())).toEqual([`${SOL}#medium`, `${SOL}#medium`])
    },
    TIMEOUT,
  )
})

describe("a Haiku child that started before Claude was exhausted", () => {
  test(
    "fails fast to the parent when rate-limited after Claude is exhausted, instead of retrying Haiku in place",
    async () => {
      let haikuCalls = 0
      const child = (call: Call): Reply => {
        if (routeOf(call) !== HAIKU) return { text: `child answer from ${routeOf(call)}` }
        // Only the first Haiku call is rate-limited, and only after 80 seconds, by which time the later dispatch has read the exhausted quota.
        return haikuCalls++ === 0 ? { status: 429, error: "rate limited", delayMs: 80_000 } : { text: `child answer from ${HAIKU}` }
      }
      const script = (call: Call): Reply =>
        call.provider === "fixture"
          ? redispatching([{ agent: "implementer", description: "look it up", prompt: "find the fact" }])(call.request)
          : child(call)
      const host = await Host.start({ script, env: quotaEnv() })
      try {
        const early = await host.session()
        await host.prompt(early, "delegate")
        await host.until(() => host.fixture.agentCalls("cli_proxy").length > 0)
        // The quota read is cached for 60 seconds, so wait it out: the next dispatch then reads the exhausted account.
        await Bun.sleep(61_000)
        respond = () => Response.json(credentials("0.99"))
        const late = await host.session()
        await host.prompt(late, "delegate again")
        await host.until(() => host.fixture.agentCalls("cli_proxy_openai").length > 0)
        await host.until(() => childRoutes(host.fixture.agentCalls()).length >= 3, 120_000)
        await host.settle(early)

        expect((await toolParts(host, early)).map((part) => part.state.status)).toEqual(["error", "completed"])
        expect(childRoutes(host.fixture.agentCalls())).toEqual([`${HAIKU}#medium`, `${SOL}#medium`, `${SOL}#medium`])
      } finally {
        await host.stop()
      }
    },
    LONG_TIMEOUT,
  )
})

describe("unpolicied agents do not read quota", () => {
  test(
    "a general agent runs without any quota request",
    async () => {
      respond = () => Response.json(credentials("0.99"))
      const { host: running } = await runWithQuota({ agent: "general", model: `${OPUS}#low` })

      expect(childRoutes(running.fixture.agentCalls())).toEqual([`${OPUS}#low`])
      expect(requests).toHaveLength(0)
    },
    TIMEOUT,
  )
})

describe("unknown quota never reroutes", () => {
  test(
    "a failing credentials endpoint leaves the implementer on Haiku 5.5 at medium effort",
    async () => {
      respond = () => new Response("upstream exploded", { status: 500 })
      const { host: running } = await runWithQuota({ agent: "implementer" })

      expect(childRoutes(running.fixture.agentCalls())).toEqual([`${HAIKU}#medium`])
      expect(requests.length).toBeGreaterThanOrEqual(1)
    },
    TIMEOUT,
  )
})
