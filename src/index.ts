import { Plugin } from "@opencode/plugin"

// OpenAI and Anthropic models are usable only through OAuth, CLI Proxy or the OpenCode Go plan.
const ALLOWED_PROVIDERS = new Set(["openai", "cli_proxy", "cli_proxy_openai", "opencode-go"])
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
            (VENDOR_ID.test(String(model.id)) || VENDOR_FAMILY.test(String(model.family ?? ""))),
        )
        .forEach((model) => editor.remove(model.providerID as never, model.id as never))
    })
  },
})
