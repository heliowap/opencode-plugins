import { Plugin } from "@opencode/plugin/effect"
import { Effect } from "effect"

// OpenCode 2.0.24 retried a 503 ten times over 91 s before the turn failed.
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
