// Leaf module: the catalog shape and the route identity that policy and quota both use. It imports nothing,
// so neither of them depends on the other at load time.
export interface CatalogModel {
  readonly providerID: string
  readonly id: string
  readonly variants: readonly string[]
}

export const routeKey = (route: { readonly providerID: string; readonly model: string }) =>
  `${route.providerID}/${route.model}`
