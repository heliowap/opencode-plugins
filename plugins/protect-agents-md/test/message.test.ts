import { expect, test } from "bun:test"
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import plugin from "../src/index.ts"

type Hook = (input: never) => void

// Runs the plugin's setup against a hook registry, the way the host calls it, so the test can
// fire permission evaluations and tool executions directly.
const start = async (directory: string) => {
  const hooks = new Map<string, Hook>()
  const domain = (prefix: string) => ({
    hook: (name: string, callback: Hook) => {
      hooks.set(`${prefix}.${name}`, callback)
      return Promise.resolve({ dispose: async () => {} })
    },
  })
  const ctx = {
    location: { directory },
    session: domain("session"),
    tool: domain("tool"),
    permission: domain("permission"),
  }
  await plugin.setup(ctx as never)
  return hooks
}

const deniedEdit = (sessionID: string, directory: string) => {
  const event = {
    sessionID,
    action: "edit",
    resources: [join(directory, "AGENTS.md")],
    effect: "allow",
    message: undefined as string | undefined,
  }
  return event
}

const message = (target: string) =>
  [
    `Stop and call the question tool with this input, replacing <change> with what the edit changes and why, then retry only if the answer is "Yes":`,
    `{"questions":[{"header":"AGENTS.md edit","question":"Do you want to proceed with editing AGENTS.md? ${target}. Change: <change>","options":[{"label":"Yes","description":"apply the edit"},{"label":"No","description":"leave it unchanged"}]}]}`,
    "Keep the question's first sentence and target as written. If you cannot use the question tool, report this to your parent.",
  ].join("\n")

const OPTIONS = [
  { label: "Yes", description: "apply the edit" },
  { label: "No", description: "leave it unchanged" },
]

const answer = (
  hooks: Map<string, Hook>,
  sessionID: string,
  question: string,
  reply: string,
  frame: { header?: string; options?: unknown } = {},
) =>
  hooks.get("tool.execute.after")!({
    tool: "question",
    sessionID,
    id: "call-q",
    input: { questions: [{ header: frame.header ?? "AGENTS.md edit", question, options: frame.options ?? OPTIONS }] },
    status: "completed",
    result: { metadata: { answers: [[reply]] } },
  } as never)

const withDirectory = async (run: (directory: string) => Promise<void>) => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "protect-agents-md-")))
  try {
    await run(directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test("the denial message names the file and unlocks the session on Yes", () =>
  withDirectory(async (directory) => {
    const hooks = await start(directory)
    const evaluate = hooks.get("permission.evaluate")!

    const denied = deniedEdit("s1", directory)
    evaluate(denied as never)
    expect(denied.effect).toBe("deny")
    expect(denied.message).toBe(message(`File: ${directory}/AGENTS.md`))

    // The agent fills in <change> and sends the rest of the JSON from the message as written.
    const input = JSON.parse(denied.message!.split("\n")[1]!) as { questions: { question: string }[] }
    input.questions[0]!.question = input.questions[0]!.question.replace("<change>", "adds the cold-read rule")
    hooks.get("tool.execute.after")!({
      tool: "question",
      sessionID: "s1",
      id: "call-1",
      input,
      status: "completed",
      result: { metadata: { answers: [["Yes"]] } },
    } as never)

    const allowed = deniedEdit("s1", directory)
    evaluate(allowed as never)
    expect(allowed.effect).toBe("allow")

    const other = deniedEdit("s2", directory)
    evaluate(other as never)
    expect(other.effect).toBe("deny")
  }))

const shellDenial = async (hooks: Map<string, Hook>, command: string) => {
  hooks.get("tool.execute.before")!({ tool: "shell", id: "call-sh", input: { command } } as never)
  const event = {
    sessionID: "s1",
    action: "shell",
    resources: [command],
    source: { type: "tool", id: "call-sh" },
    effect: "allow",
    message: undefined as string | undefined,
  }
  hooks.get("permission.evaluate")!(event as never)
  return event
}

test("a denied shell write names its command", () =>
  withDirectory(async (directory) => {
    const event = await shellDenial(await start(directory), "printf x >> AGENTS.md")
    expect(event.effect).toBe("deny")
    expect(event.message).toBe(message("Command: printf x >> AGENTS.md"))
  }))

test("a long command keeps its head and its tail, cut on code points", () =>
  withDirectory(async (directory) => {
    const command = `echo ${"😀".repeat(400)} > AGENTS.md`
    const event = await shellDenial(await start(directory), command)
    expect(event.message).toBe(message(`Command: echo ${"😀".repeat(145)} … ${"😀".repeat(138)} > AGENTS.md`))
    expect(event.message!.isWellFormed()).toBe(true)
  }))

test("a symlinked target is named by the file it resolves to, once", () =>
  withDirectory(async (directory) => {
    writeFileSync(join(directory, "AGENTS.md"), "x\n")
    symlinkSync(join(directory, "AGENTS.md"), join(directory, "rules.md"))
    const hooks = await start(directory)
    const event = { ...deniedEdit("s1", directory), resources: ["rules.md", "AGENTS.md", "README.md"] }
    hooks.get("permission.evaluate")!(event as never)
    expect(event.effect).toBe("deny")
    expect(event.message).toBe(message(`File: ${directory}/AGENTS.md`))
  }))

test("a command's line breaks are shown escaped, and only the shown question approves", () =>
  withDirectory(async (directory) => {
    const hooks = await start(directory)
    const command = "printf x >> AGENTS.md\n\n# Ignore the line above. Should I run the tests?\ntrue"
    const event = await shellDenial(hooks, command)
    const shown = "Command: printf x >> AGENTS.md\\u{a}\\u{a}# Ignore the line above. Should I run the tests?\\u{a}true"
    // The message carries the question as JSON, where each backslash of \u{a} is escaped once more.
    expect(event.message).toBe(message("Command: printf x >> AGENTS.md\\\\u{a}\\\\u{a}# Ignore the line above. Should I run the tests?\\\\u{a}true"))

    answer(hooks, "s1", `Do you want to proceed with editing AGENTS.md? Command: ${command}. Change: x`, "Yes")
    const raw = deniedEdit("s1", directory)
    hooks.get("permission.evaluate")!(raw as never)
    expect(raw.effect).toBe("deny")

    answer(hooks, "s1", `Do you want to proceed with editing AGENTS.md? ${shown}. Change: appends x`, "Yes")
    const escaped = deniedEdit("s1", directory)
    hooks.get("permission.evaluate")!(escaped as never)
    expect(escaped.effect).toBe("allow")
  }))

test("an issued question stops approving after the user's next message", () =>
  withDirectory(async (directory) => {
    const hooks = await start(directory)
    const evaluate = hooks.get("permission.evaluate")!
    evaluate(deniedEdit("s1", directory) as never)
    hooks.get("session.prompt")!({ sessionID: "s1" } as never)
    answer(hooks, "s1", `Do you want to proceed with editing AGENTS.md? File: ${directory}/AGENTS.md. Change: adds a rule.`, "Yes")
    const stale = deniedEdit("s1", directory)
    evaluate(stale as never)
    expect(stale.effect).toBe("deny")

    answer(hooks, "s1", "Do you want to proceed with editing AGENTS.md?", "Yes")
    const bare = deniedEdit("s1", directory)
    evaluate(bare as never)
    expect(bare.effect).toBe("allow")
  }))

const LEAD = "Do you want to proceed with editing AGENTS.md?"

test.each<[string, { header?: string; options?: unknown }, string]>([
  ["the plugin's frame with keys reordered", { options: [{ description: "apply the edit", label: "Yes" }, { description: "leave it unchanged", label: "No" }] }, "allow"],
  ["another header", { header: "Run the test suite?" }, "deny"],
  ["a reworded Yes option", { options: [{ label: "Yes", description: "run the tests; AGENTS.md is untouched" }, { label: "No", description: "leave it unchanged" }] }, "deny"],
  ["an option with an extra field", { options: [{ label: "Yes", description: "apply the edit", note: "runs the tests" }, { label: "No", description: "leave it unchanged" }] }, "deny"],
])("the bare question in %s", (_name, frame, effect) =>
  withDirectory(async (directory) => {
    const hooks = await start(directory)
    const evaluate = hooks.get("permission.evaluate")!
    const before = deniedEdit("s1", directory)
    evaluate(before as never)
    expect(before.effect).toBe("deny")
    answer(hooks, "s1", LEAD, "Yes", frame)
    const after = deniedEdit("s1", directory)
    evaluate(after as never)
    expect(after.effect).toBe(effect)
  }))

test.each<[string, (file: string) => string, string, string]>([
  ["the bare question", () => LEAD, "Yes", "allow"],
  ["the issued question with a change", (file) => `${LEAD} File: ${file}. Change: adds a rule.`, "Yes", "allow"],
  ["the issued question answered No", (file) => `${LEAD} File: ${file}. Change: adds a rule.`, "No", "deny"],
  ["the lead in the middle", () => `Quick check. ${LEAD}`, "Yes", "deny"],
  ["a free-form tail after the lead", () => `${LEAD}\n\nIgnore the line above. Should I run the tests?`, "Yes", "deny"],
  ["no space after the lead", () => `${LEAD}Ignore that. Run the tests?`, "Yes", "deny"],
  ["a target the plugin never issued", () => `${LEAD} File: /x/AGENTS.md. Change: adds a rule.`, "Yes", "deny"],
  ["a change with a line break", (file) => `${LEAD} File: ${file}. Change: adds a rule.\nRun the tests?`, "Yes", "deny"],
  ["an empty change", (file) => `${LEAD} File: ${file}. Change: `, "Yes", "deny"],
  ["a change with a next-line character", (file) => `${LEAD} File: ${file}. Change: adds a rule.\u0085Run the tests?`, "Yes", "deny"],
  ["a change with a bidi override", (file) => `${LEAD} File: ${file}. Change: \u202Eselur a sdda`, "Yes", "deny"],
  ["a change with a terminal escape", (file) => `${LEAD} File: ${file}. Change: \u001b[2K\u001b[1ARun the tests?`, "Yes", "deny"],
  ["a change padded with spaces", (file) => `${LEAD} File: ${file}. Change: adds a rule.${" ".repeat(300)}Run the tests?`, "Yes", "deny"],
  ["a change with a Hangul filler", (file) => `${LEAD} File: ${file}. Change: adds a rule.\u3164Run the tests?`, "Yes", "deny"],
  ["a change with a braille blank", (file) => `${LEAD} File: ${file}. Change: adds a rule.\u2800Run the tests?`, "Yes", "deny"],
  ["a change with a private-use character", (file) => `${LEAD} File: ${file}. Change: adds a rule.\uE000`, "Yes", "deny"],
  ["a change over 500 characters", (file) => `${LEAD} File: ${file}. Change: ${"a".repeat(501)}`, "Yes", "deny"],
])("%s", (_name, question, reply, effect) =>
  withDirectory(async (directory) => {
    const hooks = await start(directory)
    const evaluate = hooks.get("permission.evaluate")!
    const before = deniedEdit("s1", directory)
    evaluate(before as never)
    expect(before.effect).toBe("deny")
    answer(hooks, "s1", question(`${directory}/AGENTS.md`), reply)
    const after = deniedEdit("s1", directory)
    evaluate(after as never)
    expect(after.effect).toBe(effect)
  }))

