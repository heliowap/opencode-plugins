import { afterEach, describe, expect, test } from "bun:test"
import { OPUS, redispatching, routeOf, SONNET, text, toolResults, type Call, type Reply } from "./harness/fixture.ts"
import { Host } from "./harness/host.ts"

let host: Host | undefined

afterEach(async () => {
  await host?.stop()
  host = undefined
})

const caseOf = (call: Call) => {
  for (const message of call.request.messages) {
    const found = message.role === "user" ? text(message).match(/case-(\d+)/) : null
    if (found) return Number(found[1])
  }
  return -1
}

const burst = (count: number, extra: Record<string, unknown> = {}): Reply => ({
  tools: Array.from({ length: count }, (_, index) => ({
    tool: "subagent",
    args: { agent: "researcher", description: `case ${index}`, prompt: `case-${index}`, ...extra },
  })),
})

const parent =
  (first: Reply, child: (call: Call) => Reply) =>
  (call: Call): Reply => {
    if (call.provider !== "fixture") return child(call)
    return toolResults(call.request).length === 0 ? first : { text: "parent done" }
  }

const answer = (call: Call): Reply => ({ text: `answer ${caseOf(call)} from ${routeOf(call)}` })

const callsByCase = (host: Host) => {
  const byCase = new Map<number, string[]>()
  for (const call of host.fixture.agentCalls().filter((call) => call.provider !== "fixture")) {
    byCase.set(caseOf(call), [...(byCase.get(caseOf(call)) ?? []), routeOf(call)])
  }
  return byCase
}

const sonnetCalls = (host: Host) => host.fixture.agentCalls().filter((call) => routeOf(call) === SONNET)

const researchers = (count: number, extra: Record<string, unknown> = {}) =>
  Array.from({ length: count }, (_, index) => ({ agent: "researcher", description: `case ${index}`, prompt: `case-${index}`, ...extra }))

const recoveringBurst = (count: number, child: (call: Call) => Reply, maxRounds = 3) => (call: Call): Reply =>
  call.provider === "fixture" ? redispatching(researchers(count), maxRounds)(call.request) : child(call)

const runScript = async (script: (call: Call) => Reply, settleMs = 2_000) => {
  host = await Host.start({ script })
  const session = await host.session()
  const started = Date.now()
  await host.prompt(session, "delegate many")
  await host.settle(session, settleMs, 240_000)
  return { host, session, elapsed: Date.now() - started }
}

const allResults = (host: Host) => toolResults(host.fixture.calls.filter((call) => call.provider === "fixture").at(-1)!.request)

describe("parallel bursts", () => {
  test(
    "eight rate-limited researchers fail fast, and their re-dispatch completes on Opus 5.5, never on Sol",
    async () => {
      const { host, elapsed } = await runScript(
        recoveringBurst(8, (call) => (routeOf(call) === SONNET ? { status: 429, error: "rate limited" } : answer(call))),
      )

      const results = allResults(host)
      for (let index = 0; index < 8; index++) {
        expect(results.some((result) => result.includes(`answer ${index} from ${OPUS}`))).toBe(true)
      }
      const routes = [...callsByCase(host).values()].flat()
      expect(routes.filter((route) => route.endsWith("/gpt-6.1-sol"))).toHaveLength(0)
      expect(routes.filter((route) => route === SONNET)).toHaveLength(8)
      console.log(`burst of 8 with fallback: ${elapsed} ms`)
    },
    300_000,
  )

  test(
    "parallel children failing differently on the same route each report their own error",
    async () => {
      const { host } = await runScript(
        recoveringBurst(8, (call) => {
          if (caseOf(call) % 2 === 1) return { status: 400, error: `invalid request ${caseOf(call)}` }
          return routeOf(call) === SONNET ? { status: 429, error: `rate limited ${caseOf(call)}` } : answer(call)
        }, 2),
      )

      const results = allResults(host)
      for (let index = 0; index < 8; index++) {
        if (index % 2 === 1) {
          expect(callsByCase(host).get(index)![0]).toBe(SONNET)
          expect(results.some((result) => result.includes(`invalid request ${index}`))).toBe(true)
        } else {
          expect(results.some((result) => result.includes(`rate limited ${index}`))).toBe(true)
          expect(results.some((result) => result.includes(`answer ${index} from ${OPUS}`))).toBe(true)
        }
      }
    },
    300_000,
  )

  test(
    "a burst where every route rejects auth walks each child through every route exactly once",
    async () => {
      const { host } = await runScript(recoveringBurst(4, () => ({ status: 401, error: "bad credentials" }), 2))

      for (const routes of callsByCase(host).values()) {
        expect([...routes].sort()).toEqual([OPUS, SONNET])
      }
    },
    300_000,
  )
})

describe("unusual provider failures", () => {
  test(
    "a malformed stream on the Sonnet route demotes it for the re-dispatch",
    async () => {
      const { host, elapsed } = await runScript(recoveringBurst(1, (call) => (routeOf(call) === SONNET ? { malformed: true } : answer(call))))

      expect(allResults(host).at(-1)).toContain(`answer 0 from ${OPUS}`)
      console.log(`malformed stream fallback: ${elapsed} ms, Sonnet attempts ${sonnetCalls(host).length}`)
    },
    300_000,
  )

  test(
    "a 503 on the Sonnet route demotes it after OpenCode's own retries",
    async () => {
      const { host, elapsed } = await runScript(
        recoveringBurst(1, (call) => (routeOf(call) === SONNET ? { status: 503, error: "overloaded" } : answer(call))),
      )

      expect(allResults(host).at(-1)).toContain(`answer 0 from ${OPUS}`)
      console.log(`503 fallback: ${elapsed} ms, Sonnet attempts ${sonnetCalls(host).length}`)
    },
    300_000,
  )
})

describe("background bursts", () => {
  test(
    "six failing background researchers demote the route, and the next foreground dispatches start on Opus 5.5",
    async () => {
      let first: Reply = burst(6, { background: true })
      host = await Host.start({
        script: (call) => parent(first, (child) => (routeOf(child) === SONNET ? { status: 429, error: "rate limited" } : answer(child)))(call),
      })
      const background = await host.session()
      await host.prompt(background, "delegate in the background")
      await host.until(() => sonnetCalls(host!).length >= 6)
      await host.settle(background, 3_000, 120_000)
      const sonnetBefore = sonnetCalls(host).length

      first = burst(3)
      const next = await host.session()
      await host.prompt(next, "delegate again")
      await host.settle(next)

      expect(sonnetCalls(host)).toHaveLength(sonnetBefore)
      const results = allResults(host)
      for (let index = 0; index < 3; index++) {
        expect(results.some((result) => result.includes(`answer ${index} from ${OPUS}`))).toBe(true)
      }
    },
    300_000,
  )
})
