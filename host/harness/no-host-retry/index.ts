import { Plugin } from "@opencode/plugin/effect"
import { Effect } from "effect"

// OpenCode retries a failed provider request about ten times over 90 s before the turn fails.
// Canaries load this plugin so a scripted server error fails the turn at once.
export default Plugin.define({
  id: "no-host-retry",
  effect: (ctx) =>
    ctx.session.hook("retry", (event) =>
      Effect.sync(() => {
        event.decision = { retry: false }
      }),
    ),
})
