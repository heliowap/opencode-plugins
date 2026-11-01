import { afterEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterToolResult, CONTINUATION, count } from "./harness/fixture.ts"
import { Host, type Session } from "./harness/host.ts"

const TIMEOUT = 180_000
const complete = { tool: "goal_update", args: { status: "complete", note: "done" } } as const
let host: Host | undefined

afterEach(async () => {
  await host?.stop()
  host = undefined
})

describe("persistence", () => {
  test(
    "A12a a paused goal survives a server restart unchanged",
    async () => {
      host = await Host.start({ script: () => ({ text: "Step.", delayMs: 2_000 }) })
      const session = await host.session()
      await host.goal(session, "--tokens 1M outlive a restart")
      await host.until(() => host!.fixture.agentRequests().length === 1)
      await host.goal(session, "pause")
      await host.settle(session)
      const before = host.stored(session)

      await host.restart()
      expect(host.stored(session)).toEqual(before!)
      expect(before).toMatchObject({ status: "paused", tokenBudget: 1_000_000 })
    },
    TIMEOUT,
  )

  test(
    "A12b an active goal whose server died mid-turn stays active and continues by itself (#9)",
    async () => {
      host = await Host.start({
        script: (request) => {
          if (afterToolResult(request)) return { text: "Closing." }
          return count(request, CONTINUATION) >= 2 ? complete : { text: "Long step.", delayMs: 20_000 }
        },
      })
      const session = await host.session()
      await host.goal(session, "outlive a crash")
      await host.until(() => host!.fixture.agentRequests().length === 1)
      await host.restart()
      await host.until(() => host!.stored(session)?.status === "complete")
      await host.settle(session)

      expect(host.stored(session)).toMatchObject({ status: "complete", note: "done" })
      const recovered = readFileSync(join(host.root, "data", "opencode", "log", "goal.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter((record) => record.event === "Recovered")
      expect(recovered.map(({ at: _at, tokensUsed: _tokens, ...rest }) => rest)).toEqual([
        { _tag: "Transition", sessionID: session.id, event: "Recovered", from: "active", to: "active", effect: "Cooldown" },
      ])
    },
    TIMEOUT,
  )

  test(
    "A12e an active goal comes back paused when pauseOnRestart is set (#9)",
    async () => {
      host = await Host.start({
        pluginOptions: { pauseOnRestart: true },
        script: (request) => {
          if (afterToolResult(request)) return { text: "Closing." }
          return count(request, CONTINUATION) >= 2 ? complete : { text: "Long step.", delayMs: 20_000 }
        },
      })
      const session = await host.session()
      await host.goal(session, "outlive a crash")
      await host.until(() => host!.fixture.agentRequests().length === 1)
      await host.restart()
      await host.until(() => host!.stored(session)?.status !== "active")

      expect(host.stored(session)).toMatchObject({
        status: "paused",
        note: "Recovered after a restart. Run /goal resume to continue.",
      })
      await host.goal(session, "resume")
      await host.settle(session)
      expect(host.stored(session)).toMatchObject({ status: "complete" })
    },
    TIMEOUT,
  )

  test(
    "A12f a goal whose session vanished is cleared on recovery instead of looping forever (#9)",
    async () => {
      host = await Host.start({
        script: (request) => (afterToolResult(request) ? { text: "Done." } : complete),
      })
      const session = await host.session()
      await host.goal(session, "survive")
      await host.until(() => host!.stored(session) !== undefined)

      // A session deleted while its location was not running leaves its goal row behind; plant one
      // by cloning the real row under a session id that does not exist.
      const ghost: Session = { id: "ses_ghost" }
      const db = new Database(join(host.root, "data", "opencode", "opencode.db"))
      db.exec("pragma busy_timeout = 5000")
      const row = db.query("select key, value from kv where key like ?").get(`plugin:%:goal/${session.id}`) as {
        key: string
        value: string
      }
      db.run("insert into kv (key, value, time_created, time_updated) values (?, ?, ?, ?)", [
        row.key.replace(session.id, ghost.id),
        row.value,
        Date.now(),
        Date.now(),
      ])
      db.close()
      expect(host.stored(ghost)).toMatchObject({ status: "active" })

      await host.restart()

      await host.until(() => host!.stored(ghost) === undefined)
      await host.until(() => host!.stored(session)?.status === "complete")
      await host.settle(session)
      expect(host.stored(session)).toMatchObject({ status: "complete", note: "done" })
    },
    TIMEOUT,
  )

  test(
    "A12c reloading the location keeps a running goal active and continuing",
    async () => {
      host = await Host.start({
        script: (request) => {
          if (afterToolResult(request)) return { text: "Closing." }
          return count(request, CONTINUATION) >= 2 ? complete : { text: "Step during reload.", delayMs: 3_000 }
        },
      })
      const session = await host.session()
      await host.goal(session, "outlive a reload")
      await host.until(() => host!.fixture.agentRequests().length === 1)
      await host.json("POST", "/api/location/reload")
      await host.settle(session)

      expect(host.stored(session)).toMatchObject({ status: "complete" })
    },
    TIMEOUT,
  )

  test(
    "A13 deleting a session removes its goal",
    async () => {
      host = await Host.start({ script: () => ({ text: "Step.", delayMs: 1_000 }) })
      const session = await host.session()
      await host.goal(session, "short lived")
      await host.until(() => host!.stored(session) !== undefined)
      await host.goal(session, "pause")
      await host.settle(session)
      const events = host.events((type) => type === "rpc.goal.changed")
      await Bun.sleep(500)
      await host.remove(session)
      await host.until(() => host!.stored(session) === undefined)
      await host.until(() => events.seen.length > 0)
      events.stop()
      expect(events.seen.map((event) => event.data)).toEqual([{ sessionID: session.id, goal: null }])
    },
    TIMEOUT,
  )

  test(
    "A12d a location reload during a plan-agent turn still keeps that turn uncounted",
    async () => {
      host = await Host.start({ script: () => ({ text: "Here is a plan.", delayMs: 3_000 }) })
      const session = await host.session("plan")
      await host.goal(session, "plan across a reload")
      await host.until(() => host!.fixture.agentRequests().length >= 1)
      await host.json("POST", "/api/location/reload")
      await host.settle(session)

      expect(host.stored(session)).toMatchObject({ status: "active", tokensUsed: 0, emptyTurns: 0 })
    },
    TIMEOUT,
  )

  test(
    "A16 a goal follows its session to a new directory and keeps running there",
    async () => {
      host = await Host.start({
        script: (request) => {
          if (afterToolResult(request)) return { text: "Closing." }
          return count(request, CONTINUATION) >= 2 ? complete : { text: "Step.", delayMs: 1_500 }
        },
      })
      const session = await host.session()
      await host.goal(session, "move with me")
      await host.until(() => host!.fixture.agentRequests().length === 1)
      await host.goal(session, "pause")
      await host.settle(session)
      const elsewhere = `${host.project}-moved`
      await Bun.$`mkdir -p ${elsewhere}`
      await host.json("POST", `/api/session/${session.id}/move`, { directory: elsewhere })
      await host.until(() => host!.stored(session)?.directory === elsewhere)

      await host.goal(session, "resume")
      await host.settle(session)
      expect(host.stored(session)).toMatchObject({ status: "complete", directory: elsewhere })
    },
    TIMEOUT,
  )
})
