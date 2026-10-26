import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { childRoutes, FAILED, HAIKU, OPUS, redispatching, routeOf, SOL, SONNET, toolResults, type Call, type Reply } from "./harness/fixture.ts"
import { Host, type HostOptions } from "./harness/host.ts"

const TIMEOUT = 120_000
let host: Host | undefined

afterEach(async () => {
  await host?.stop()
  host = undefined
})

const dispatch = (args: Record<string, unknown>, child: (call: Call) => Reply = () => ({ text: "child answer" })) =>
  (call: Call): Reply => {
    if (call.provider !== "fixture") return child(call)
    if (toolResults(call.request).length) return { text: "parent done" }
    return { tool: "subagent", args: { description: "look it up", prompt: "find the fact", ...args } }
  }

const recovering =
  (args: Record<string, unknown>, child: (call: Call) => Reply, maxRounds = 3) =>
  (call: Call): Reply =>
    call.provider === "fixture"
      ? redispatching([{ description: "look it up", prompt: "find the fact", ...args }], maxRounds)(call.request)
      : child(call)

const run = async (options: HostOptions) => {
  host = await Host.start(options)
  const session = await host.session()
  await host.prompt(session, "delegate")
  await host.settle(session)
  return { host, session }
}

const failing =
  (routes: Record<string, number>): ((call: Call) => Reply) =>
  (call) => {
    const route = routeOf(call)
    const status = routes[route]
    return status ? { status, error: `fixture ${status} from ${route}` } : { text: `child answer from ${route}` }
  }

type ToolPart = { type: "tool"; name: string; state: { status: string; metadata: Record<string, unknown> } }

const toolParts = async (host: Host, session: { id: string }) =>
  (await host.messages(session))
    .flatMap((message) => (Array.isArray(message.content) ? (message.content as ToolPart[]) : []))
    .filter((part) => part.type === "tool" && part.name === "subagent")

const parentToolResult = (calls: Call[]) => toolResults(calls.filter((call) => call.provider === "fixture").at(-1)!.request).at(-1)

describe("research dispatch", () => {
  test(
    "a researcher runs on Sonnet 5.5 at medium effort even when the parent names another model",
    async () => {
      const { host } = await run({
        script: dispatch({ agent: "researcher", model: "openai/gpt-6.1-sol#high" }),
      })

      expect(childRoutes(host.fixture.agentCalls())).toEqual([`${SONNET}#medium`])
      expect(parentToolResult(host.fixture.calls)).toContain("child answer")
    },
    TIMEOUT,
  )

  test(
    "a rate-limited Sonnet route fails fast, and the re-dispatch runs on Opus 5.5 at low effort",
    async () => {
      const { host, session } = await run({ script: recovering({ agent: "researcher" }, failing({ [SONNET]: 429 })) })

      expect(childRoutes(host.fixture.agentCalls())).toEqual([`${SONNET}#medium`, `${OPUS}#low`])
      expect(parentToolResult(host.fixture.calls)).toContain(`child answer from ${OPUS}`)
      const [failed, recovered] = await toolParts(host, session)
      expect(failed!.state.status).toBe("error")
      const trail = recovered!.state.metadata.modelPolicy
      expect(trail).toEqual({
        agent: "researcher",
        route: `${OPUS}#low`,
        skipped: [],
        demoted: [`${SONNET}#medium`],
      })
      expect(JSON.stringify(trail)).not.toContain("find the fact")
    },
    TIMEOUT,
  )

  test(
    "a request the provider rejects as invalid is a task failure: the route stays first for the re-dispatch",
    async () => {
      const { host } = await run({ script: recovering({ agent: "researcher" }, failing({ [SONNET]: 400 }), 2) })

      expect(childRoutes(host.fixture.agentCalls())).toEqual([`${SONNET}#medium`, `${SONNET}#medium`])
      expect(parentToolResult(host.fixture.calls)).toContain(FAILED)
    },
    TIMEOUT,
  )

  test(
    "when every route fails at the provider, successive re-dispatches walk the routes in order",
    async () => {
      const { host } = await run({
        script: recovering({ agent: "researcher" }, failing({ [SONNET]: 401, [OPUS]: 401 }), 2),
      })

      expect(childRoutes(host.fixture.agentCalls())).toEqual([`${SONNET}#medium`, `${OPUS}#low`])
      expect(parentToolResult(host.fixture.calls)).toContain(FAILED)
    },
    TIMEOUT,
  )

  test(
    "without Sonnet 5.5 in the catalog the first dispatch goes to Opus 5.5",
    async () => {
      const { host } = await run({ script: dispatch({ agent: "researcher" }), omit: [SONNET] })

      expect(childRoutes(host.fixture.agentCalls())).toEqual([`${OPUS}#low`])
    },
    TIMEOUT,
  )

  test(
    "with no allowed route available the dispatch fails explicitly instead of using another model",
    async () => {
      const { host } = await run({ script: dispatch({ agent: "researcher" }), omit: ["cli_proxy", "cli_proxy_openai"] })

      expect(childRoutes(host.fixture.agentCalls())).toEqual([])
      expect(parentToolResult(host.fixture.calls)).toContain("no allowed route is available")
    },
    TIMEOUT,
  )
})

describe("other dispatch modes", () => {
  test(
    "a background researcher is routed by the policy, and its provider failure demotes the route for the next dispatch",
    async () => {
      let args: Record<string, unknown> = { agent: "researcher", background: true }
      host = await Host.start({ script: (call) => dispatch(args, failing({ [SONNET]: 429 }))(call) })
      const background = await host.session()
      await host.prompt(background, "delegate in the background")
      await host.until(() => host!.fixture.agentCalls("cli_proxy").length > 0)
      await host.settle(background)

      args = { agent: "researcher" }
      const next = await host.session()
      await host.prompt(next, "delegate again")
      await host.settle(next)

      expect(childRoutes(host.fixture.agentCalls())).toEqual([`${SONNET}#medium`, `${OPUS}#low`])
    },
    TIMEOUT,
  )

  test(
    "resuming a researcher with a different model switches it back to the policy route",
    async () => {
      const { host, session } = await run({
        script: (call) => {
          if (call.provider !== "fixture") return { text: "child answer" }
          const results = toolResults(call.request)
          if (results.length === 0) return { tool: "subagent", args: { agent: "researcher", description: "first", prompt: "find it" } }
          if (results.length === 1) {
            const sessionID = results[0]!.match(/sessionID=\\?"(ses_[A-Za-z0-9]+)/)![1]
            return {
              tool: "subagent",
              args: { agent: "researcher", description: "again", prompt: "dig deeper", sessionID, model: "openai/gpt-6.1-sol#high" },
            }
          }
          return { text: "parent done" }
        },
      })

      expect(childRoutes(host.fixture.agentCalls())).toEqual([`${SONNET}#medium`, `${SONNET}#medium`])
      expect(await host.children(session)).toHaveLength(1)
    },
    TIMEOUT,
  )

  test(
    "interrupting the parent cancels the researcher without trying another route",
    async () => {
      host = await Host.start({
        script: dispatch({ agent: "researcher" }, (call) => ({ text: `late answer from ${call.provider}`, delayMs: 5_000 })),
      })
      const session = await host.session()
      await host.prompt(session, "delegate")
      await host.until(() => host!.fixture.agentCalls("cli_proxy").length > 0)
      await host.interrupt(session)
      await host.settle(session, 7_000)

      expect(childRoutes(host.fixture.agentCalls())).toEqual([`${SONNET}#medium`])
    },
    TIMEOUT,
  )
})

const GLOBAL_PLUGINS = join(homedir(), ".config", "opencode", "plugins")
const HAS_GLOBAL_PLUGINS = ["model-routes.ts", "redact-secrets.ts"].every((file) => existsSync(join(GLOBAL_PLUGINS, file)))

describe.skipIf(!HAS_GLOBAL_PLUGINS)("coexistence", () => {
  test(
    "fallback still works with the global model-routes and redact-secrets plugins loaded",
    async () => {
      const { host } = await run({
        script: recovering({ agent: "researcher" }, failing({ [SONNET]: 429 })),
        extraPlugins: [join(GLOBAL_PLUGINS, "model-routes.ts"), join(GLOBAL_PLUGINS, "redact-secrets.ts")],
      })

      expect(childRoutes(host.fixture.agentCalls())).toEqual([`${SONNET}#medium`, `${OPUS}#low`])
      expect(parentToolResult(host.fixture.calls)).toContain(`child answer from ${OPUS}`)
    },
    TIMEOUT,
  )
})

describe("explore and planner dispatch", () => {
  test(
    "an explore agent runs on Sonnet 5.5 at medium effort even when the parent names another model",
    async () => {
      const { host } = await run({ script: dispatch({ agent: "explore", model: "openai/gpt-6.1-sol#high" }) })

      expect(childRoutes(host.fixture.agentCalls())).toEqual([`${SONNET}#medium`])
    },
    TIMEOUT,
  )

  test(
    "a planner runs on Opus 5.5 at high effort instead of its medium default or the parent's model",
    async () => {
      const { host } = await run({ script: dispatch({ agent: "planner", model: "cli_proxy_openai/gpt-6.1-sol#high" }) })

      expect(childRoutes(host.fixture.agentCalls())).toEqual([`${OPUS}#high`])
    },
    TIMEOUT,
  )
})

describe("implementer dispatch", () => {
  test(
    "an implementer runs on Haiku 5.5 at medium effort even when the parent names Opus 5.5 at high",
    async () => {
      const { host } = await run({ script: dispatch({ agent: "implementer", model: `${OPUS}#high` }) })

      expect(childRoutes(host.fixture.agentCalls())).toEqual([`${HAIKU}#medium`])
    },
    TIMEOUT,
  )

  test(
    "a rate-limited Haiku route fails fast, and the re-dispatch runs on Sonnet 5.5 at medium effort",
    async () => {
      const { host } = await run({ script: recovering({ agent: "implementer" }, failing({ [HAIKU]: 429 })) })

      expect(childRoutes(host.fixture.agentCalls())).toEqual([`${HAIKU}#medium`, `${SONNET}#medium`])
      expect(parentToolResult(host.fixture.calls)).toContain(`child answer from ${SONNET}`)
    },
    TIMEOUT,
  )

  test(
    "when both Claude routes are rate-limited, the re-dispatch runs on Sol 5.5 at medium effort",
    async () => {
      const { host } = await run({
        script: recovering({ agent: "implementer" }, failing({ [HAIKU]: 429, [SONNET]: 429 }), 3),
      })

      expect(childRoutes(host.fixture.agentCalls())).toEqual([`${HAIKU}#medium`, `${SONNET}#medium`, `${SOL}#medium`])
      expect(parentToolResult(host.fixture.calls)).toContain(`child answer from ${SOL}`)
    },
    TIMEOUT,
  )
})
