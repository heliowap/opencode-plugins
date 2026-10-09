import { Plugin } from "@opencode/plugin"
import { Error as ToolError } from "@opencode/plugin/promise/tool"
import { classify, type Classification } from "./failure.ts"
import { resolve, routeKey, type CatalogModel, type Route, type Skip } from "./policy.ts"

const COOLDOWN_MS = 10 * 60 * 1000
const CHILD_SESSION = /\(sessionID: (ses_[A-Za-z0-9]+)\)/

interface SubagentInput {
  readonly agent: string
  readonly model?: string
  readonly [key: string]: unknown
}

interface Attempt {
  readonly route: string
  readonly outcome: "completed" | "running" | "provider-failure" | "failed"
  readonly error?: string
}

interface Decision {
  readonly agent: string
  readonly requested?: string
  readonly skipped: readonly Skip[]
  readonly attempts: Attempt[]
}

const selection = (route: Route) => `${route.providerID}/${route.model}#${route.variant}`

const errorType = (error: unknown) => (typeof error === "object" && error !== null && "_tag" in error ? String(error._tag) : "error")

export default Plugin.define({
  id: "model-policy",
  async setup(ctx) {
    const unhealthyUntil = new Map<string, number>()
    const childFailures = new Map<string, Classification>()

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

    let known: CatalogModel[] = []
    const refresh = async () => (known = await catalog())
    await refresh()

    await ctx.session.hook("retry", (event) => {
      const resolution = resolve(event.agent, known, unhealthy())
      if (resolution.kind === "unenforced") return
      const failed = routeKey({ providerID: event.model.providerID, model: event.model.id })
      const position = resolution.routes.findIndex((route) => routeKey(route) === failed)
      if (position < 0) return
      const classification = classify(event.error)
      if (classification.kind === "task") return
      childFailures.set(event.sessionID, classification)
      unhealthyUntil.set(failed, Date.now() + COOLDOWN_MS)
      const hasFallback = position < resolution.routes.length - 1
      if (classification.skipSameRouteRetries && hasFallback) event.decision = { retry: false }
    })

    await ctx.tool.transform((editor) => {
      editor.update("subagent", (tool) => {
        const execute = tool.execute
        tool.execute = async (raw, context) => {
          const input = raw as SubagentInput
          const resolution = resolve(input.agent, await refresh(), unhealthy())
          if (resolution.kind === "unenforced") return execute(raw, context)
          const decision: Decision = {
            agent: input.agent,
            ...(input.model === undefined ? {} : { requested: input.model }),
            skipped: resolution.skipped,
            attempts: [],
          }
          if (resolution.routes.length === 0) {
            throw new ToolError({
              message: `Model policy for ${input.agent}: no allowed route is available.`,
              metadata: { modelPolicy: decision },
            })
          }
          for (const route of resolution.routes) {
            try {
              const result = await execute({ ...input, model: selection(route) } as typeof raw, context)
              const status = (result.metadata as { status?: string } | undefined)?.status
              decision.attempts.push({ route: selection(route), outcome: status === "running" ? "running" : "completed" })
              return { ...result, metadata: { ...result.metadata, modelPolicy: decision } }
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              const child = message.match(CHILD_SESSION)?.[1]
              const failure = child ? childFailures.get(child) : undefined
              if (child) childFailures.delete(child)
              const providerFailure = failure?.kind === "route" && !context.signal.aborted
              decision.attempts.push({
                route: selection(route),
                outcome: providerFailure ? "provider-failure" : "failed",
                error: errorType(error),
              })
              if (!providerFailure) throw error
            }
          }
          throw new ToolError({
            message: `Model policy for ${input.agent}: every allowed route failed at the provider (${decision.attempts.map((attempt) => attempt.route).join(", ")}).`,
            metadata: { modelPolicy: decision },
          })
        }
      })
    })
  },
})
