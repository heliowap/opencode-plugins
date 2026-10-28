import { afterEach, describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import type { Goal } from "../src/goal.ts"
import { afterToolResult, CONTINUATION, count, type Script } from "./harness/fixture.ts"
import { Host } from "./harness/host.ts"

const TIMEOUT = 180_000
let host: Host | undefined

afterEach(async () => {
  await host?.stop()
  host = undefined
})

const script: Script = (request) => {
  const turn = count(request, CONTINUATION)
  if (afterToolResult(request)) return { text: turn === 0 ? "Goal created." : "Step done." }
  if (turn === 0) return { tool: "goal_create", args: { objective: "write a.txt and b.txt" } }
  if (turn === 1) return { tool: "write", args: { path: "a.txt", content: "1" } }
  if (turn === 2) return { tool: "write", args: { path: "b.txt", content: "2" } }
  return { tool: "goal_update", args: { status: "complete", note: "a.txt=1, b.txt=2 verified" } }
}

const opencode = async (args: string[]) => {
  const child = Bun.spawn([process.env.OPENCODE_BIN ?? "opencode", ...args], {
    cwd: host!.project,
    env: { ...host!.env, PWD: host!.project },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  return { exitCode, stdout, output: stdout + stderr }
}

const run = async (target: string[]) => {
  const result = await opencode(["run", ...target, "--format", "json", "Set a goal: write a.txt and b.txt"])
  expect(result.exitCode, result.output).toBe(0)
  return /"sessionID":"(ses_[^"]+)"/.exec(result.stdout)![1]!
}

const goal = async (sessionID: string) => {
  const path = `/api/rpc/goal/get?location[directory]=${host!.project}`
  const result = await opencode(["api", "--server", host!.base, "post", path, "-d", JSON.stringify({ input: { sessionID } })])
  expect(result.exitCode, result.output).toBe(0)
  return (JSON.parse(result.stdout) as { output: { goal: Goal | null } }).output.goal
}

const files = (names: string[]) => Promise.all(names.map((name) => readFile(join(host!.project, name), "utf8").catch(() => undefined)))

describe("headless opencode run", () => {
  test(
    "H1 a goal created through opencode run --server is finished by the server after the command exits",
    async () => {
      host = await Host.start({ script })
      const id = await run(["--server", host.base])

      await host.until(async () => (await goal(id))?.status !== "active", 60_000)
      expect(await goal(id)).toMatchObject({ status: "complete", note: "a.txt=1, b.txt=2 verified" })
      expect(await files(["a.txt", "b.txt"])).toEqual(["1", "2"])
      expect(host.fixture.agentRequests()).toHaveLength(8)
    },
    TIMEOUT,
  )

  test(
    "H2 opencode run --standalone stops the goal after its first turn (known limitation)",
    async () => {
      host = await Host.start({ script })
      const id = await run(["--standalone"])
      await Bun.sleep(3_000)

      expect(host.fixture.agentRequests().length).toBeLessThan(8)
      expect(host.stored({ id })).toMatchObject({ status: "active", objective: "write a.txt and b.txt" })
      expect(await files(["a.txt", "b.txt"])).toEqual([undefined, undefined])
    },
    TIMEOUT,
  )
})
