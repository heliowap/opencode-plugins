import { expect, test } from "bun:test"
import { editedObjective, goalBadge, objectiveLines } from "../src/badge.ts"
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

test.each([
  ["an active goal with a turn running", goal(), true, { text: "◐ goal running · 12K / 50K", tone: "accent" }],
  ["an active goal between turns", goal(), false, { text: "◎ goal active · 12K / 50K", tone: "muted" }],
  ["an active goal without a budget", goal({ tokenBudget: null, tokensUsed: 1_500 }), true, { text: "◐ goal running · 1.5K", tone: "accent" }],
  ["a paused goal", goal({ status: "paused" }), false, { text: "⏸ goal paused", tone: "warning" }],
  ["a paused goal while its last turn finishes", goal({ status: "paused" }), true, { text: "⏸ goal paused", tone: "warning" }],
  ["a blocked goal", goal({ status: "blocked" }), false, { text: "⚠ goal blocked", tone: "error" }],
  ["a goal over budget", goal({ status: "budget_limited", tokensUsed: 52_000 }), false, { text: "goal budget reached · 52K / 50K", tone: "warning" }],
] as const)("%s", (_name, input, running, expected) => {
  expect(goalBadge(input, running, 0)).toEqual(expected)
})

test("a complete goal shows nothing, and neither does a session without a goal", () => {
  expect(goalBadge(goal({ status: "complete" }), false, 0)).toBeUndefined()
  expect(goalBadge(undefined, true, 0)).toBeUndefined()
  expect(goalBadge(goal(), false, 0)).toEqual({ text: "◎ goal active · 12K / 50K", tone: "muted" })
})

test("a running goal cycles through the quarter-circle frames", () => {
  const glyphs = [0, 1, 2, 3, 4].map((frame) => goalBadge(goal(), true, frame)?.text.split(" ")[0])
  expect(glyphs).toEqual(["◐", "◓", "◑", "◒", "◐"])
})

test("only a running goal animates", () => {
  expect(goalBadge(goal(), false, 2)).toEqual({ text: "◎ goal active · 12K / 50K", tone: "muted" })
  expect(goalBadge(goal({ status: "paused" }), true, 2)).toEqual({ text: "⏸ goal paused", tone: "warning" })
})

test.each([
  ["a short objective", "ship it", 10, ["ship it"]],
  ["whitespace and line breaks collapse", "fix\n\n  the   login", 20, ["fix the login"]],
  ["surrounding whitespace is dropped", "  ship it \n", 20, ["ship it"]],
  ["words wrap at the width", "make the checkout suite pass", 10, ["make the", "checkout", "suite pass"]],
  ["exactly three lines keep no ellipsis", "one two three four five six", 10, ["one two", "three four", "five six"]],
  ["a fourth line ends the third with an ellipsis", "one two three four five six seven", 10, ["one two", "three four", "five six…"]],
  ["a full third line is cut to fit the ellipsis", "aaaa bbbb cccc dddd eeee ffff gggg", 9, ["aaaa bbbb", "cccc dddd", "eeee fff…"]],
  ["a word longer than the width breaks", "abcdefghij", 5, ["abcde", "fghij"]],
] as const)("objectiveLines: %s", (_name, objective, width, expected) => {
  expect(objectiveLines(goal({ objective }), width)).toEqual([...expected])
})

test("objectiveLines shows paused and blocked goals and hides complete ones and missing goals", () => {
  expect(objectiveLines(goal({ status: "paused" }), 10)).toEqual(["ship it"])
  expect(objectiveLines(goal({ status: "blocked" }), 10)).toEqual(["ship it"])
  expect(objectiveLines(goal({ status: "complete" }), 10)).toBeUndefined()
  expect(objectiveLines(undefined, 10)).toBeUndefined()
})

test.each([
  ["a changed objective, trimmed", "ship it", "  ship it today \n", "ship it today"],
  ["unchanged text", "ship it", "ship it", undefined],
  ["unchanged apart from surrounding whitespace", " ship it ", "ship it", undefined],
  ["an emptied editor", "ship it", "  \n ", undefined],
] as const)("editedObjective: %s", (_name, original, text, expected) => {
  expect(editedObjective(original, text)).toBe(expected)
})
