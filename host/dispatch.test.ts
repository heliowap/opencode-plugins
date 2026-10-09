import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { FAILED, redispatching, toolResults, type Call, type Reply } from "./harness/fixture.ts"
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

const childRoutes = (calls: Call[]) =>
  calls
    .filter((call) => call.provider !== "fixture")
    .map(
      (call) =>
        `${call.provider}/${call.request.model}#${call.request.reasoning_effort ?? ""}${call.request.service_tier === "priority" ? "+fast" : ""}`,
    )

const failing =
  (providers: Record<string, number>): ((call: Call) => Reply) =>
  (call) => {
    const status = providers[call.provider]
    return status ? { status, error: `fixture ${status} from ${call.provider}` } : { text: `child answer from ${call.provider}` }
  }

type ToolPart = { type: "tool"; name: string; state: { status: string; metadata: Record<string, unknown> } }

const toolParts = async (host: Host, session: { id: string }) =>
  (await host.messages(session))
    .flatMap((message) => (Array.isArray(message.content) ? (message.content as ToolPart[]) : []))
    .filter((part) => part.type === "tool" && part.name === "subagent")

const parentToolResult = (calls: Call[]) => toolResults(calls.filter((call) => call.provider === "fixture").at(-1)!.request).at(-1)

describe("research dispatch", () => {
  test(
    "a researcher runs on direct OpenAI at low effort even when the parent names another model",
    async () => {
      const { host } = await run({
        script: dispatch({ agent: "researcher", model: "cli_proxy/cpa-claude-opus-5-5#high" }),
      })

      expect(childRoutes(host.fixture.agentCalls())).toEqual(["openai/gpt-6.1-sol#low"])
      expect(parentToolResult(host.fixture.calls)).toContain("child answer")
    },
    TIMEOUT,
  )

  test(
    "a rate-limited direct route fails fast, and the re-dispatch runs on proxied Sol in fast mode",
    async () => {
      const { host, session } = await run({ script: recovering({ agent: "researcher" }, failing({ openai: 429 })) })

      expect(childRoutes(host.fixture.agentCalls())).toEqual(["openai/gpt-6.1-sol#low", "cli_proxy_openai/gpt-6.1-sol#low+fast"])
      expect(parentToolResult(host.fixture.calls)).toContain("child answer from cli_proxy_openai")
      const [failed, recovered] = await toolParts(host, session)
      expect(failed!.state.status).toBe("error")
      const trail = recovered!.state.metadata.modelPolicy
      expect(trail).toEqual({
        agent: "researcher",
        route: "cli_proxy_openai/gpt-6.1-sol#fast-low",
        skipped: [],
        demoted: ["openai/gpt-6.1-sol#low"],
      })
      expect(JSON.stringify(trail)).not.toContain("find the fact")
    },
    TIMEOUT,
  )

  test(
    "a request the provider rejects as invalid is a task failure: the route stays first for the re-dispatch",
    async () => {
      const { host } = await run({ script: recovering({ agent: "researcher" }, failing({ openai: 400 }), 2) })

      expect(childRoutes(host.fixture.agentCalls())).toEqual(["openai/gpt-6.1-sol#low", "openai/gpt-6.1-sol#low"])
      expect(parentToolResult(host.fixture.calls)).toContain(FAILED)
    },
    TIMEOUT,
  )

  test(
    "when every route fails at the provider, successive re-dispatches walk the routes in order",
    async () => {
      const { host } = await run({
        script: recovering({ agent: "researcher" }, failing({ openai: 401, cli_proxy_openai: 401, cli_proxy: 401 })),
      })

      expect(childRoutes(host.fixture.agentCalls())).toEqual([
        "openai/gpt-6.1-sol#low",
        "cli_proxy_openai/gpt-6.1-sol#low+fast",
        "cli_proxy/cpa-claude-opus-5-5#low",
      ])
      expect(parentToolResult(host.fixture.calls)).toContain(FAILED)
    },
    TIMEOUT,
  )

  test(
    "without direct OpenAI access the first dispatch goes to proxied Sol in fast mode",
    async () => {
      const { host } = await run({ script: dispatch({ agent: "researcher" }), omit: ["openai"] })

      expect(childRoutes(host.fixture.agentCalls())).toEqual(["cli_proxy_openai/gpt-6.1-sol#low+fast"])
    },
    TIMEOUT,
  )

  test(
    "with no allowed route available the dispatch fails explicitly instead of using another model",
    async () => {
      const { host } = await run({ script: dispatch({ agent: "researcher" }), omit: ["openai", "cli_proxy_openai", "cli_proxy"] })

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
      host = await Host.start({ script: (call) => dispatch(args, failing({ openai: 429 }))(call) })
      const background = await host.session()
      await host.prompt(background, "delegate in the background")
      await host.until(() => host!.fixture.agentCalls("openai").length > 0)
      await host.settle(background)

      args = { agent: "researcher" }
      const next = await host.session()
      await host.prompt(next, "delegate again")
      await host.settle(next)

      expect(childRoutes(host.fixture.agentCalls())).toEqual(["openai/gpt-6.1-sol#low", "cli_proxy_openai/gpt-6.1-sol#low+fast"])
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
              args: { agent: "researcher", description: "again", prompt: "dig deeper", sessionID, model: "cli_proxy/cpa-claude-opus-5-5#high" },
            }
          }
          return { text: "parent done" }
        },
      })

      expect(childRoutes(host.fixture.agentCalls())).toEqual(["openai/gpt-6.1-sol#low", "openai/gpt-6.1-sol#low"])
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
      await host.until(() => host!.fixture.agentCalls("openai").length > 0)
      await host.interrupt(session)
      await host.settle(session, 7_000)

      expect(childRoutes(host.fixture.agentCalls())).toEqual(["openai/gpt-6.1-sol#low"])
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
        script: recovering({ agent: "researcher" }, failing({ openai: 429 })),
        extraPlugins: [join(GLOBAL_PLUGINS, "model-routes.ts"), join(GLOBAL_PLUGINS, "redact-secrets.ts")],
      })

      expect(childRoutes(host.fixture.agentCalls())).toEqual(["openai/gpt-6.1-sol#low", "cli_proxy_openai/gpt-6.1-sol#low+fast"])
      expect(parentToolResult(host.fixture.calls)).toContain("child answer from cli_proxy_openai")
    },
    TIMEOUT,
  )
})

describe("explore and planner dispatch", () => {
  test(
    "an explore agent runs on direct OpenAI at low effort even when the parent names another model",
    async () => {
      const { host } = await run({ script: dispatch({ agent: "explore", model: "cli_proxy/cpa-claude-opus-5-5#high" }) })

      expect(childRoutes(host.fixture.agentCalls())).toEqual(["openai/gpt-6.1-sol#low"])
    },
    TIMEOUT,
  )

  test(
    "a planner runs on Opus 5.5 at high effort instead of its medium default or the parent's model",
    async () => {
      const { host } = await run({ script: dispatch({ agent: "planner", model: "cli_proxy_openai/gpt-6.1-sol#high" }) })

      expect(childRoutes(host.fixture.agentCalls())).toEqual(["cli_proxy/cpa-claude-opus-5-5#high"])
    },
    TIMEOUT,
  )
})

describe("roles without an approved policy", () => {
  test(
    "an implementer keeps the model the parent chose",
    async () => {
      const { host } = await run({ script: dispatch({ agent: "implementer", model: "cli_proxy/cpa-claude-opus-5-5#high" }) })

      expect(childRoutes(host.fixture.agentCalls())).toEqual(["cli_proxy/cpa-claude-opus-5-5#high"])
    },
    TIMEOUT,
  )
})
