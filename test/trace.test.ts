import { describe, expect, test } from "bun:test"
import type { Goal } from "../src/goal.ts"
import { commandRecord, errorRecord, logEnabled, toolErrorRecord, transitionRecord } from "../src/trace.ts"

const AT = 1_792_000_000_000

const goal = (patch: Partial<Goal> = {}): Goal => ({
  objective: "ship it",
  status: "active",
  tokenBudget: null,
  tokensUsed: 120,
  emptyTurns: 0,
  directory: "/repo",
  createdAt: 0,
  updatedAt: 0,
  ...patch,
})

describe("transitionRecord", () => {
  test("a status change records the event, both statuses, the effect, usage, and the note", () => {
    expect(
      transitionRecord("ses_1", { _tag: "Failed", message: "boom" }, goal(), goal({ status: "blocked", note: "Turn failed: boom" }), { _tag: "None" }, AT),
    ).toStrictEqual({
      at: AT,
      kind: "transition",
      sessionID: "ses_1",
      event: "Failed",
      from: "active",
      to: "blocked",
      effect: "None",
      tokensUsed: 120,
      note: "Turn failed: boom",
    })
  })

  test.each([
    ["Set", { _tag: "Set", objective: "new", tokenBudget: 50_000, verify: "bun test", directory: "/repo" }],
    ["Create", { _tag: "Create", objective: "new", tokenBudget: null, verify: null, directory: "/repo" }],
    ["Edit", { _tag: "Edit", objective: "new" }],
  ] as const)("%s records the objective", (_name, event) => {
    expect(transitionRecord("ses_1", event, goal(), goal({ objective: "new" }), { _tag: "None" }, AT)).toMatchObject({
      objective: "new",
    })
  })

  test("a new goal records from as none, and a cleared goal records to as none", () => {
    expect(transitionRecord("ses_1", { _tag: "Edit", objective: "x" }, undefined, undefined, { _tag: "Notify", text: "No goal is set for this session." }, AT)).toStrictEqual({
      at: AT,
      kind: "transition",
      sessionID: "ses_1",
      event: "Edit",
      from: "none",
      to: "none",
      effect: "Notify",
      text: "No goal is set for this session.",
      objective: "x",
    })
    expect(transitionRecord("ses_1", { _tag: "Clear" }, goal(), undefined, { _tag: "Notify", text: "Goal cleared." }, AT)).toMatchObject({
      from: "active",
      to: "none",
    })
  })

  test("a retry records its attempt", () => {
    expect(
      transitionRecord("ses_1", { _tag: "Failed", message: "down", status: 503 }, goal(), goal({ failedTurns: 1 }), { _tag: "Retry", attempt: 1 }, AT),
    ).toStrictEqual({ at: AT, kind: "transition", sessionID: "ses_1", event: "Failed", from: "active", to: "active", effect: "Retry", tokensUsed: 120, status: 503, attempt: 1 })
  })

  test("usage that changes nothing but the count is not recorded", () => {
    expect(transitionRecord("ses_1", { _tag: "Usage", tokens: 10, closing: false }, goal(), goal({ tokensUsed: 130 }), { _tag: "None" }, AT)).toBeUndefined()
  })

  test("usage that crosses the budget is recorded", () => {
    expect(
      transitionRecord("ses_1", { _tag: "Usage", tokens: 10, closing: false }, goal(), goal({ status: "budget_limited", tokensUsed: 130 }), { _tag: "WrapUp" }, AT),
    ).toMatchObject({ event: "Usage", from: "active", to: "budget_limited", effect: "WrapUp" })
  })

  test("a turn that only continues is recorded, so the log shows every turn", () => {
    expect(transitionRecord("ses_1", { _tag: "TurnEnded", activity: true, planning: false }, goal(), goal(), { _tag: "Continue" }, AT)).toMatchObject({
      event: "TurnEnded",
      effect: "Continue",
    })
  })

  test("a change without a new status or effect, such as a move, is recorded", () => {
    expect(transitionRecord("ses_1", { _tag: "Moved", directory: "/other" }, goal(), goal({ directory: "/other" }), { _tag: "None" }, AT)).toStrictEqual({
      at: AT,
      kind: "transition",
      sessionID: "ses_1",
      event: "Moved",
      from: "active",
      to: "active",
      effect: "None",
      tokensUsed: 120,
    })
  })

  test("a note is recorded only when it changes", () => {
    const blocked = goal({ status: "blocked", note: "stuck" })
    expect(transitionRecord("ses_1", { _tag: "Usage", tokens: 5, closing: true }, blocked, { ...blocked, tokensUsed: 125, status: "complete" }, { _tag: "None" }, AT)).toStrictEqual({
      at: AT,
      kind: "transition",
      sessionID: "ses_1",
      event: "Usage",
      from: "blocked",
      to: "complete",
      effect: "None",
      tokensUsed: 125,
    })
    expect(transitionRecord("ses_1", { _tag: "Recovered" }, undefined, goal({ note: "fresh" }), { _tag: "None" }, AT)).toMatchObject({ note: "fresh" })
  })

  test("an event that changes nothing and does nothing is not recorded", () => {
    const same = goal({ status: "paused" })
    expect(transitionRecord("ses_1", { _tag: "TurnEnded", activity: true, planning: false }, same, same, { _tag: "None" }, AT)).toBeUndefined()
  })
})

test("commandRecord keeps the typed text and the parsed result", () => {
  expect(commandRecord("ses_1", "stop", { _tag: "Set", objective: "stop", tokenBudget: null, verify: null }, AT)).toStrictEqual({
    at: AT,
    kind: "command",
    sessionID: "ses_1",
    text: "stop",
    result: "Set",
  })
  expect(commandRecord("ses_1", "--tokens x go", { _tag: "Invalid", message: "bad" }, AT)).toStrictEqual({
    at: AT,
    kind: "command",
    sessionID: "ses_1",
    text: "--tokens x go",
    result: "Invalid",
    message: "bad",
  })
})

test("toolErrorRecord names the tool and the message", () => {
  expect(toolErrorRecord("ses_1", "goal_update", "The goal is paused and cannot move to complete.", AT)).toStrictEqual({
    at: AT,
    kind: "tool_error",
    sessionID: "ses_1",
    tool: "goal_update",
    message: "The goal is paused and cannot move to complete.",
  })
})

test("errorRecord names where it happened", () => {
  expect(errorRecord("recovery", "Error: disk full", AT)).toStrictEqual({ at: AT, kind: "error", where: "recovery", cause: "Error: disk full" })
})

test.each([
  ["on by default", {}, {}, true],
  ["off with the log option", { log: false }, {}, false],
  ["off with OPENCODE_GOAL_LOG=0", {}, { OPENCODE_GOAL_LOG: "0" }, false],
  ["off with OPENCODE_GOAL_LOG=false", {}, { OPENCODE_GOAL_LOG: "false" }, false],
  ["on with OPENCODE_GOAL_LOG=1", {}, { OPENCODE_GOAL_LOG: "1" }, true],
  ["the option wins over the environment", { log: false }, { OPENCODE_GOAL_LOG: "1" }, false],
] as const)("logEnabled: %s", (_name, options, env, expected) => {
  expect(logEnabled(options, env)).toBe(expected)
})
