import { FLOOR_PERCENT } from "./quota.ts"

export interface CatalogModel {
  readonly providerID: string
  readonly id: string
  readonly variants: readonly string[]
}

export interface Route {
  readonly providerID: string
  readonly model: string
  readonly variant: string
}

export interface Skip {
  readonly route: string
  readonly reason: string
}

export interface Resolution {
  readonly routes: readonly Route[]
  readonly skipped: readonly Skip[]
}

export interface ResolveOptions {
  readonly unhealthy?: ReadonlySet<string>
  readonly exhausted?: ReadonlySet<string>
}

interface Candidate {
  readonly providerID: string
  readonly model: string
  readonly effort: string
}

// The OpenAI route is the final fallback: it is not on the Claude account pool, so quota skips have somewhere to go.
const SOL = { providerID: "cli_proxy_openai", model: "gpt-6.1-sol" }

const RESEARCH: readonly Candidate[] = [
  { providerID: "cli_proxy", model: "cpa-claude-sonnet-5-5", effort: "medium" },
  { providerID: "cli_proxy", model: "cpa-claude-opus-5-5", effort: "low" },
  { ...SOL, effort: "medium" },
]

// Research, explore, planner and implementer rules were approved directly by the user.
const POLICIES: Readonly<Record<string, readonly Candidate[]>> = {
  researcher: RESEARCH,
  explore: RESEARCH,
  planner: [
    { providerID: "cli_proxy", model: "cpa-claude-opus-5-5", effort: "high" },
    { ...SOL, effort: "high" },
  ],
  implementer: [
    { providerID: "cli_proxy", model: "cpa-claude-haiku-5-5", effort: "medium" },
    { providerID: "cli_proxy", model: "cpa-claude-sonnet-5-5", effort: "medium" },
    { ...SOL, effort: "medium" },
  ],
}

export const isPolicied = (agent: string) => Object.hasOwn(POLICIES, agent)

export const routeKey = (route: { readonly providerID: string; readonly model: string }) =>
  `${route.providerID}/${route.model}`

// An agent without a policy has no routes: callers check isPolicied first and leave its model alone.
export const resolve = (
  agent: string,
  catalog: readonly CatalogModel[],
  { unhealthy = new Set(), exhausted = new Set() }: ResolveOptions = {},
): Resolution => {
  const policy = isPolicied(agent) ? POLICIES[agent] : undefined
  if (!policy) return { routes: [], skipped: [] }
  const routes: Route[] = []
  const skipped: Skip[] = []
  for (const candidate of policy) {
    const route = routeKey(candidate)
    const entry = catalog.find((model) => model.providerID === candidate.providerID && model.id === candidate.model)
    if (!entry) {
      skipped.push({ route, reason: "not in the available model catalog" })
      continue
    }
    if (!entry.variants.includes(candidate.effort)) {
      skipped.push({ route, reason: `variant ${candidate.effort} is not available` })
      continue
    }
    routes.push({ providerID: candidate.providerID, model: candidate.model, variant: candidate.effort })
  }
  const available = routes.filter((route) => !exhausted.has(routeKey(route)))
  // When every route is exhausted, keep them all: failing open beats having no route at all.
  const usable = available.length > 0 ? available : routes
  if (available.length > 0) {
    for (const route of routes) {
      if (exhausted.has(routeKey(route))) skipped.push({ route: routeKey(route), reason: `account quota below ${FLOOR_PERCENT}%` })
    }
  }
  const healthy = usable.filter((route) => !unhealthy.has(routeKey(route)))
  const failing = usable.filter((route) => unhealthy.has(routeKey(route)))
  return { routes: [...healthy, ...failing], skipped }
}
