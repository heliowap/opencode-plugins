import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
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

const MESSAGE = [
  `Stop and call the question tool with exactly this input, then retry only if the answer is "Yes":`,
  `{"questions":[{"header":"AGENTS.md edit","question":"Do you want to proceed with editing AGENTS.md?","options":[{"label":"Yes","description":"apply the edit"},{"label":"No","description":"leave it unchanged"}]}]}`,
  `If you cannot use the question tool, report this to your parent.`,
].join("\n")

test("the denial message leads with a question input that unlocks the session on Yes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "protect-agents-md-"))
  try {
    const hooks = await start(directory)
    const evaluate = hooks.get("permission.evaluate")!

    const denied = deniedEdit("s1", directory)
    evaluate(denied as never)
    expect(denied.effect).toBe("deny")
    expect(denied.message).toBe(MESSAGE)

    // The agent copies the JSON from the message into the question tool, verbatim.
    const input = JSON.parse(denied.message!.split("\n")[1]!) as unknown
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
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
