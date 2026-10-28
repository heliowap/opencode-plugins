import { afterEach, describe, expect, test } from "bun:test"
import { appendFile, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { BUDGET_LIMIT, CONTINUATION } from "../harness/fixture.ts"
import { Host, type Message, type Session } from "../harness/host.ts"
import { parseModel, userProviders } from "./providers.ts"

const ref = process.env.LIVE_MODEL
const results = process.env.LIVE_RESULTS ?? join(import.meta.dir, "results.jsonl")
const TIMEOUT = 900_000
let host: Host | undefined

afterEach(async () => {
  await host?.stop()
  host = undefined
})

const start = async () => {
  host = await Host.start({
    model: parseModel(ref!),
    providers: await userProviders(["cli_proxy", "cli_proxy_openai", "cli_proxy_google"]),
    allowAll: true,
  })
  return host
}

const synthetic = (messages: Message[], prefix: string) =>
  messages.filter((message) => message.type === "synthetic" && String(message.text).startsWith(prefix)).length

const record = async (scenario: string, session: Session, extra: Record<string, unknown>) => {
  const messages = await host!.messages(session)
  const goal = host!.stored(session)
  const entry = {
    model: ref,
    scenario,
    session: session.id,
    status: goal?.status,
    tokensUsed: goal?.tokensUsed,
    tokenBudget: goal?.tokenBudget,
    continuations: synthetic(messages, CONTINUATION),
    note: goal?.note?.slice(0, 300),
    ...extra,
  }
  await appendFile(results, JSON.stringify(entry) + "\n")
  return entry
}

const files = async (dir: string, names: string[]) =>
  Promise.all(names.map((name) => readFile(join(dir, name), "utf8").then((text) => text.trim(), () => undefined)))

describe.skipIf(!ref)(`live ${ref}`, () => {
  test(
    "L1 fixes a failing test and completes with evidence",
    async () => {
      const host = await start()
      const testSource = [
        'import { expect, test } from "bun:test"',
        'import { sum } from "./sum.ts"',
        'test("adds", () => expect(sum(2, 3)).toBe(5))',
        'test("cancels", () => expect(sum(-1, 1)).toBe(0))',
        "",
      ].join("\n")
      await writeFile(join(host.project, "sum.ts"), "export const sum = (a: number, b: number) => a - b\n")
      await writeFile(join(host.project, "sum.test.ts"), testSource)
      const session = await host.session()
      await host.goal(session, "Make `bun test` pass in this directory without modifying sum.test.ts. Proof: `bun test` exits 0.")
      await host.settleLive(session)

      const run = Bun.spawnSync(["bun", "test"], { cwd: host.project })
      const testUntouched = (await readFile(join(host.project, "sum.test.ts"), "utf8")) === testSource
      const entry = await record("L1", session, { bunTestExit: run.exitCode, testUntouched })
      expect(entry).toMatchObject({ status: "complete", bunTestExit: 0, testUntouched: true })
      expect(entry.note?.length).toBeGreaterThan(0)
    },
    TIMEOUT,
  )

  test(
    "L2 keeps working across turns until three files exist",
    async () => {
      const host = await start()
      const session = await host.session()
      await host.goal(
        session,
        "Create step-1.txt, step-2.txt and step-3.txt here, each containing only its number. Create exactly one file per turn and end your turn after each file. Proof: each file holds its number.",
      )
      await host.settleLive(session)

      const contents = await files(host.project, ["step-1.txt", "step-2.txt", "step-3.txt"])
      const entry = await record("L2", session, { contents })
      expect(entry).toMatchObject({ status: "complete", contents: ["1", "2", "3"] })
      expect(entry.continuations).toBeGreaterThanOrEqual(3)
    },
    TIMEOUT,
  )

  test(
    "L3 stops at its token budget with one wrap-up",
    async () => {
      const host = await start()
      const session = await host.session()
      await host.goal(
        session,
        "--tokens 40K Create files n1.txt through n20.txt here, each containing its number. Create exactly one file per turn and end your turn after each file.",
      )
      await host.settleLive(session)

      const messages = await host.messages(session)
      const limitIndex = messages.findIndex((message) => message.type === "synthetic" && String(message.text).startsWith(BUDGET_LIMIT))
      const continuationsAfterLimit = synthetic(messages.slice(limitIndex + 1), CONTINUATION)
      const entry = await record("L3", session, { wrapUps: synthetic(messages, BUDGET_LIMIT), continuationsAfterLimit })
      expect(entry).toMatchObject({ status: "budget_limited", wrapUps: 1, continuationsAfterLimit: 0 })
    },
    TIMEOUT,
  )

  test(
    "L4 a paused goal survives a server restart and finishes after resume",
    async () => {
      const host = await start()
      const session = await host.session()
      const names = ["r1.txt", "r2.txt", "r3.txt", "r4.txt"]
      await host.goal(
        session,
        "Create r1.txt, r2.txt, r3.txt and r4.txt here, each containing only its number. Create exactly one file per turn and end your turn after each file. Proof: each file holds its number.",
      )
      await host.until(async () => (await files(host.project, ["r1.txt"]))[0] !== undefined, 300_000)
      await host.goal(session, "pause")
      await host.settleLive(session)
      const paused = host.stored(session)
      await host.restart()
      const afterRestart = host.stored(session)
      await host.goal(session, "resume")
      await host.settleLive(session)

      const contents = await files(host.project, names)
      const entry = await record("L4", session, {
        pausedBeforeRestart: paused?.status,
        stateSurvived: JSON.stringify(paused) === JSON.stringify(afterRestart),
        contents,
      })
      expect(entry).toMatchObject({
        pausedBeforeRestart: "paused",
        stateSurvived: true,
        status: "complete",
        contents: ["1", "2", "3", "4"],
      })
    },
    TIMEOUT,
  )
})
