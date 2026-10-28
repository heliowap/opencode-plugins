export type Classification = { readonly kind: "route"; readonly skipSameRouteRetries: boolean } | { readonly kind: "task" }

// Session error types come from the provider error mapping of OpenCode 2.0.25. Content filtering
// and invalid requests depend on the prompt, so another model is not expected to fix them.
const SATURATED = new Set(["provider.rate-limit", "provider.quota"])
const UNREACHABLE = new Set([
  "provider.auth",
  "provider.no-route",
  "provider.unknown",
  "provider.internal",
  "provider.transport",
  "provider.timeout",
  "provider.unsupported-operation",
  "provider.invalid-output",
])

export const classify = (error: { readonly type: string }): Classification => {
  if (SATURATED.has(error.type)) return { kind: "route", skipSameRouteRetries: true }
  if (UNREACHABLE.has(error.type)) return { kind: "route", skipSameRouteRetries: false }
  return { kind: "task" }
}
