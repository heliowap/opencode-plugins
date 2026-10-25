import { Plugin } from "@opencode/plugin"
import { describe } from "./describe.ts"
import { inspect } from "./facts.ts"

// OpenCode has no session-start hook, so the check is split in two. The `prompt` hook is the
// deterministic half: the first prompt of a session always carries the result, so the model never
// sees that prompt without knowing how stale the base is. `session.created` is only a warm-up, so
// that in an interactive session the fetch runs while the user is still typing and the hook has
// nothing left to wait for. The check itself only fetches and reads.
const WARM_LIMIT = 64

interface Owner {
  readonly parentID?: string
  readonly location: { readonly directory: string }
}

export default Plugin.define({
  id: "base-check",
  async setup(ctx) {
    const base = typeof ctx.options.base === "string" ? ctx.options.base : undefined
    // Warm-up results. Dropping one costs the head start, nothing else.
    const warmed = new Map<string, Promise<string | undefined>>()
    // Sessions already annotated, so later prompts are left alone. Holds session IDs only, and is
    // deliberately not evicted: dropping an entry would annotate a live session twice. A restart
    // clears it, which lets a resumed session be checked once more, by then against a base that
    // may well have moved.
    const annotated = new Set<string>()

    // A failed check must never block the prompt it is attached to.
    const check = () =>
      inspect(ctx.location.directory, base)
        .then((facts) => (facts ? describe(facts) : undefined))
        .catch(() => undefined)

    // Every location's instance receives every event, and subagents inherit their parent's base,
    // so only root sessions in this plugin's own location are checked.
    const owned = (session: Owner) => !session.parentID && session.location.directory === ctx.location.directory

    const controller = new AbortController()
    void (async () => {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        if (event.type !== "session.created" || !owned(event.data)) continue
        // A session that is created but never prompted would keep its entry forever.
        const oldest = warmed.size >= WARM_LIMIT ? warmed.keys().next().value : undefined
        if (oldest) warmed.delete(oldest)
        warmed.set(event.data.sessionID, check())
      }
    })().catch(() => {})

    await ctx.session.hook("prompt", async (event) => {
      if (annotated.has(event.sessionID)) return
      // Claimed before the first await, so two prompts admitted at once cannot both annotate.
      annotated.add(event.sessionID)

      const warm = warmed.get(event.sessionID)
      warmed.delete(event.sessionID)
      // No warm-up means the event lost the race with this prompt, as it does under `opencode run`,
      // or the session predates this plugin runtime. Ownership still has to be established.
      if (!warm && !owned(await ctx.session.get({ sessionID: event.sessionID }))) return

      const report = await (warm ?? check())
      // Appended, never prepended: attachment mentions carry offsets into this text.
      if (report) event.prompt.text = `${event.prompt.text}\n\n${report}`
    })

    return () => controller.abort()
  },
})
