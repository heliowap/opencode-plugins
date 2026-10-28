import { Plugin } from "@opencode/plugin"

export default Plugin.define({
  id: "model-policy",
  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      editor.update("subagent", (tool) => {
        const execute = tool.execute
        tool.execute = (input, context) => execute(input, context)
      })
    })
  },
})
