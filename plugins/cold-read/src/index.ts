import { Plugin } from "@opencode/plugin"
import { Error as ToolError } from "@opencode/plugin/promise/tool"
import { review } from "./brief.ts"

// The checklist reaches the model only through the rejection message: a tool.transform on the
// question tool stops the TUI from drawing the question form (reproduced on OpenCode 2.2.7).
export default Plugin.define({
  id: "cold-read",
  async setup(ctx) {
    const seen = new Set<string>()

    await ctx.tool.hook("execute.before", (event) => {
      if (event.tool !== "question") return
      const verdict = review(event.sessionID, event.input, seen)
      if (!verdict.ok) throw new ToolError({ message: verdict.message })
    })
  },
})
