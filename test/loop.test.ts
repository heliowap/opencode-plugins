import { expect, test } from "bun:test"
import { LOOP_LIMIT, RESETTING_TOOLS, resetStreak, shellCall, shellCommand, withWarning, type Streaks } from "../src/loop.ts"

test("only shell commands are extracted and trimmed", () => {
  expect(shellCommand("shell", { command: " \n git status \t" })).toEqual("git status")
  expect(shellCommand("shell", { command: " \n " })).toEqual("")
  expect(shellCommand("read", { command: "git status" })).toEqual(undefined)
  for (const input of [undefined, null, "git status", {}, { command: 1 }]) {
    expect(shellCommand("shell", input)).toEqual(undefined)
  }
})

test("a run warns only on its third identical shell command", () => {
  expect(LOOP_LIMIT).toEqual(3)
  const empty: Streaks = new Map()
  const first = shellCall(empty, "one", "git status")
  expect(first).toEqual({ streaks: new Map([["one", { command: "git status", count: 1 }]]), warn: false })
  const second = shellCall(first.streaks, "one", "git status")
  expect(second).toEqual({ streaks: new Map([["one", { command: "git status", count: 2 }]]), warn: false })
  const third = shellCall(second.streaks, "one", "git status")
  expect(third).toEqual({ streaks: new Map([["one", { command: "git status", count: 3 }]]), warn: true })
  expect(shellCall(third.streaks, "one", "git status")).toEqual({ streaks: new Map([["one", { command: "git status", count: 4 }]]), warn: false })
  expect(shellCall(third.streaks, "one", "git diff")).toEqual({ streaks: new Map([["one", { command: "git diff", count: 1 }]]), warn: false })
  expect(empty).toEqual(new Map())
  expect(first.streaks).toEqual(new Map([["one", { command: "git status", count: 1 }]]))
})

test("whitespace-only differences in tool inputs continue the same run", () => {
  const first = shellCommand("shell", { command: "git status" })!
  const second = shellCommand("shell", { command: " \ngit status \t" })!
  expect(shellCall(shellCall(new Map(), "one", first).streaks, "one", second)).toEqual({
    streaks: new Map([["one", { command: "git status", count: 2 }]]), warn: false,
  })
})

test("sessions have separate streaks and resetting clears only the chosen session", () => {
  const streaks: Streaks = new Map([["one", { command: "pwd", count: 2 }]])
  const other = shellCall(streaks, "two", "pwd")
  expect(other).toEqual({ streaks: new Map([
    ["one", { command: "pwd", count: 2 }], ["two", { command: "pwd", count: 1 }],
  ]), warn: false })
  const reset = resetStreak(other.streaks, "one")
  expect(reset).toEqual(new Map([["two", { command: "pwd", count: 1 }]]))
  expect(shellCall(reset, "one", "pwd")).toEqual({ streaks: new Map([
    ["two", { command: "pwd", count: 1 }], ["one", { command: "pwd", count: 1 }],
  ]), warn: false })
  expect(resetStreak(reset, "missing")).toEqual(new Map([["two", { command: "pwd", count: 1 }]]))
  expect(other.streaks).toEqual(new Map([
    ["one", { command: "pwd", count: 2 }], ["two", { command: "pwd", count: 1 }],
  ]))
})

test("only file changes and subagent dispatches reset streaks, not reads or turns", () => {
  expect(RESETTING_TOOLS).toEqual(new Set(["write", "edit", "patch", "apply_patch", "subagent"]))
})

test("warnings append to strings or content parts without losing tool output", () => {
  expect(withWarning("output", "stop polling")).toEqual("output\n\nstop polling")
  const content = [{ type: "text", text: "output" }, { type: "file", uri: "file:///plot.png", mime: "image/png" }] as const
  expect(withWarning(content, "stop polling")).toEqual([
    { type: "text", text: "output" }, { type: "file", uri: "file:///plot.png", mime: "image/png" }, { type: "text", text: "stop polling" },
  ])
  expect(content).toEqual([{ type: "text", text: "output" }, { type: "file", uri: "file:///plot.png", mime: "image/png" }])
  expect(withWarning([], "stop polling")).toEqual([{ type: "text", text: "stop polling" }])
})
