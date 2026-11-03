import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, readFileSync, rmSync } from "node:fs"
import { afterToolResult } from "./harness/fixture.ts"
import { Host, type Session } from "./harness/host.ts"

const TIMEOUT = 180_000
const tmux = Bun.which("tmux")
let host: Host | undefined
let terminal: string | undefined

afterEach(async () => {
  if (terminal) Bun.spawnSync(["tmux", "kill-session", "-t", terminal])
  terminal = undefined
  await host?.stop()
  host = undefined
})

const open = (session: Session) => {
  terminal = `goal-tui-${process.pid}-${Date.now()}`
  const env = ["HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME", "OPENCODE_SERVER_PASSWORD"]
  const spawned = Bun.spawnSync([
    "tmux", "new-session", "-d", "-s", terminal, "-x", "160", "-y", "40", "-c", host!.project,
    "env", ...env.map((name) => `${name}=${host!.env[name]}`), "TERM=xterm-256color",
    process.env.OPENCODE_BIN ?? "opencode", ...(process.env.GOAL_TUI_DEBUG ? ["--log-level", "debug"] : []), "--server", host!.base, "--session", session.id,
  ])
  expect(spawned.exitCode).toBe(0)
}

const screen = () => Bun.spawnSync(["tmux", "capture-pane", "-p", "-t", terminal!]).stdout.toString()

const badgeLine = () => {
  const lines = screen().split("\n")
  const input = lines.findIndex((line) => line.trimStart().startsWith("┃"))
  const above = input > 0 ? lines[input - 1]! : ""
  return above.slice(0, 100).trim()
}

const waitFor = async (check: () => boolean, failure: string, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) return
    await Bun.sleep(250)
  }
  throw new Error(`${failure} Screen:\n${screen()}`)
}

const sees = (expected: readonly string[]) =>
  waitFor(
    () => expected.every((line) => screen().includes(line)),
    `the screen never showed ${JSON.stringify(expected)}.`,
  )

const type = (...keys: string[]) => expect(Bun.spawnSync(["tmux", "send-keys", "-t", terminal!, ...keys]).exitCode).toBe(0)

const shows = (expected: string | RegExp) =>
  waitFor(
    () => (typeof expected === "string" ? badgeLine() === expected : expected.test(badgeLine())),
    `the line above the input never showed ${typeof expected === "string" ? `"${expected}"` : expected}.`,
  )

const click = async (pattern: RegExp) => {
  // Click targets can still move while the layout is drawing, and a dismissed
  // dialog keeps intercepting clicks for a rendered frame, so wait until the
  // match holds the same row across captures before clicking its coordinates.
  let row: number | undefined
  let lastSampledAt = 0
  let stableSamples = 0
  await waitFor(
    () => {
      const now = Date.now()
      if (now - lastSampledAt < 500) return false
      lastSampledAt = now
      const next = screen().split("\n").findIndex((line) => pattern.test(line))
      if (next < 0) {
        row = undefined
        stableSamples = 0
        return false
      }
      stableSamples = next === row ? stableSamples + 1 : 1
      row = next
      return stableSamples === 3
    },
    `the line matching ${pattern} never stayed on one row across three captures.`,
  )
  const lines = screen().split("\n")
  expect(lines.findIndex((line) => pattern.test(line))).toBe(row!)
  const cell = `${lines[row!]!.search(pattern) + 1};${row! + 1}`
  type("-l", `\x1b[<0;${cell}M\x1b[<0;${cell}m`)
}

const SPINNER_FRAMES: readonly string[] = ["◐", "◓", "◑", "◒"]

const streamedGlyphs = async () => {
  // Polling capture-pane can alias against the 150ms frame rate when a spawn
  // costs hundreds of ms on a slow runner. pipe-pane streams every frame.
  const file = `${terminal}.capture`
  expect(Bun.spawnSync(["tmux", "pipe-pane", "-t", terminal!, "-o", `cat >> ${file}`]).exitCode).toBe(0)
  try {
    await waitFor(
      () => existsSync(file) && SPINNER_FRAMES.every((frame) => readFileSync(file, "utf8").includes(frame)),
      "the piped output never contained all spinner frames.",
      10_000,
    )
  } finally {
    Bun.spawnSync(["tmux", "pipe-pane", "-t", terminal!])
    rmSync(file, { force: true })
  }
}

const running = (usage: string) => new RegExp(`^[◐◓◑◒] goal running · ${usage}$`)

const openGoalControls = async () => {
  type("C-p")
  await sees(["Commands"])
  type("-l", "Goal controls")
  await waitFor(
    () => screen().split("\n").some((line) => /Goal controls\s+Goal\s*$/.test(line)),
    "the palette never listed the Goal controls command.",
  )
  type("Enter")
}

describe.skipIf(!tmux && !process.env.CI)("status above the input in the terminal UI", () => {
  test(
    "T1 running with usage, then paused, then gone after clear",
    async () => {
      host = await Host.start({
        script: () => ({ text: "Step.", delayMs: 4_000 }),
        ...(process.env.GOAL_PLUGIN_SPEC && { pluginSpec: process.env.GOAL_PLUGIN_SPEC }),
      })
      const session = await host.session()
      await host.goal(session, "--tokens 50K show me in the bar")
      open(session)

      // Usage values are transient: the TUI may open after early steps have
      // completed, so assert the count grows toward the budget, not exact values.
      await shows(running(".+ / 50K"))
      await streamedGlyphs()
      const used = () => {
        const match = /goal running · ([\d.]+)([KMG]?) \/ 50K/.exec(badgeLine())
        return match ? Number(match[1]) * { "": 1, K: 1e3, M: 1e6, G: 1e9 }[match[2]!]! : -1
      }
      const first = used()
      await waitFor(() => used() > first, "the badge usage never grew.")
      await host.goal(session, "pause")
      await shows("⏸ goal paused")
      await host.settle(session)
      await host.goal(session, "clear")
      await shows("")
      expect(host.stored(session)).toBeUndefined()
    },
    TIMEOUT,
  )

  test(
    "T2 an active goal between turns, blocked, and over budget",
    async () => {
      host = await Host.start({
        ...(process.env.GOAL_PLUGIN_SPEC && { pluginSpec: process.env.GOAL_PLUGIN_SPEC }),
        script: (request) => {
          if (request.messages.some((message) => message.role === "user" && JSON.stringify(message).includes("over budget"))) {
            return afterToolResult(request) ? { text: "Done." } : { text: "Spending." }
          }
          return { empty: true }
        },
      })
      const planned = await host.session("plan")
      await host.goal(planned, "plan only")
      open(planned)
      await host.settle(planned)
      await shows("◎ goal active · 0")
      Bun.spawnSync(["tmux", "kill-session", "-t", terminal!])

      const blocked = await host.session()
      await host.goal(blocked, "nothing happens")
      await host.settle(blocked)
      expect(host.stored(blocked)?.status).toBe("blocked")
      open(blocked)
      await shows("⚠ goal blocked")
      Bun.spawnSync(["tmux", "kill-session", "-t", terminal!])

      const limited = await host.session()
      await host.goal(limited, "--tokens 100 over budget")
      await host.settle(limited)
      expect(host.stored(limited)).toMatchObject({ status: "budget_limited", tokensUsed: 240 })
      open(limited)
      await shows("goal budget reached · 240 / 100")
    },
    TIMEOUT,
  )

  test(
    "T3 the sidebar shows the objective in three lines, and a bare /goal edit opens it for editing",
    async () => {
      host = await Host.start({
        script: () => ({ text: "Step." }),
        ...(process.env.GOAL_PLUGIN_SPEC && { pluginSpec: process.env.GOAL_PLUGIN_SPEC }),
      })
      const session = await host.session()
      const objective =
        "make the checkout suite pass without changing the public API and keep every existing test green while the payment provider migration lands"
      await host.goal(session, objective)
      await host.goal(session, "pause")
      await host.settle(session)
      open(session)

      await sees([
        "make the checkout suite pass without",
        "changing the public API and keep every",
        "existing test green while the payment…",
      ])
      expect(screen()).not.toContain("provider migration")

      type("-l", "/goal edit")
      type("Enter")
      await sees(["Edit goal", "provider migration lands"])
      type("-l", " soon")
      type("C-s")
      await host.until(() => host!.stored(session)?.objective === `${objective} soon`)
      expect(host.stored(session)?.status).toBe("paused")

      type("-l", "/goal edit")
      type("Enter")
      await sees(["Edit goal", "migration lands soon"])
      type("-l", " discarded")
      type("Escape")
      await host.until(() => !screen().includes("Edit goal"))
      await Bun.sleep(1_000)
      expect(host.stored(session)?.objective).toBe(`${objective} soon`)
    },
    TIMEOUT,
  )

  test(
    "T4 the sidebar title spins while a turn runs",
    async () => {
      host = await Host.start({
        script: () => ({ text: "Step.", delayMs: 4_000 }),
        ...(process.env.GOAL_PLUGIN_SPEC && { pluginSpec: process.env.GOAL_PLUGIN_SPEC }),
      })
      const session = await host.session()
      await host.goal(session, "spin the sidebar title")
      open(session)

      await shows(running(".+"))
      await streamedGlyphs()
      await waitFor(() => /[◐◓◑◒] Goal/.test(screen()), "the sidebar title never spun.", 10_000)
    },
    TIMEOUT,
  )

  test(
    "T5 clicking the sidebar title opens the objective editor",
    async () => {
      host = await Host.start({
        script: () => ({ text: "Step." }),
        ...(process.env.GOAL_PLUGIN_SPEC && { pluginSpec: process.env.GOAL_PLUGIN_SPEC }),
      })
      const session = await host.session()
      await host.goal(session, "open me from the sidebar")
      await host.goal(session, "pause")
      await host.settle(session)
      open(session)

      expect(screen()).not.toContain("Edit goal")
      await click(/\bGoal\s*$/m)
      await sees(["Edit goal", "open me from the sidebar"])
    },
    TIMEOUT,
  )

  test(
    "T6 clicking the badge opens the controls, which set the token budget and pause the goal",
    async () => {
      host = await Host.start({
        script: () => ({ text: "Step.", delayMs: 4_000 }),
        ...(process.env.GOAL_PLUGIN_SPEC && { pluginSpec: process.env.GOAL_PLUGIN_SPEC }),
      })
      const session = await host.session()
      await host.goal(session, "control me from the badge")
      open(session)

      await shows(running(".+"))
      await click(/goal (running|active)/)
      await sees(["Token budget", "Pause goal", "Clear goal"])
      type("-l", "Token budget")
      type("Enter")
      await sees(["Such as 50K or 1.5M"])
      type("-l", "5K")
      type("Enter")
      await host.until(() => host!.stored(session)?.tokenBudget === 5_000)

      // The budget prompt's backdrop still owns the click for a rendered frame
      // after it dismisses; wait until it is visibly gone before clicking again.
      await waitFor(
        () => !screen().includes("Such as 50K or 1.5M") && !screen().includes("Pause goal"),
        "the token budget prompt never left the screen.",
      )
      await click(/goal (running|active)/)
      await sees(["Pause goal"])
      type("-l", "Pause goal")
      type("Enter")
      await host.until(() => host!.stored(session)?.status === "paused")
    },
    TIMEOUT,
  )

  test(
    "T7 the palette opens the controls, which clear the goal after a confirm",
    async () => {
      host = await Host.start({
        script: () => ({ text: "Step." }),
        ...(process.env.GOAL_PLUGIN_SPEC && { pluginSpec: process.env.GOAL_PLUGIN_SPEC }),
      })
      const session = await host.session()
      await host.goal(session, "clear me from the palette")
      await host.goal(session, "pause")
      await host.settle(session)
      open(session)

      await shows("⏸ goal paused")
      await openGoalControls()
      await sees(["Resume goal", "Clear goal"])
      type("-l", "Clear goal")
      type("Enter")
      await sees(["Clear goal?"])
      type("Enter")
      await host.until(() => host!.stored(session) === undefined)
    },
    TIMEOUT,
  )

  test(
    "T8 the palette reports when the session has no unfinished goal",
    async () => {
      host = await Host.start({
        script: () => ({ text: "Step." }),
        ...(process.env.GOAL_PLUGIN_SPEC && { pluginSpec: process.env.GOAL_PLUGIN_SPEC }),
      })
      const session = await host.session()
      await host.prompt(session, "hello")
      await host.settle(session)
      open(session)

      await sees(["hello"])
      await openGoalControls()
      await sees(["This session has no unfinished goal."])
      expect(host.stored(session)).toBeUndefined()
    },
    TIMEOUT,
  )

  test(
    "T9 the animated badge stays clickable across spinner frames",
    async () => {
      host = await Host.start({
        script: () => ({ text: "Step.", delayMs: 4_000 }),
        ...(process.env.GOAL_PLUGIN_SPEC && { pluginSpec: process.env.GOAL_PLUGIN_SPEC }),
      })
      const session = await host.session()
      await host.goal(session, "control me from the badge")
      open(session)
      await shows(running(".+"))

      for (let index = 0; index < 30; index++) {
        await click(/goal (running|active)/)
        await sees(["Pause goal"])
        type("Escape")
        await waitFor(() => !screen().includes("Pause goal"), "the goal controls did not close.")
      }
    },
    TIMEOUT,
  )
})
