import { Plugin } from "@opencode/plugin"
import { Error as ToolError } from "@opencode/plugin/promise/tool"
import { classify } from "./failure.ts"
import { isPolicied, QUOTA_SKIP_REASON, resolve, type Route, type Skip } from "./policy.ts"
import { exhaustedRoutes } from "./quota.ts"
import { quotaSettings, quotaSource } from "./quota-source.ts"
import { routeKey, type CatalogModel } from "./route.ts"
import { isBlockedModel, userOnlyMessage } from "./routes.ts"

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

const rejectUserOnly = (input: unknown) => {
  const message = userOnlyMessage(input)
  if (message) throw new ToolError({ message })
}

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

    await ctx.model.transform((editor) => {
      editor
        .list()
        .filter(isBlockedModel)
        .forEach((model) => editor.remove(model.providerID as never, model.id as never))
    })

    let known = await catalog()

    await ctx.session.hook("retry", (event) => {
      if (!isPolicied(event.agent)) return
      const resolution = resolve(event.agent, known, { unhealthy: unhealthy(), exhausted })
      const failed = routeKey({ providerID: event.model.providerID, model: event.model.id })
      // A child started before the last quota read may run on a route that read has since skipped.
      const skippedForQuota = resolution.skipped.some((skip) => skip.route === failed && skip.reason === QUOTA_SKIP_REASON)
      if (!skippedForQuota && !resolution.routes.some((route) => routeKey(route) === failed)) return
      const classification = classify(event.error)
      if (classification.kind === "task") return
      unhealthyUntil.set(failed, Date.now() + COOLDOWN_MS)
      const nonExhausted = resolution.routes.filter((route) => !exhausted.has(routeKey(route)))
      const hasFallback = nonExhausted.some((route) => routeKey(route) !== failed)
      if (classification.skipSameRouteRetries && hasFallback) event.decision = { retry: false }
    })

    await ctx.tool.hook("execute.before", async (event) => {
      if (event.tool !== "subagent") return
      const input = event.input
      if (!isSubagentInput(input)) return rejectUserOnly(input)
      known = await catalog()
      // Unpolicied agents keep their own model, so they never wait on a quota read.
      if (!isPolicied(input.agent)) return rejectUserOnly(input)
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
