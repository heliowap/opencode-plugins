import { expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import plugin from "../src/index.ts"

type Hook = (event: never) => void

// Runs the plugin's setup the way the host calls it, capturing the tool hooks
// so the test can fire execute.before and execute.after events directly.
const start = async (directory: string) => {
  const hooks = new Map<string, Hook>()
  const ctx = {
    location: { directory },
    tool: {
      hook: (name: string, callback: Hook) => {
        hooks.set(`tool.${name}`, callback)
        return Promise.resolve({ dispose: async () => {} })
      },
    },
  }
  await plugin.setup(ctx as never)
  return hooks
}

const SECRET = "synthetic-setup-secret-42"
const ENV_NAME = "REDACT_SECRETS_SETUP_SECRET"

const withSetup = async (run: (hooks: Map<string, Hook>, directory: string) => void) => {
  const directory = mkdtempSync(join(tmpdir(), "redact-setup-"))
  const previous = process.env[ENV_NAME]
  process.env[ENV_NAME] = SECRET
  try {
    const hooks = await start(directory)
    run(hooks, directory)
  } finally {
    if (previous === undefined) delete process.env[ENV_NAME]
    else process.env[ENV_NAME] = previous
    rmSync(directory, { recursive: true, force: true })
  }
}

test("execute.before rejects a shell command that carries a placeholder", () =>
  withSetup((hooks) => {
    const before = hooks.get("tool.execute.before")!
    const event = { tool: "shell", input: { command: "echo [REDACTED:deadbeef] > /tmp/x" } }
    expect(() => before(event as never)).toThrow(
      'Shell commands cannot contain the placeholder "[REDACTED:deadbeef]"; it is never substituted. Re-read the file and run the command without it.',
    )
  }))

test("execute.before restores a known placeholder in an edit input", () =>
  withSetup((hooks, directory) => {
    writeFileSync(join(directory, "note.txt"), `SECRET_TOKEN=${SECRET}\n`)
    const before = hooks.get("tool.execute.before")!
    const after = hooks.get("tool.execute.after")!

    // The model sees only the masked result; the placeholder it would copy
    // into an edit comes from execute.after on the same plugin instance.
    const seen = { tool: "read", status: "completed", result: { content: `SECRET_TOKEN=${SECRET}` } }
    after(seen as never)
    const masked = seen.result.content
    expect(masked).toMatch(/^SECRET_TOKEN=\[REDACTED:[0-9a-f]{8}\]$/)

    const event = {
      tool: "edit",
      input: { filePath: "note.txt", oldString: masked, newString: `${masked} extra` },
    }
    before(event as never)
    expect(event.input).toEqual({
      filePath: "note.txt",
      oldString: `SECRET_TOKEN=${SECRET}`,
      newString: `SECRET_TOKEN=${SECRET} extra`,
    })
  }))

test("execute.before rejects an edit input whose placeholder has an unknown id", () =>
  withSetup((hooks, directory) => {
    writeFileSync(join(directory, "note.txt"), `SECRET_TOKEN=${SECRET}\n`)
    const before = hooks.get("tool.execute.before")!
    const event = {
      tool: "edit",
      input: { filePath: "note.txt", oldString: "SECRET_TOKEN=[REDACTED:deadbeef]", newString: "x" },
    }
    expect(() => before(event as never)).toThrow(
      'Edit input contains the placeholder "[REDACTED:deadbeef]", which cannot be resolved. Re-read the lines you want to change and write the edit again without the placeholder.',
    )
  }))

// A placeholder the masker can resolve is still a refusal outside the
// content-bearing fields: the key's role is unknown, so resolving it could
// land the secret in a file location.
test("execute.before rejects a write input whose placeholder sits under an unknown key", () =>
  withSetup((hooks) => {
    const before = hooks.get("tool.execute.before")!
    const after = hooks.get("tool.execute.after")!
    const seen = { tool: "read", status: "completed", result: { content: `token ${SECRET}` } }
    after(seen as never)
    const placeholder = seen.result.content.match(/\[REDACTED:[0-9a-f]{8}\]/)![0]

    const event = { tool: "write", input: { file: placeholder, content: "x" } }
    expect(() => before(event as never)).toThrow(
      `Edit input contains the placeholder "${placeholder}", which cannot be resolved. Re-read the lines you want to change and write the edit again without the placeholder.`,
    )
  }))

test("execute.before rejects a patch whose indented Add File header carries a placeholder", () =>
  withSetup((hooks) => {
    const before = hooks.get("tool.execute.before")!
    const after = hooks.get("tool.execute.after")!
    const seen = { tool: "read", status: "completed", result: { content: `token ${SECRET}` } }
    after(seen as never)
    const placeholder = seen.result.content.match(/\[REDACTED:[0-9a-f]{8}\]/)![0]

    const event = {
      tool: "patch",
      input: { patchText: `*** Begin Patch\n  *** Add File: ${placeholder}\n+x\n*** End Patch\n` },
    }
    expect(() => before(event as never)).toThrow(
      `Edit input contains the placeholder "${placeholder}", which cannot be resolved. Re-read the lines you want to change and write the edit again without the placeholder.`,
    )
  }))

test("execute.before leaves a read input with a mask-shaped path alone", () =>
  withSetup((hooks) => {
    const before = hooks.get("tool.execute.before")!
    const event = { tool: "read", input: { filePath: "[REDACTED:deadbeef]" } }
    before(event as never)
    expect(event.input).toEqual({ filePath: "[REDACTED:deadbeef]" })
  }))

test("execute.after masks the secret in a completed result", () =>
  withSetup((hooks) => {
    const after = hooks.get("tool.execute.after")!
    const event = { tool: "read", status: "completed", result: { content: `connect with ${SECRET}` } }
    after(event as never)
    expect(event.result.content).toMatch(/^connect with \[REDACTED:[0-9a-f]{8}\]$/)
  }))

test("execute.after masks the secret inside an object error", () =>
  withSetup((hooks) => {
    const after = hooks.get("tool.execute.after")!
    const event = { tool: "read", status: "error", error: { message: `failed: ${SECRET}` } }
    after(event as never)
    expect(event.error.message).toMatch(/^failed: \[REDACTED:[0-9a-f]{8}\]$/)
  }))

test("execute.after masks the secret inside a string error", () =>
  withSetup((hooks) => {
    const after = hooks.get("tool.execute.after")!
    const event = { tool: "read", status: "error", error: `connection failed: ${SECRET}` }
    after(event as never)
    expect(event.error).toMatch(/^connection failed: \[REDACTED:[0-9a-f]{8}\]$/)
  }))
