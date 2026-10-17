import { describe, expect, test } from "bun:test"
import { decodeGoal, editRefusal, isUnfinished, step, type Goal } from "../src/goal.ts"

const T0 = 1_000
const T1 = 2_000

const active = (patch: Partial<Goal> = {}): Goal => ({
  objective: "make the suite pass",
  status: "active",
  tokenBudget: null,
  tokensUsed: 0,
  emptyTurns: 0,
  directory: "/repo",
  createdAt: T0,
  updatedAt: T0,
  ...patch,
})

const turn = (activity: boolean, planning = false) => ({ _tag: "TurnEnded", activity, planning }) as const

describe("set and edit", () => {
  test("Set creates an active goal and starts it", () => {
    expect(step(undefined, { _tag: "Set", objective: "ship it", tokenBudget: 50_000, verify: null, directory: "/repo" }, T0)).toEqual({
      goal: active({ objective: "ship it", tokenBudget: 50_000 }),
      effect: { _tag: "Continue" },
    })
  })

  test("Set replaces an existing goal and resets usage and its verify command", () => {
    const old = active({ status: "paused", tokensUsed: 900, verify: "bun test", verifyFailures: 2, lastExitCode: 1 })
    const next = step(old, { _tag: "Set", objective: "new", tokenBudget: null, verify: null, directory: "/repo" }, T1)
    expect(next.goal).toEqual(active({ objective: "new", createdAt: T1, updatedAt: T1 }))
  })

  test("Set stores the verify command", () => {
    expect(step(undefined, { _tag: "Set", objective: "ship it", tokenBudget: null, verify: "bun test", directory: "/repo" }, T0).goal).toEqual(
      active({ objective: "ship it", verify: "bun test" }),
    )
  })

  test("Edit keeps the verify command", () => {
    expect(step(active({ verify: "bun test" }), { _tag: "Edit", objective: "narrower" }, T1).goal).toEqual(
      active({ objective: "narrower", verify: "bun test", updatedAt: T1 }),
    )
  })

  test("Edit keeps usage and steers the active turn", () => {
    expect(step(active({ tokensUsed: 900, emptyTurns: 2 }), { _tag: "Edit", objective: "narrower" }, T1)).toEqual({
      goal: active({ objective: "narrower", tokensUsed: 900, updatedAt: T1 }),
      effect: { _tag: "ObjectiveUpdated" },
    })
  })

  test("Edit on a complete goal refuses like resume does (#1)", () => {
    const done = active({ status: "complete", note: "all green" })
    expect(step(done, { _tag: "Edit", objective: "x" }, T1)).toEqual({
      goal: done,
      effect: { _tag: "Notify", text: "The goal is complete. Set a new goal instead." },
    })
  })

  test("Edit on a goal that used its budget refuses like resume does (#1)", () => {
    const limited = active({ status: "budget_limited", tokenBudget: 1_000, tokensUsed: 1_200 })
    expect(step(limited, { _tag: "Edit", objective: "x" }, T1)).toEqual({
      goal: limited,
      effect: { _tag: "Notify", text: "The goal has used its token budget. Set a new goal with a larger --tokens budget." },
    })
  })

  test("Edit on a blocked goal keeps it blocked and points to resume", () => {
    expect(step(active({ status: "blocked" }), { _tag: "Edit", objective: "x" }, T1)).toEqual({
      goal: active({ status: "blocked", objective: "x", updatedAt: T1 }),
      effect: { _tag: "Notify", text: "Objective updated. The goal is blocked; run /goal resume to continue." },
    })
  })

  test("Edit on a paused goal keeps it paused", () => {
    expect(step(active({ status: "paused" }), { _tag: "Edit", objective: "x" }, T1)).toEqual({
      goal: active({ status: "paused", objective: "x", updatedAt: T1 }),
      effect: { _tag: "Notify", text: "Objective updated. The goal is paused; run /goal resume to continue." },
    })
  })
})

describe("continuation", () => {
  test("a turn with activity continues and resets the empty streak", () => {
    expect(step(active({ emptyTurns: 2 }), turn(true), T1)).toEqual({
      goal: active({ updatedAt: T1 }),
      effect: { _tag: "Continue" },
    })
  })

  test("an empty turn still continues while under the limit", () => {
    expect(step(active({ emptyTurns: 1 }), turn(false), T1)).toEqual({
      goal: active({ emptyTurns: 2, updatedAt: T1 }),
      effect: { _tag: "Continue" },
    })
  })

  test("the third empty turn in a row blocks the goal", () => {
    expect(step(active({ emptyTurns: 2 }), turn(false), T1)).toEqual({
      goal: active({ emptyTurns: 3, status: "blocked", note: "3 consecutive turns produced no output.", updatedAt: T1 }),
      effect: { _tag: "None" },
    })
  })

  test("planning turns neither continue nor count", () => {
    expect(step(active(), turn(true, true), T1)).toEqual({ goal: active(), effect: { _tag: "None" } })
  })

  test("turns after the goal settles change nothing", () => {
    const done = active({ status: "complete", note: "all green" })
    expect(step(done, turn(true), T1)).toEqual({ goal: done, effect: { _tag: "None" } })
  })
})

describe("token budget", () => {
  test("usage accumulates", () => {
    expect(step(active({ tokensUsed: 100 }), { _tag: "Usage", tokens: 250, closing: false }, T1).goal).toEqual(
      active({ tokensUsed: 350, updatedAt: T1 }),
    )
  })

  test("crossing the budget limits the goal and asks for a wrap-up", () => {
    expect(step(active({ tokenBudget: 1_000, tokensUsed: 900 }), { _tag: "Usage", tokens: 200, closing: false }, T1)).toEqual({
      goal: active({ tokenBudget: 1_000, tokensUsed: 1_100, status: "budget_limited", note: "Token budget reached.", updatedAt: T1 }),
      effect: { _tag: "WrapUp" },
    })
  })

  test("the wrap-up turn keeps counting without another wrap-up", () => {
    const limited = active({ tokenBudget: 1_000, tokensUsed: 1_100, status: "budget_limited" })
    expect(step(limited, { _tag: "Usage", tokens: 50, closing: false }, T1)).toEqual({
      goal: { ...limited, tokensUsed: 1_150, updatedAt: T1 },
      effect: { _tag: "None" },
    })
  })

  test("a budget-limited goal does not continue", () => {
    const limited = active({ status: "budget_limited" })
    expect(step(limited, turn(true), T1).effect).toEqual({ _tag: "None" })
  })

  test("resume refuses a goal that used its budget", () => {
    const limited = active({ status: "budget_limited", tokenBudget: 1_000, tokensUsed: 1_000 })
    expect(step(limited, { _tag: "Resume" }, T1)).toEqual({
      goal: limited,
      effect: { _tag: "Notify", text: "The goal has used its token budget. Set a new goal with a larger --tokens budget." },
    })
  })
})

describe("usage of the step that ends the goal (#2)", () => {
  test.each([["complete"], ["blocked"], ["paused"]] as const)("is charged to a goal the model just marked %s", (status) => {
    expect(step(active({ status, tokensUsed: 500 }), { _tag: "Usage", tokens: 4_000, closing: true }, T1)).toEqual({
      goal: active({ status, tokensUsed: 4_500, updatedAt: T1 }),
      effect: { _tag: "None" },
    })
  })

  test("a closing step that crosses the budget of a goal the model paused leaves it budget_limited", () => {
    const paused = active({ status: "paused", note: "user asked", tokenBudget: 1_000, tokensUsed: 900 })
    expect(step(paused, { _tag: "Usage", tokens: 200, closing: true }, T1)).toEqual({
      goal: active({ status: "budget_limited", note: "Token budget reached.", tokenBudget: 1_000, tokensUsed: 1_100, updatedAt: T1 }),
      effect: { _tag: "None" },
    })
  })

  test("a closing step keeps a blocked or complete goal's status even past its budget", () => {
    for (const status of ["blocked", "complete"] as const) {
      expect(step(active({ status, tokenBudget: 1_000, tokensUsed: 900 }), { _tag: "Usage", tokens: 200, closing: true }, T1)).toEqual({
        goal: active({ status, tokenBudget: 1_000, tokensUsed: 1_100, updatedAt: T1 }),
        effect: { _tag: "None" },
      })
    }
  })

  test("later steps on an ended goal are not charged", () => {
    const done = active({ status: "complete", tokensUsed: 4_500 })
    expect(step(done, { _tag: "Usage", tokens: 4_000, closing: false }, T1)).toEqual({ goal: done, effect: { _tag: "None" } })
  })
})

describe("goal_create (Create)", () => {
  const create = { _tag: "Create", objective: "second", tokenBudget: 5_000, verify: null, directory: "/other" } as const

  test("creates an active goal when the session has none or a complete one", () => {
    const created = active({ objective: "second", tokenBudget: 5_000, directory: "/other", createdAt: T1, updatedAt: T1 })
    expect(step(undefined, create, T1)).toEqual({ goal: created, effect: { _tag: "None" } })
    expect(step(active({ status: "complete" }), create, T1)).toEqual({ goal: created, effect: { _tag: "None" } })
  })

  test.each([["active"], ["paused"], ["blocked"], ["budget_limited"]] as const)("leaves an unfinished %s goal in place", (status) => {
    const goal = active({ status })
    expect(step(goal, create, T1)).toEqual({ goal, effect: { _tag: "None" } })
  })
})

describe("session moved (Moved)", () => {
  test("the goal follows the session to its new directory", () => {
    expect(step(active({ status: "paused" }), { _tag: "Moved", directory: "/elsewhere" }, T1)).toEqual({
      goal: active({ status: "paused", directory: "/elsewhere", updatedAt: T1 }),
      effect: { _tag: "None" },
    })
  })
})

describe("model updates", () => {
  test("complete records the evidence", () => {
    expect(step(active(), { _tag: "Complete", note: "bun test: 12 pass" }, T1).goal).toEqual(
      active({ status: "complete", note: "bun test: 12 pass", updatedAt: T1 }),
    )
  })

  test("a budget-limited goal can still be completed", () => {
    expect(step(active({ status: "budget_limited" }), { _tag: "Complete", note: "done" }, T1)).toEqual({
      goal: active({ status: "complete", note: "done", updatedAt: T1 }),
      effect: { _tag: "None" },
    })
  })

  test("a passing check completes a goal that has a verify command", () => {
    const goal = active({ verify: "bun test", verifyFailures: 1, lastExitCode: 1 })
    const check = { command: "bun test", exitCode: 0 }
    expect(step(goal, { _tag: "Complete", note: "done", check }, T1)).toEqual({
      goal: active({ verify: "bun test", verifyFailures: 1, lastExitCode: 0, status: "complete", note: "done", updatedAt: T1 }),
      effect: { _tag: "None" },
    })
  })

  test("a failing check keeps the goal active and counts the failure", () => {
    const check = { command: "bun test", exitCode: 2 }
    const once = step(active({ verify: "bun test" }), { _tag: "Complete", note: "done", check }, T1)
    expect(once).toEqual({ goal: active({ verify: "bun test", verifyFailures: 1, lastExitCode: 2, updatedAt: T1 }), effect: { _tag: "None" } })
    expect(step(once.goal, { _tag: "Complete", note: "done", check: { command: "bun test", exitCode: 1 } }, T1).goal).toEqual(
      active({ verify: "bun test", verifyFailures: 2, lastExitCode: 1, updatedAt: T1 }),
    )
  })

  test("a failing check on a budget-limited goal keeps it budget-limited", () => {
    const goal = active({ status: "budget_limited", verify: "bun test" })
    expect(step(goal, { _tag: "Complete", note: "done", check: { command: "bun test", exitCode: 1 } }, T1).goal).toEqual(
      active({ status: "budget_limited", verify: "bun test", verifyFailures: 1, lastExitCode: 1, updatedAt: T1 }),
    )
  })

  test.each([
    ["no check", undefined],
    ["a check of another command", { command: "true", exitCode: 0 }],
  ] as const)("a goal with a verify command does not complete on %s", (_, check) => {
    const goal = active({ verify: "bun test" })
    expect(step(goal, { _tag: "Complete", note: "done", check }, T1)).toEqual({ goal, effect: { _tag: "None" } })
  })

  test("a goal without a verify command ignores a check", () => {
    expect(step(active(), { _tag: "Complete", note: "done", check: { command: "false", exitCode: 1 } }, T1).goal).toEqual(
      active({ status: "complete", note: "done", updatedAt: T1 }),
    )
  })

  test("block records the missing decision", () => {
    expect(step(active(), { _tag: "Block", note: "needs prod credentials" }, T1).goal).toEqual(
      active({ status: "blocked", note: "needs prod credentials", updatedAt: T1 }),
    )
  })

  test("a requested pause from the model pauses quietly", () => {
    expect(step(active(), { _tag: "PauseRequested", note: undefined }, T1)).toEqual({
      goal: active({ status: "paused", note: "Paused at the user's request.", updatedAt: T1 }),
      effect: { _tag: "None" },
    })
  })

  test("budget limits take precedence over a requested pause", () => {
    const limited = active({ status: "budget_limited" })
    expect(step(limited, { _tag: "PauseRequested", note: undefined }, T1).goal).toEqual(limited)
  })
})

describe("recovery after a restart (#3)", () => {
  test("an active goal comes back paused", () => {
    expect(step(active({ tokensUsed: 700 }), { _tag: "Recovered" }, T1)).toEqual({
      goal: active({
        tokensUsed: 700,
        status: "paused",
        note: "Recovered after a restart. Run /goal resume to continue.",
        updatedAt: T1,
      }),
      effect: { _tag: "None" },
    })
  })

  test.each([["paused"], ["blocked"], ["budget_limited"], ["complete"]] as const)("a %s goal is left as it was", (status) => {
    const goal = active({ status })
    expect(step(goal, { _tag: "Recovered" }, T1)).toEqual({ goal, effect: { _tag: "None" } })
  })
})

describe("interruptions and failures", () => {
  test("a user interrupt pauses the goal", () => {
    expect(step(active(), { _tag: "Interrupted", reason: "user" }, T1).goal).toEqual(
      active({ status: "paused", note: "Interrupted by the user.", updatedAt: T1 }),
    )
  })

  test("a superseded turn keeps the goal active", () => {
    expect(step(active(), { _tag: "Interrupted", reason: "superseded" }, T1).goal).toEqual(active())
  })

  test("a failed turn blocks the goal so it cannot loop", () => {
    expect(step(active(), { _tag: "Failed", message: "rate limited" }, T1).goal).toEqual(
      active({ status: "blocked", note: "Turn failed: rate limited", updatedAt: T1 }),
    )
  })

  test("a rate limit (429) blocks without a retry", () => {
    expect(step(active(), { _tag: "Failed", message: "rate limited", status: 429 }, T1)).toEqual({
      goal: active({ status: "blocked", note: "Turn failed: rate limited", updatedAt: T1 }),
      effect: { _tag: "None" },
    })
  })

  test.each([500, 503, 599])("a server error (%p) keeps the goal active and schedules the first retry", (status) => {
    expect(step(active(), { _tag: "Failed", message: "unavailable", status }, T1)).toEqual({
      goal: active({ failedTurns: 1, updatedAt: T1 }),
      effect: { _tag: "Retry", attempt: 1 },
    })
  })

  test("the third consecutive server error schedules the last retry", () => {
    expect(step(active({ failedTurns: 2 }), { _tag: "Failed", message: "unavailable", status: 503 }, T1)).toEqual({
      goal: active({ failedTurns: 3, updatedAt: T1 }),
      effect: { _tag: "Retry", attempt: 3 },
    })
  })

  test("the fourth consecutive server error blocks and says how many retries ran", () => {
    expect(step(active({ failedTurns: 3 }), { _tag: "Failed", message: "unavailable", status: 503 }, T1)).toEqual({
      goal: active({ status: "blocked", failedTurns: 3, note: "Turn failed after 3 retries: unavailable", updatedAt: T1 }),
      effect: { _tag: "None" },
    })
  })

  test("a non-server error after retries blocks with the retry count", () => {
    expect(step(active({ failedTurns: 1 }), { _tag: "Failed", message: "bad request", status: 400 }, T1).goal).toEqual(
      active({ status: "blocked", failedTurns: 1, note: "Turn failed after 1 retries: bad request", updatedAt: T1 }),
    )
  })

  test("a due retry continues an active goal", () => {
    const goal = active({ failedTurns: 1 })
    expect(step(goal, { _tag: "RetryDue" }, T1)).toEqual({ goal, effect: { _tag: "Continue" } })
  })

  test.each(["paused", "blocked", "complete", "budget_limited"] as const)("a due retry does nothing to a %s goal", (status) => {
    const goal = active({ status, failedTurns: 1 })
    expect(step(goal, { _tag: "RetryDue" }, T1)).toEqual({ goal, effect: { _tag: "None" } })
  })

  test("a due retry does nothing without a goal", () => {
    expect(step(undefined, { _tag: "RetryDue" }, T1)).toEqual({ goal: undefined, effect: { _tag: "None" } })
  })

  test("a turn that ends clears the failure streak", () => {
    expect(step(active({ failedTurns: 2 }), turn(true), T1)).toEqual({
      goal: active({ updatedAt: T1 }),
      effect: { _tag: "Continue" },
    })
    expect(step(active({ failedTurns: 2 }), turn(false), T1).goal).toEqual(active({ emptyTurns: 1, updatedAt: T1 }))
  })

  test("resume clears the failure streak", () => {
    expect(step(active({ status: "blocked", failedTurns: 3, note: "x" }), { _tag: "Resume" }, T1)).toEqual({
      goal: active({ updatedAt: T1 }),
      effect: { _tag: "Continue" },
    })
  })
})

describe("user controls", () => {
  test("pause then resume continues with a fresh empty streak", () => {
    const paused = step(active({ emptyTurns: 2 }), { _tag: "Pause" }, T1)
    expect(paused).toEqual({
      goal: active({ emptyTurns: 2, status: "paused", note: "Paused by the user.", updatedAt: T1 }),
      effect: { _tag: "Notify", text: "Goal paused." },
    })
    expect(step(paused.goal, { _tag: "Resume" }, T1 + 1)).toEqual({
      goal: active({ updatedAt: T1 + 1 }),
      effect: { _tag: "Continue" },
    })
  })

  test("resume restarts a blocked goal", () => {
    expect(step(active({ status: "blocked", note: "x" }), { _tag: "Resume" }, T1)).toEqual({
      goal: active({ updatedAt: T1 }),
      effect: { _tag: "Continue" },
    })
  })

  test("resume refuses a complete goal", () => {
    expect(step(active({ status: "complete" }), { _tag: "Resume" }, T1).effect).toEqual({
      _tag: "Notify",
      text: "The goal is complete. Set a new goal instead.",
    })
  })

  test("clear removes the goal", () => {
    expect(step(active(), { _tag: "Clear" }, T1)).toEqual({ goal: undefined, effect: { _tag: "Notify", text: "Goal cleared." } })
  })

  test("controls without a goal explain there is none", () => {
    expect(step(undefined, { _tag: "Pause" }, T1)).toEqual({
      goal: undefined,
      effect: { _tag: "Notify", text: "No goal is set for this session." },
    })
  })
})

describe("decodeGoal", () => {
  test.each([["active"], ["paused"], ["blocked"], ["budget_limited"], ["complete"]] as const)("accepts a stored %s goal", (status) => {
    expect(decodeGoal(active({ status }))).toEqual(active({ status }))
  })

  test("rejects malformed or old-format storage", () => {
    expect(decodeGoal({ objective: "x", status: "active", turnBudget: 5, turnsUsed: 1 })).toBeUndefined()
  })
})

describe("rejected transitions leave the goal unchanged", () => {
  const paused = active({ status: "paused", note: "Paused by the user." })
  const blocked = active({ status: "blocked", note: "x" })

  test.each([
    ["Complete on a paused goal", paused, { _tag: "Complete", note: "done" }],
    ["Block on a paused goal", paused, { _tag: "Block", note: "stuck" }],
    ["Block on a budget-limited goal", active({ status: "budget_limited" }), { _tag: "Block", note: "stuck" }],
    ["PauseRequested on a blocked goal", blocked, { _tag: "PauseRequested", note: undefined }],
    ["Usage on a paused goal", paused, { _tag: "Usage", tokens: 50, closing: false }],
    ["Usage on a complete goal", active({ status: "complete" }), { _tag: "Usage", tokens: 50, closing: false }],
    ["a user interrupt on a blocked goal", blocked, { _tag: "Interrupted", reason: "user" }],
    ["a shutdown interrupt on an active goal", active(), { _tag: "Interrupted", reason: "shutdown" }],
    ["an inactivity interrupt on an active goal", active(), { _tag: "Interrupted", reason: "inactivity" }],
    ["Failed on a paused goal", paused, { _tag: "Failed", message: "boom" }],
    ["TurnEnded on a paused goal", paused, { _tag: "TurnEnded", activity: false, planning: false }],
  ] as const)("%s", (_name, goal, event) => {
    expect(step(goal, event, T1)).toEqual({ goal, effect: { _tag: "None" } })
  })
})

describe("user controls on goals that cannot take them", () => {
  test("pause on a paused goal explains why", () => {
    const paused = active({ status: "paused" })
    expect(step(paused, { _tag: "Pause" }, T1)).toEqual({
      goal: paused,
      effect: { _tag: "Notify", text: "The goal is paused; nothing to pause." },
    })
  })

  test("resume on an active goal explains it is already active", () => {
    expect(step(active(), { _tag: "Resume" }, T1)).toEqual({
      goal: active(),
      effect: { _tag: "Notify", text: "The goal is already active." },
    })
  })

  test("resume keeps usage when the budget still has room", () => {
    expect(step(active({ status: "paused", tokenBudget: 1_000, tokensUsed: 500 }), { _tag: "Resume" }, T1)).toEqual({
      goal: active({ tokenBudget: 1_000, tokensUsed: 500, updatedAt: T1 }),
      effect: { _tag: "Continue" },
    })
  })

  test.each([["Resume"], ["Clear"]] as const)("%s without a goal explains there is none", (tag) => {
    expect(step(undefined, { _tag: tag }, T1)).toEqual({
      goal: undefined,
      effect: { _tag: "Notify", text: "No goal is set for this session." },
    })
  })

  test("edit without a goal explains there is none", () => {
    expect(step(undefined, { _tag: "Edit", objective: "x" }, T1)).toEqual({
      goal: undefined,
      effect: { _tag: "Notify", text: "No goal is set for this session." },
    })
  })

  test("events from the session are ignored without a goal", () => {
    expect(step(undefined, { _tag: "Usage", tokens: 10, closing: false }, T1)).toEqual({ goal: undefined, effect: { _tag: "None" } })
    expect(step(undefined, { _tag: "TurnEnded", activity: true, planning: false }, T1)).toEqual({
      goal: undefined,
      effect: { _tag: "None" },
    })
  })
})

describe("model notes and budgets", () => {
  test("a requested pause keeps the model's note", () => {
    expect(step(active(), { _tag: "PauseRequested", note: "user said stop" }, T1).goal).toEqual(
      active({ status: "paused", note: "user said stop", updatedAt: T1 }),
    )
  })

  test("usage under the budget accumulates without a wrap-up", () => {
    expect(step(active({ tokenBudget: 1_000, tokensUsed: 100 }), { _tag: "Usage", tokens: 200, closing: false }, T1)).toEqual({
      goal: active({ tokenBudget: 1_000, tokensUsed: 300, updatedAt: T1 }),
      effect: { _tag: "None" },
    })
  })

  test("usage landing exactly on the budget limits the goal", () => {
    expect(step(active({ tokenBudget: 1_000, tokensUsed: 800 }), { _tag: "Usage", tokens: 200, closing: false }, T1)).toEqual({
      goal: active({ status: "budget_limited", note: "Token budget reached.", tokenBudget: 1_000, tokensUsed: 1_000, updatedAt: T1 }),
      effect: { _tag: "WrapUp" },
    })
  })
})

describe("isUnfinished", () => {
  test.each([
    ["no goal", undefined, false],
    ["complete", active({ status: "complete" }), false],
    ["active", active(), true],
    ["paused", active({ status: "paused" }), true],
    ["blocked", active({ status: "blocked" }), true],
    ["budget_limited", active({ status: "budget_limited" }), true],
  ] as const)("%s -> %p", (_name, goal, expected) => {
    expect(isUnfinished(goal)).toBe(expected)
  })
})

describe("editRefusal", () => {
  test.each([
    ["no goal", undefined, "No goal is set for this session."],
    ["complete", active({ status: "complete" }), "The goal is complete. Set a new goal instead."],
    [
      "out of budget",
      active({ status: "budget_limited", tokenBudget: 1_000, tokensUsed: 1_200 }),
      "The goal has used its token budget. Set a new goal with a larger --tokens budget.",
    ],
    ["active", active(), undefined],
    ["paused", active({ status: "paused" }), undefined],
    ["blocked", active({ status: "blocked" }), undefined],
  ] as const)("%s -> %p", (_name, goal, expected) => {
    expect(editRefusal(goal)).toBe(expected)
  })
})
