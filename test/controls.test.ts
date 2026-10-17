import { expect, test } from "bun:test"
import { budgetEvent, controlsFor, type Control, verifyEvent } from "../src/controls.ts"
import type { Goal } from "../src/goal.ts"

const goal = (overrides: Partial<Goal> = {}): Goal => ({
  objective: "ship it",
  status: "active",
  tokenBudget: 50_000,
  tokensUsed: 12_000,
  emptyTurns: 0,
  directory: "/repo",
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
})

test("active goals expose pause and all settings in order", () => {
  expect(controlsFor(goal())).toEqual([
    { id: "pause", title: "Pause goal" },
    { id: "edit", title: "Edit objective" },
    { id: "budget", title: "Token budget", description: "12K of 50K", value: "50000" },
    { id: "verify", title: "Verify command", description: "none", value: "" },
    { id: "clear", title: "Clear goal" },
  ])
})

test.each([
  ["paused", goal({ status: "paused" }), true],
  ["blocked", goal({ status: "blocked" }), true],
  ["paused over budget", goal({ status: "paused", tokensUsed: 50_000 }), false],
  ["blocked over budget", goal({ status: "blocked", tokensUsed: 50_000 }), false],
] as const)("resume eligibility: %s", (_name, input, canResume) => {
  expect(controlsFor(input).some((control) => control.id === "resume")).toBe(canResume)
})

test("paused and blocked controls omit pause and preserve the resume title", () => {
  const expected: readonly Control[] = [
    { id: "resume", title: "Resume goal" },
    { id: "edit", title: "Edit objective" },
    { id: "budget", title: "Token budget", description: "12K of 50K", value: "50000" },
    { id: "verify", title: "Verify command", description: "none", value: "" },
    { id: "clear", title: "Clear goal" },
  ]
  expect(controlsFor(goal({ status: "paused" }))).toEqual(expected)
  expect(controlsFor(goal({ status: "blocked" }))).toEqual(expected)
})

test("unlimited budgets and configured verification show their values", () => {
  expect(controlsFor(goal({ tokenBudget: null, tokensUsed: 1_500, verify: "bun test" }))).toEqual([
    { id: "pause", title: "Pause goal" },
    { id: "edit", title: "Edit objective" },
    { id: "budget", title: "Token budget", description: "1.5K used, no limit", value: "" },
    { id: "verify", title: "Verify command", description: "bun test", value: "bun test" },
    { id: "clear", title: "Clear goal" },
  ])
  expect(controlsFor(goal({ status: "complete" }))).toEqual([])
})

test.each([
  ["50K", { _tag: "Budget", tokenBudget: 50_000 }],
  [" 1.5M ", { _tag: "Budget", tokenBudget: 1_500_000 }],
  ["0", undefined],
  ["abc", undefined],
  ["", { _tag: "Budget", tokenBudget: null }],
] as const)("budgetEvent parses %j", (text, expected) => {
  expect(budgetEvent(text)).toEqual(expected)
})

test.each([
  ["  bun test  ", { _tag: "Verify", verify: "bun test" }],
  ["", { _tag: "Verify", verify: null }],
] as const)("verifyEvent trims %j", (text, expected) => {
  expect(verifyEvent(text)).toEqual(expected)
})
