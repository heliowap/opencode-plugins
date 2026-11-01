import { afterAll, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// The adapter pins its state directory from XDG_STATE_HOME at module load and the checker reads
// $HOME, so both point at a throwaway machine before src/index.ts is imported.
const home = mkdtempSync(join(tmpdir(), "unpushed-work-home-"))
const state = mkdtempSync(join(tmpdir(), "unpushed-work-state-"))
const saved = { HOME: process.env.HOME, XDG_STATE_HOME: process.env.XDG_STATE_HOME }
process.env.HOME = home
process.env.XDG_STATE_HOME = state
const { default: plugin } = await import("../src/index.ts")

afterAll(() => {
  if (saved.HOME === undefined) delete process.env.HOME
  else process.env.HOME = saved.HOME
  if (saved.XDG_STATE_HOME === undefined) delete process.env.XDG_STATE_HOME
  else process.env.XDG_STATE_HOME = saved.XDG_STATE_HOME
  rmSync(home, { recursive: true, force: true })
  rmSync(state, { recursive: true, force: true })
})

const reportFile = join(state, "opencode-unpushed-work", "last-report.txt")

// Reads the report once it contains needle; returns whatever is there at the deadline so the
// caller's assertion shows the actual content on failure.
const untilWritten = async (needle: string) => {
  const read = () => (existsSync(reportFile) ? readFileSync(reportFile, "utf8") : "")
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const text = read()
    if (text.includes(needle)) return text
    await Bun.sleep(25)
  }
  return read()
}

const BROKE = Symbol("broke")

// A minimal host the way the adapter calls it: subscribe hands back a push queue, get resolves
// from a fixture map, and an unknown session rejects. `calls` records every get so a test can
// watch the stream keep moving when nothing can be written.
const start = async (sessions: Record<string, object>, calls?: string[]) => {
  const pending: unknown[] = []
  const wake: Array<() => void> = []
  const ctx = {
    location: { directory: "/repo" },
    event: {
      subscribe: ({ signal }: { signal: AbortSignal }) =>
        (async function* () {
          while (!signal.aborted) {
            while (pending.length === 0 && !signal.aborted) {
              await new Promise<void>((resolve) => {
                wake.push(resolve)
                signal.addEventListener("abort", () => resolve(), { once: true })
              })
            }
            const event = pending.shift()
            if (event === BROKE) throw new Error("stream broke")
            if (event !== undefined) yield event
          }
        })(),
    },
    session: {
      get: ({ sessionID }: { sessionID: string }) => {
        calls?.push(sessionID)
        const session = sessions[sessionID]
        return session === undefined
          ? Promise.reject(new Error(`no session ${sessionID}`))
          : Promise.resolve(session)
      },
    },
  }
  const cleanup = await plugin.setup(ctx as never)
  const feed = (event: unknown) => {
    pending.push(event)
    for (const resolve of wake.splice(0)) resolve()
  }
  return {
    cleanup,
    broke: () => feed(BROKE),
    push: (sessionID: string) => feed({ type: "session.execution.succeeded", data: { sessionID } }),
  }
}

const session = (sessionID: string) => ({
  id: sessionID,
  location: { directory: "/repo" },
  time: { created: "2026-10-16T00:47:19.517Z" },
})

test("a session missing its time field fails its own event, and the next turn still reports", async () => {
  const host = await start({
    ses_broken: { id: "ses_broken", location: { directory: "/repo" } },
    ses_done: session("ses_done"),
  })
  try {
    host.push("ses_broken")
    const note = await untilWritten("unpushed-work plugin failed:")
    expect(note).toContain("unpushed-work plugin failed:")

    host.push("ses_done")
    const report = await untilWritten("session=ses_done")
    expect(report).toContain(
      "session=ses_done since=2026-10-16T00:47:19.517Z exit=0 (remote state from local refs, no fetch)",
    )
  } finally {
    await host.cleanup?.()
  }
})

test("a rejected session lookup writes a failure note, and the next turn still reports", async () => {
  const host = await start({ ses_done: session("ses_done") })
  try {
    host.push("ses_missing")
    const note = await untilWritten("unpushed-work plugin failed:")
    expect(note).toContain("unpushed-work plugin failed:")

    host.push("ses_done")
    const report = await untilWritten("session=ses_done")
    expect(report).toContain("session=ses_done since=2026-10-16T00:47:19.517Z")
  } finally {
    await host.cleanup?.()
  }
})

test("a broken subscription is reported as an event-stream failure", async () => {
  const host = await start({})
  try {
    host.broke()
    const note = await untilWritten("event stream failed:")
    expect(note).toContain("event stream failed: Error: stream broke")
  } finally {
    await host.cleanup?.()
  }
})

test("a note that cannot be written does not stop later events", async () => {
  // last-report.txt as a directory makes every write fail; the stream must still drain the queue.
  rmSync(reportFile, { force: true })
  mkdirSync(reportFile, { recursive: true })
  const calls: string[] = []
  const host = await start({ ses_other: { id: "ses_other", location: { directory: "/other" } } }, calls)
  try {
    host.push("ses_missing")
    host.push("ses_other")
    const deadline = Date.now() + 10_000
    while (calls.length < 2 && Date.now() < deadline) await Bun.sleep(25)
    expect(calls).toEqual(["ses_missing", "ses_other"])
  } finally {
    await host.cleanup?.()
    rmSync(join(state, "opencode-unpushed-work"), { recursive: true, force: true })
  }
})
