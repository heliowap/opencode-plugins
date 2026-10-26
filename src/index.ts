import { Plugin } from "@opencode/plugin"
import { Error as ToolError } from "@opencode/plugin/promise/tool"
import { classify } from "./failure.ts"
import { isPolicied, resolve, routeKey, type CatalogModel, type Route, type Skip } from "./policy.ts"
import { exhaustedRoutes } from "./quota.ts"
import { quotaSettings, quotaSource } from "./quota-source.ts"

const COOLDOWN_MS = 10 * 60 * 1000

interface SubagentInput {
  readonly agent: string
  readonly model?: string
  readonly [key: string]: unknown
}

interface Decision {
  readonly agent: string
  readonly requested?: string
  readonly route: string
  readonly skipped: readonly Skip[]
  readonly demoted: readonly string[]
}

const selection = (route: Route) => `${route.providerID}/${route.model}#${route.variant}`

const isSubagentInput = (input: unknown): input is SubagentInput =>
  typeof input === "object" && input !== null && typeof (input as { agent?: unknown }).agent === "string"

export default Plugin.define({
  id: "model-policy",
  async setup(ctx) {
    const unhealthyUntil = new Map<string, number>()
    const decisions = new Map<string, Decision>()
    const quota = quotaSource(quotaSettings(process.env))
    // Routes exhausted by the last quota read. Retry and dispatch both use this set, so they agree on the route set.
    let exhausted: ReadonlySet<string> = new Set()

    const catalog = async (): Promise<CatalogModel[]> =>
      (await ctx.model.list()).data.map((model) => ({
        providerID: model.providerID,
        id: model.id,
        variants: model.variants.map((variant) => variant.id),
      }))

    const unhealthy = () => {
      const now = Date.now()
      return new Set([...unhealthyUntil].filter(([, until]) => until > now).map(([route]) => route))
    }

    let known = await catalog()

    await ctx.session.hook("retry", (event) => {
      if (!isPolicied(event.agent)) return
      const resolution = resolve(event.agent, known, { unhealthy: unhealthy(), exhausted })
      const failed = routeKey({ providerID: event.model.providerID, model: event.model.id })
      if (!resolution.routes.some((route) => routeKey(route) === failed)) return
      const classification = classify(event.error)
      if (classification.kind === "task") return
      unhealthyUntil.set(failed, Date.now() + COOLDOWN_MS)
      const hasFallback = resolution.routes.some((route) => routeKey(route) !== failed)
      if (classification.skipSameRouteRetries && hasFallback) event.decision = { retry: false }
    })

    await ctx.tool.hook("execute.before", async (event) => {
      if (event.tool !== "subagent" || !isSubagentInput(event.input)) return
      const input = event.input
      known = await catalog()
      // Unpolicied agents keep their own model, so they never wait on a quota read.
      if (!isPolicied(input.agent)) return
      exhausted = exhaustedRoutes(known, await quota.claude())
      const failing = unhealthy()
      const resolution = resolve(input.agent, known, { unhealthy: failing, exhausted })
      const route = resolution.routes[0]
      if (!route) throw new ToolError({ message: `Model policy for ${input.agent}: no allowed route is available.` })
      decisions.set(event.id, {
        agent: input.agent,
        ...(input.model === undefined ? {} : { requested: input.model }),
        route: selection(route),
        skipped: resolution.skipped,
        demoted: resolution.routes.filter((candidate) => failing.has(routeKey(candidate))).map(selection),
      })
      event.input = { ...input, model: selection(route) }
    })

    await ctx.tool.hook("execute.after", (event) => {
      if (event.tool !== "subagent") return
      const decision = decisions.get(event.id)
      decisions.delete(event.id)
      if (!decision || event.status !== "completed") return
      event.result = { ...event.result, metadata: { ...event.result.metadata, modelPolicy: decision } }
    })
  },
})
