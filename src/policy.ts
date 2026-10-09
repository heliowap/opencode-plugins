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

export type Resolution =
  | { readonly kind: "unenforced" }
  | { readonly kind: "routes"; readonly routes: readonly Route[]; readonly skipped: readonly Skip[] }

interface Candidate {
  readonly providerID: string
  readonly model: string
  readonly effort: string
  readonly preferFast: boolean
}

// Research row of the Subagents section in ~/.config/opencode/AGENTS.md, with the direct
// ChatGPT route the user approved ahead of CLIProxy. Explore and planner rules were approved
// directly by the user.
const RESEARCH: readonly Candidate[] = [
  { providerID: "openai", model: "gpt-6.1-sol", effort: "low", preferFast: true },
  { providerID: "cli_proxy_openai", model: "gpt-6.1-sol", effort: "low", preferFast: true },
  { providerID: "cli_proxy", model: "cpa-claude-opus-5-5", effort: "low", preferFast: true },
]

const POLICIES: Readonly<Record<string, readonly Candidate[]>> = {
  researcher: RESEARCH,
  explore: RESEARCH,
  planner: [{ providerID: "cli_proxy", model: "cpa-claude-opus-5-5", effort: "high", preferFast: false }],
}

const variantFor = (candidate: Candidate, entry: CatalogModel) =>
  [...(candidate.preferFast ? [`fast-${candidate.effort}`] : []), candidate.effort].find((variant) =>
    entry.variants.includes(variant),
  )

export const routeKey = (route: { readonly providerID: string; readonly model: string }) =>
  `${route.providerID}/${route.model}`

export const resolve = (
  agent: string,
  catalog: readonly CatalogModel[],
  unhealthy: ReadonlySet<string> = new Set(),
): Resolution => {
  const policy = Object.hasOwn(POLICIES, agent) ? POLICIES[agent] : undefined
  if (!policy) return { kind: "unenforced" }
  const routes: Route[] = []
  const skipped: Skip[] = []
  for (const candidate of policy) {
    const route = routeKey(candidate)
    const entry = catalog.find((model) => model.providerID === candidate.providerID && model.id === candidate.model)
    if (!entry) {
      skipped.push({ route, reason: "not in the available model catalog" })
      continue
    }
    const variant = variantFor(candidate, entry)
    if (!variant) {
      skipped.push({ route, reason: `variant ${candidate.effort} is not available` })
      continue
    }
    routes.push({ providerID: candidate.providerID, model: candidate.model, variant })
  }
  const healthy = routes.filter((route) => !unhealthy.has(routeKey(route)))
  const failing = routes.filter((route) => unhealthy.has(routeKey(route)))
  return { kind: "routes", routes: [...healthy, ...failing], skipped }
}
