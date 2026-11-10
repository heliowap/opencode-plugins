import { Plugin } from "@opencode/plugin"
import { Error as ToolError } from "@opencode/plugin/promise/tool"
import { BRIEF, review } from "./brief.ts"

export default Plugin.define({
  id: "cold-read",
  async setup(ctx) {
    const seen = new Set<string>()

    await ctx.tool.transform((editor) => {
      editor.update("question", (tool) => {
        tool.description = `${tool.description}\n\n${BRIEF}`
      })
    })

    await ctx.tool.hook("execute.before", (event) => {
      if (event.tool !== "question") return
      const verdict = review(event.sessionID, event.input, seen)
      if (!verdict.ok) throw new ToolError({ message: verdict.message })
    })
  },
})
