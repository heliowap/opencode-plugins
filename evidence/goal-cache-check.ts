import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Host } from "../plugins/goal/host/harness/host.ts"
import { parseModel, userProviders } from "../plugins/goal/host/live/providers.ts"
import { activeStepIds } from "./goal-cache-steps.ts"

const model = "cli_proxy/cpa-claude-haiku-5-5"
const files = [
  "start.txt", "q4m.txt", "n9p.txt", "f2w.txt", "a8k.txt", "r1v.txt",
  "z6c.txt", "b5x.txt", "d3h.txt", "t7s.txt", "j2l.txt", "u8g.txt",
]
const host = await Host.start({
  model: parseModel(model),
  providers: await userProviders(["cli_proxy"]),
  allowAll: true,
})
let timer: ReturnType<typeof setTimeout> | undefined
try {
  await Promise.all(
    files.map((name, index) => writeFile(join(host.project, name), files[index + 1] ?? "END")),
  )
  const session = await host.session()
  const events = host.events((type) => type === "rpc.goal.changed" || type === "session.step.started")
  await Bun.sleep(500)
  await host.goal(
    session,
    "Follow the chain starting at start.txt. Each file contains the next filename or END. " +
      "Use one read tool call per file and wait for its result before reading the next file. " +
      "Do not use shell commands or loops. Once you read END, call goal_update with complete and the evidence.",
  )
  await Promise.race([
    host.settleLive(session, 2_000, 150_000),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("live test exceeded 150 seconds")), 150_000)
    }),
  ])
  const messages = await host.messages(session)
  const activeIds = activeStepIds(events.seen, session.id)
  events.stop()
  const continuation = (message: (typeof messages)[number]) =>
    message.type === "synthetic" && String(message.text).startsWith("Continue working toward the active session goal.")
  const start = messages.findIndex(continuation)
  if (start < 0) throw new Error("no goal continuation")
  const next = messages.findIndex((message, index) => index > start && continuation(message))
  const steps = messages.slice(start, next < 0 ? undefined : next)
    .filter((message) => message.type === "assistant" && message.tokens && activeIds.has(String(message.id)))
    .map((message) => message.tokens as { input: number; cache: { read: number; write: number } })
  const window = messages.slice(start)
    .filter((message) => message.type === "assistant" && message.tokens)
    .map((message) => message.tokens as { input: number; cache: { read: number; write: number } })
  const total = window.reduce((sum, tokens) => sum + tokens.input + tokens.cache.read + tokens.cache.write, 0)
  const reads = window.reduce((sum, tokens) => sum + tokens.cache.read, 0)
  console.log(JSON.stringify({
    model,
    status: host.stored(session)?.status,
    firstTurn: steps.map((tokens) => ({ input: tokens.input, read: tokens.cache.read, write: tokens.cache.write })),
    observedActiveSteps: activeIds.size,
    windowSteps: window.length,
    cacheRead: reads,
    totalInput: total,
    hitRatio: total > 0 ? reads / total : null,
  }, null, 2))
  if (steps.length < 3) throw new Error("fewer than three steps in the first goal turn")
  if (!steps.slice(1).every((step, index) => step.cache.read > steps[index]!.cache.read))
    throw new Error("cache reads did not grow on every step")
  if (total === 0 || reads / total < 0.9) throw new Error("goal window cache hit ratio was below 0.9")
} finally {
  if (timer !== undefined) clearTimeout(timer)
  await host.stop()
}
