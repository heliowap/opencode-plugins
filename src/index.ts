import { Plugin } from "@opencode/plugin"
import { describe } from "./describe.ts"
import { inspect } from "./facts.ts"

// OpenCode has no session-start hook, so the check is split in two. The `prompt` hook is the
// deterministic half: the first prompt of a session always carries the result, so the model never
// sees that prompt without knowing how stale the base is. `session.created` is only a warm-up, so
// that in an interactive session the fetch runs while the user is still typing and the hook has
// nothing left to wait for. The check itself only fetches and reads.
const LIMIT = 64
const DONE = "done"

export default Plugin.define({
  id: "base-check",
  async setup(ctx) {
    const base = typeof ctx.options.base === "string" ? ctx.options.base : undefined
    const checks = new Map<string, Promise<string | undefined> | typeof DONE>()

    // A check that fails must never block the prompt it is attached to.
    const run = () =>
      inspect(ctx.location.directory, base)
        .then(describe)
        .catch(() => undefined)

    const warm = (sessionID: string) => {
      // A session that is created but never prompted would keep its entry forever.
      const oldest = checks.size >= LIMIT ? checks.keys().next().value : undefined
      if (oldest) checks.delete(oldest)
      checks.set(sessionID, run())
    }

    // Every location's instance receives every event, and subagents inherit their parent's base,
    // so only root sessions in this plugin's own location are checked.
    const owned = (session: { readonly parentID?: string; readonly location: { readonly directory: string } }) =>
      !session.parentID && session.location.directory === ctx.location.directory

    const controller = new AbortController()
    void (async () => {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        if (event.type !== "session.created" || !owned(event.data)) continue
        warm(event.data.sessionID)
      }
    })().catch(() => {})

    await ctx.session.hook("prompt", async (event) => {
      const existing = checks.get(event.sessionID)
      if (existing === DONE) return
      checks.set(event.sessionID, DONE)

      // No entry means the warm-up did not arrive in time, or the session predates this runtime.
      const check = existing ?? (owned(await ctx.session.get({ sessionID: event.sessionID })) ? run() : undefined)

      const report = await check
      // Appended, never prepended: attachment mentions carry offsets into this text.
      if (report) event.prompt.text = `${event.prompt.text}\n\n${report}`
    })

    return () => controller.abort()
  },
})
