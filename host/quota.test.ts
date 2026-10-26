import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test"
import { childRoutes, HAIKU, OPUS, SOL, SONNET, toolResults, type Call, type Reply } from "./harness/fixture.ts"
import { Host } from "./harness/host.ts"

const TIMEOUT = 120_000
const KEY = "stub-key"
const SKIP_REASON = "account quota below 5%"

let host: Host | undefined
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

afterEach(async () => {
  await host?.stop()
  host = undefined
})

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

// The parent dispatches one subagent with `args`, then ends its turn once the result comes back.
const dispatch = (args: Record<string, unknown>) => (call: Call): Reply => {
  if (call.provider !== "fixture") return { text: "child answer" }
  if (toolResults(call.request).length) return { text: "parent done" }
  return { tool: "subagent", args: { description: "look it up", prompt: "find the fact", ...args } }
}

type ToolPart = { type: "tool"; name: string; state: { status: string; metadata: Record<string, unknown> } }

const run = async (args: Record<string, unknown>) => {
  host = await Host.start({ script: dispatch(args), env: quotaEnv() })
  const session = await host.session()
  await host.prompt(session, "delegate")
  await host.settle(session)
  return { host, session }
}

const modelPolicyTrails = async (host: Host, session: { id: string }) =>
  (await host.messages(session))
    .flatMap((message) => (Array.isArray(message.content) ? (message.content as ToolPart[]) : []))
    .filter((part) => part.type === "tool" && part.name === "subagent")
    .map((part) => part.state.metadata.modelPolicy)

describe("implementer dispatch with Claude quota exhausted", () => {
  test(
    "an implementer skips the exhausted Claude routes and runs on Sol 5.5 at medium effort",
    async () => {
      respond = () => Response.json(credentials("0.99"))
      const { host: running, session } = await run({ agent: "implementer" })

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

describe("unpolicied agents do not read quota", () => {
  test(
    "a general agent runs without any quota request",
    async () => {
      respond = () => Response.json(credentials("0.99"))
      const { host: running } = await run({ agent: "general", model: `${OPUS}#low` })

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
      const { host: running } = await run({ agent: "implementer" })

      expect(childRoutes(running.fixture.agentCalls())).toEqual([`${HAIKU}#medium`])
      expect(requests.length).toBeGreaterThanOrEqual(1)
    },
    TIMEOUT,
  )
})
