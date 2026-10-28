import { afterEach, describe, expect, test } from "bun:test"
import { copyFile, mkdtemp, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
  childRoutes,
  dispatch,
  FAILED,
  HAIKU,
  OPUS,
  redispatching,
  routeOf,
  run,
  SOL,
  SONNET,
  stopRuns,
  toolParts,
  toolResults,
  type Call,
  type Reply,
} from "./harness/fixture.ts"
import { Host } from "./harness/host.ts"

const TIMEOUT = 120_000
let host: Host | undefined

afterEach(async () => {
  await host?.stop()
  host = undefined
  await stopRuns()
})

const recovering =
  (args: Record<string, unknown>, child: (call: Call) => Reply, maxRounds = 3) =>
  (call: Call): Reply =>
    call.provider === "fixture"
      ? redispatching([{ description: "look it up", prompt: "find the fact", ...args }], maxRounds)(call.request)
      : child(call)

const failing =
  (routes: Record<string, number>): ((call: Call) => Reply) =>
  (call) => {
    const route = routeOf(call)
    const status = routes[route]
    return status ? { status, error: `fixture ${status} from ${route}` } : { text: `child answer from ${route}` }
  }

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

const REDACT_SECRETS = resolve(import.meta.dir, "../../redact-secrets/src/index.ts")

describe("coexistence", () => {
  test(
    "fallback still works with the redact-secrets plugin loaded after model-policy",
    async () => {
      // A copy next to a node_modules link, so the sibling plugin resolves this package's dependencies without its own install.
      const scratch = await mkdtemp(join(tmpdir(), "redact-secrets-"))
      try {
        const redact = join(scratch, "redact-secrets.ts")
        await copyFile(REDACT_SECRETS, redact)
        await symlink(resolve(import.meta.dir, "../node_modules"), join(scratch, "node_modules"))
        const { host } = await run({
          script: recovering({ agent: "researcher" }, failing({ [SONNET]: 429 })),
          extraPlugins: [redact],
        })

        expect(childRoutes(host.fixture.agentCalls())).toEqual([`${SONNET}#medium`, `${OPUS}#low`])
        expect(parentToolResult(host.fixture.calls)).toContain(`child answer from ${OPUS}`)
      } finally {
        await rm(scratch, { recursive: true, force: true })
      }
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
    "when both Claude routes are rate-limited, the re-dispatch runs on GPT-6.1 Sol at medium effort",
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
