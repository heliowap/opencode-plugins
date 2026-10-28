// OpenAI and Anthropic models are usable only through OAuth, CLI Proxy, the OpenCode Go plan
// or the Anthropic API models listed in ALLOWED_MODELS.
const ALLOWED_PROVIDERS = new Set(["openai", "cli_proxy", "cli_proxy_openai", "opencode-go"])
const ALLOWED_MODELS = new Set(["anthropic/claude-sonnet-5-5", "anthropic/claude-haiku-5-5"])
const VENDOR_ID = /^~?(openai|anthropic)\//
const VENDOR_FAMILY = /^(gpt|claude)/
// Anthropic API models are selected by the user in /models, never by an agent dispatching a subagent.
const USER_ONLY_PREFIX = "anthropic/"

export interface ListedModel {
  readonly providerID: unknown
  readonly id: unknown
  readonly family?: unknown
}

export const isBlockedModel = (model: ListedModel) =>
  !ALLOWED_PROVIDERS.has(String(model.providerID)) &&
  !ALLOWED_MODELS.has(`${model.providerID}/${model.id}`) &&
  (VENDOR_ID.test(String(model.id)) || VENDOR_FAMILY.test(String(model.family ?? "")))

const requestedModel = (input: unknown) => {
  const model = typeof input === "object" && input !== null ? (input as { model?: unknown }).model : undefined
  return typeof model === "string" ? model : undefined
}

export const userOnlyMessage = (input: unknown) => {
  const model = requestedModel(input)
  if (!model?.trim().toLowerCase().startsWith(USER_ONLY_PREFIX)) return undefined
  return `${model} is user-only: only the user selects Anthropic API models in /models. Dispatch the subagent without this model.`
}
