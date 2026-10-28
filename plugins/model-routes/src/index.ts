import { Plugin } from "@opencode/plugin"
import { Error as ToolError } from "@opencode/plugin/promise/tool"

// OpenAI and Anthropic models are usable only through OAuth, CLI Proxy, the OpenCode Go plan
// or the Anthropic API models listed in ALLOWED_MODELS.
const ALLOWED_PROVIDERS = new Set(["openai", "cli_proxy", "cli_proxy_openai", "opencode-go"])
const ALLOWED_MODELS = new Set(["anthropic/claude-sonnet-5-5", "anthropic/claude-haiku-5-5"])
const VENDOR_ID = /^~?(openai|anthropic)\//
const VENDOR_FAMILY = /^(gpt|claude)/
// Anthropic API models are selected by the user in /models, never by an agent dispatching a subagent.
const USER_ONLY_PREFIX = "anthropic/"

const requestedModel = (input: unknown) => {
  const model = typeof input === "object" && input !== null ? (input as { model?: unknown }).model : undefined
  return typeof model === "string" ? model : undefined
}

export default Plugin.define({
  id: "model-routes",
  async setup(ctx) {
    await ctx.model.transform((editor) => {
      editor
        .list()
        .filter(
          (model) =>
            !ALLOWED_PROVIDERS.has(String(model.providerID)) &&
            !ALLOWED_MODELS.has(`${model.providerID}/${model.id}`) &&
            (VENDOR_ID.test(String(model.id)) || VENDOR_FAMILY.test(String(model.family ?? ""))),
        )
        .forEach((model) => editor.remove(model.providerID as never, model.id as never))
    })

    await ctx.tool.hook("execute.before", (event) => {
      if (event.tool !== "subagent") return
      const model = requestedModel(event.input)
      if (!model?.trim().toLowerCase().startsWith(USER_ONLY_PREFIX)) return
      throw new ToolError({
        message: `${model} is user-only: only the user selects Anthropic API models in /models. Dispatch the subagent without this model.`,
      })
    })
  },
})
