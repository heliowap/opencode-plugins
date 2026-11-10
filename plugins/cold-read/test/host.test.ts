import { afterAll, beforeAll, expect, test } from "bun:test"
import { join } from "node:path"
import { text, type Call, type ChatMessage, type Reply } from "./harness/fixture.ts"
import { Host } from "./harness/host.ts"

const SHORT = "Remove the gate?"
const LONG =
  "The CI capacity gate is a job that picks a self-hosted runner and checks a grant before any other job starts. Removing it makes CI run on GitHub-hosted runners with no grant check. Remove it?"
const REJECTED = "is not a cold read"

// The form list endpoint returns either a bare array or a `data` page, as in protect-agents-md's host tests.
type Form = { readonly id: string; readonly state?: { readonly status?: string } }

let host: Host
let plan: string[] = []

const ask = (question: string) => ({
  tool: "question",
  args: { questions: [{ header: "Gate", question, options: [{ label: "Yes", description: "remove" }, { label: "No", description: "keep" }] }] },
})

const step = (messages: readonly ChatMessage[]) => {
  const lastUser = messages.findLastIndex((m) => m.role === "user")
  return messages.slice(lastUser).filter((m) => m.role === "assistant" && m.tool_calls?.length).length
}

beforeAll(async () => {
  host = await Host.start({
    script: (call: Call): Reply => {
      const next = plan[step(call.request.messages)]
      return next === undefined ? { text: "done" } : ask(next)
    },
    extraPlugins: [join(import.meta.dir, "../src/index.ts")],
  })
})

afterAll(async () => {
  await host.stop()
})

const run = async (questions: string[]) => {
  plan = questions
  const firstCall = host.fixture.calls.length
  const session = await host.session()
  await host.prompt(session, "go")
  let forms = 0
  const deadline = Date.now() + 20_000
  for (;;) {
    if (Date.now() > deadline) throw new Error(`session ${session.id} did not go idle within 20 s`)
    const pending = (await host.json("GET", `/api/session/${session.id}/form`)) as Form[] | { data?: Form[] }
    const list = Array.isArray(pending) ? pending : (pending.data ?? [])
    const open = list.filter((form) => !form.state || form.state.status === "pending")
    for (const form of open) {
      forms++
      await host.json("POST", `/api/session/${session.id}/form/${form.id}/reply`, { answer: { q0: "Yes" } })
    }
    const messages = await host.messages(session)
    if (messages.at(-1)?.type === "idle" && open.length === 0) break
    await Bun.sleep(200)
  }
  const calls = host.fixture.agentCalls("fixture").filter((call) => host.fixture.calls.indexOf(call) >= firstCall)
  const results = calls.flatMap((c) => c.request.messages).filter((m) => m.role === "tool").map(text)
  return { forms, results: [...new Set(results)], calls }
}

test("a short question is rejected before the user sees a form", async () => {
  const outcome = await run([SHORT])
  expect(outcome.forms).toBe(0)
  expect(outcome.results.join("\n")).toContain(`Question 1 ${REJECTED} (16 characters).`)
}, 60_000)

test("resubmitting the rejected question unchanged opens the form", async () => {
  const outcome = await run([SHORT, SHORT])
  expect(outcome.forms).toBe(1)
  expect(outcome.results.join("\n")).toContain(`Question 1 ${REJECTED}`)
}, 60_000)

test("a question with context opens the form on the first call", async () => {
  const outcome = await run([LONG])
  expect(outcome.forms).toBe(1)
  expect(outcome.results.join("\n")).not.toContain(REJECTED)
  expect(outcome.results.join("\n")).toContain("Yes")
}, 60_000)

test("the question tool the model receives is left unchanged", async () => {
  const outcome = await run([])
  const tool = outcome.calls[0]!.request.tools!.find((t) => t.function.name === "question")!
  expect(tool.function.description).toContain("Use this tool when you need to ask the user questions during execution.")
  expect(tool.function.description).not.toContain("cold read")
}, 60_000)
