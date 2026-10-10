import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { text, type Call, type ChatMessage, type Reply } from "./harness/fixture.ts"
import { Host } from "./harness/host.ts"

const ORIGINAL = "# Global rules\n"
const QUESTION = "Do you want to proceed with editing AGENTS.md?"
const DENIED = "AGENTS.md files are protected"
type Step = { tool: string; args: Record<string, unknown> }
type Plan = (dir: string) => Step[][]

let host: Host
let plan: Plan = () => []

const phaseAndStep = (messages: readonly ChatMessage[]) => {
  const users = messages.filter((m) => m.role === "user" && !text(m).includes("You are a subagent"))
  const lastUser = messages.findLastIndex((m) => m.role === "user")
  const rounds = messages.slice(lastUser).filter((m) => m.role === "assistant" && m.tool_calls?.length).length
  return { phase: users.length - 1, step: rounds }
}

beforeAll(async () => {
  host = await Host.start({
    script: (call: Call): Reply => {
      const { phase, step } = phaseAndStep(call.request.messages)
      const next = plan(host.configDir)[phase]?.[step]
      return next ? { tool: next.tool, args: next.args } : { text: "done" }
    },
    extraPlugins: [join(import.meta.dir, "../src/index.ts")],
  })
})

afterAll(async () => {
  await host.stop()
})

const write = (dir: string, content = "edited\n"): Step => ({ tool: "write", args: { path: `${dir}/AGENTS.md`, content } })
const ask = (question = QUESTION): Step => ({
  tool: "question",
  args: { questions: [{ header: "AGENTS.md edit", question, options: [{ label: "Yes", description: "apply" }, { label: "No", description: "skip" }] }] },
})

const run = async (testPlan: Plan, answer: string | undefined, prompts = 1, directory?: string) => {
  const agents = join(host.configDir, "AGENTS.md")
  const repoAgents = join(host.project, "AGENTS.md")
  writeFileSync(agents, ORIGINAL)
  writeFileSync(repoAgents, ORIGINAL)
  rmSync(join(host.project, "pkg"), { recursive: true, force: true })
  plan = testPlan
  const firstCall = host.fixture.calls.length
  const session = await host.session("build", directory)
  let forms = 0
  for (let i = 0; i < prompts; i++) {
    await host.prompt(session, `prompt ${i}`)
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      const pending = (await host.json("GET", `/api/session/${session.id}/form`)) as { data?: { id: string; state?: { status?: string } }[] } | { id: string }[]
      const list = Array.isArray(pending) ? pending : (pending.data ?? [])
      const open = list.filter((form: any) => !form.state || form.state.status === "pending")
      for (const form of open) {
        forms++
        await host.json("POST", `/api/session/${session.id}/form/${form.id}/reply`, { answer: { q0: answer ?? "No" } })
      }
      const messages = await host.messages(session)
      if (messages.at(-1)?.type === "idle" && open.length === 0) break
      await Bun.sleep(200)
    }
  }
  const results = host.fixture.calls.slice(firstCall).flatMap((c) => c.request.messages).filter((m) => m.role === "tool").map(text)
  return {
    changed: readFileSync(agents, "utf8") !== ORIGINAL,
    repoChanged: readFileSync(repoAgents, "utf8") !== ORIGINAL,
    forms,
    denied: results.some((r) => r.includes(DENIED)),
  }
}

test("an edit without a question is denied", async () => {
  const outcome = await run((d) => [[write(d)]], undefined)
  expect(outcome).toMatchObject({ changed: false, denied: true })
}, 60_000)

test("Yes to the exact question allows the edit", async () => {
  const outcome = await run((d) => [[write(d), ask(), write(d)]], "Yes")
  expect(outcome).toMatchObject({ changed: true, forms: 1 })
}, 60_000)

test("No keeps it denied", async () => {
  const outcome = await run((d) => [[ask(), write(d)]], "No")
  expect(outcome).toMatchObject({ changed: false, forms: 1 })
}, 60_000)

test("a custom answer keeps it denied", async () => {
  const outcome = await run((d) => [[ask(), write(d)]], "Yes, but only the first line")
  expect(outcome.changed).toBe(false)
}, 60_000)

test("Yes to a different question keeps it denied", async () => {
  const outcome = await run((d) => [[ask("Shall I continue?"), write(d)]], "Yes")
  expect(outcome).toMatchObject({ changed: false, forms: 1 })
}, 60_000)

test("the approval ends at the user's next message", async () => {
  const outcome = await run((d) => [[ask(), write(d, "first\n")], [write(d, "second\n")]], "Yes", 2)
  expect(readFileSync(join(host.configDir, "AGENTS.md"), "utf8")).toBe("first\n")
  expect(outcome.changed).toBe(true)
}, 60_000)

test.each<[string, (d: string) => Step]>([
  ["edit tool, absolute path", (d) => ({ tool: "edit", args: { path: `${d}/AGENTS.md`, oldString: "Global", newString: "X" } })],
  ["shell append, absolute path", (d) => ({ tool: "shell", args: { command: `printf x >> ${d}/AGENTS.md` } })],
  ["shell append via ~ path", () => ({ tool: "shell", args: { command: "printf x >> ~/.config/opencode/AGENTS.md" } })],
  ["shell sed -i via cd", (d) => ({ tool: "shell", args: { command: `cd ${d} && sed -i '' s/Global/X/ AGENTS.md` } })],
])("%s is denied", async (_name, step) => {
  const outcome = await run((d) => [[step(d)]], undefined)
  expect(outcome).toMatchObject({ changed: false, denied: true })
}, 60_000)

test.each<[string, Step]>([
  ["edit tool, relative path", { tool: "edit", args: { path: "AGENTS.md", oldString: "Global", newString: "X" } }],
  ["shell append, relative path", { tool: "shell", args: { command: "printf x >> AGENTS.md" } }],
])("%s inside the config dir is denied", async (_name, step) => {
  const outcome = await run(() => [[step]], undefined, 1, host.configDir)
  expect(outcome).toMatchObject({ changed: false, denied: true })
}, 60_000)

test("other files and reads are not affected", async () => {
  writeFileSync(join(host.configDir, "notes.md"), "a\n")
  const outcome = await run((d) => [[{ tool: "write", args: { path: `${d}/notes.md`, content: "b\n" } }, { tool: "read", args: { path: `${d}/AGENTS.md` } }]], undefined)
  expect(readFileSync(join(host.configDir, "notes.md"), "utf8")).toBe("b\n")
  expect(outcome).toMatchObject({ changed: false, denied: false })
}, 60_000)

describe("AGENTS.md in repos", () => {
  test("an absolute write to a repo AGENTS.md is denied", async () => {
    const outcome = await run(() => [[{ tool: "write", args: { path: join(host.project, "AGENTS.md"), content: "x\n" } }]], undefined)
    expect(outcome).toMatchObject({ repoChanged: false, denied: true })
  }, 60_000)

  test("a relative edit inside a repo is denied", async () => {
    const outcome = await run(() => [[{ tool: "edit", args: { path: "AGENTS.md", oldString: "Global", newString: "X" } }]], undefined, 1, host.project)
    expect(outcome).toMatchObject({ repoChanged: false, denied: true })
  }, 60_000)

  test("a shell append inside a repo is denied", async () => {
    const outcome = await run(() => [[{ tool: "shell", args: { command: "printf x >> AGENTS.md" } }]], undefined, 1, host.project)
    expect(outcome).toMatchObject({ repoChanged: false, denied: true })
  }, 60_000)

  test("creating a new AGENTS.md in a subfolder is denied", async () => {
    const created = join(host.project, "pkg", "AGENTS.md")
    const outcome = await run(() => [[{ tool: "write", args: { path: created, content: "x\n" } }]], undefined)
    expect(outcome.denied).toBe(true)
    expect(existsSync(created)).toBe(false)
  }, 60_000)

  test("a different letter case is denied", async () => {
    const outcome = await run(() => [[{ tool: "write", args: { path: join(host.project, "pkg", "agents.md"), content: "x\n" } }]], undefined)
    expect(outcome.denied).toBe(true)
    expect(existsSync(join(host.project, "pkg", "agents.md"))).toBe(false)
  }, 60_000)

  test("Yes to the question allows a repo edit", async () => {
    const outcome = await run(() => [[ask(), { tool: "write", args: { path: join(host.project, "AGENTS.md"), content: "x\n" } }]], "Yes")
    expect(outcome).toMatchObject({ repoChanged: true, forms: 1 })
  }, 60_000)

  test("other repo files are not affected", async () => {
    const readme = join(host.project, "README.md")
    const outcome = await run(() => [[{ tool: "write", args: { path: readme, content: "hello\n" } }]], undefined)
    expect(readFileSync(readme, "utf8")).toBe("hello\n")
    expect(outcome.denied).toBe(false)
  }, 60_000)
})
