import { Plugin } from "@opencode/plugin"

// OpenAI and Anthropic models are usable only through OAuth, CLI Proxy, the OpenCode Go plan
// or the Anthropic API models listed in ALLOWED_MODELS.
const ALLOWED_PROVIDERS = new Set(["openai", "cli_proxy", "cli_proxy_openai", "opencode-go"])
const ALLOWED_MODELS = new Set(["anthropic/claude-sonnet-5-5", "anthropic/claude-haiku-5-5"])
const VENDOR_ID = /^~?(openai|anthropic)\//
const VENDOR_FAMILY = /^(gpt|claude)/

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
  },
})
