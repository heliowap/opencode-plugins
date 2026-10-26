import { expect, test } from "bun:test"
import { LOOP_LIMIT, MUTATING_TOOLS, RESETTING_TOOLS, loopStep, shellCommand, withWarning, type Streaks } from "../src/loop.ts"

const shell = (command: string) => ({ command })

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
  const first = loopStep(empty, "one", "shell", shell("git status"))
  expect(first).toEqual({ streaks: new Map([["one", { command: "git status", count: 1 }]]), warn: false })
  const second = loopStep(first.streaks, "one", "shell", shell("git status"))
  expect(second).toEqual({ streaks: new Map([["one", { command: "git status", count: 2 }]]), warn: false })
  const third = loopStep(second.streaks, "one", "shell", shell("git status"))
  expect(third).toEqual({ streaks: new Map([["one", { command: "git status", count: 3 }]]), warn: true })
  expect(loopStep(third.streaks, "one", "shell", shell("git status"))).toEqual({
    streaks: new Map([["one", { command: "git status", count: 4 }]]), warn: false,
  })
  expect(loopStep(third.streaks, "one", "shell", shell("git diff"))).toEqual({
    streaks: new Map([["one", { command: "git diff", count: 1 }]]), warn: false,
  })
  expect(empty).toEqual(new Map())
  expect(first.streaks).toEqual(new Map([["one", { command: "git status", count: 1 }]]))
})

test("whitespace-only differences in shell commands continue the same run", () => {
  const first = loopStep(new Map(), "one", "shell", shell("git status"))
  expect(loopStep(first.streaks, "one", "shell", shell(" \ngit status \t"))).toEqual({
    streaks: new Map([["one", { command: "git status", count: 2 }]]), warn: false,
  })
})

test("sessions have separate streaks, and a reset clears only the chosen session", () => {
  const streaks: Streaks = new Map([["one", { command: "pwd", count: 2 }]])
  const other = loopStep(streaks, "two", "shell", shell("pwd"))
  expect(other).toEqual({ streaks: new Map([
    ["one", { command: "pwd", count: 2 }], ["two", { command: "pwd", count: 1 }],
  ]), warn: false })
  const reset = loopStep(other.streaks, "one", "subagent", {})
  expect(reset).toEqual({ streaks: new Map([["two", { command: "pwd", count: 1 }]]), warn: false })
  expect(loopStep(reset.streaks, "one", "shell", shell("pwd"))).toEqual({ streaks: new Map([
    ["two", { command: "pwd", count: 1 }], ["one", { command: "pwd", count: 1 }],
  ]), warn: false })
  expect(other.streaks).toEqual(new Map([
    ["one", { command: "pwd", count: 2 }], ["two", { command: "pwd", count: 1 }],
  ]))
})

test("the single source of truth lists file changes, and subagent dispatches also reset", () => {
  expect(MUTATING_TOOLS).toEqual(new Set(["write", "edit", "patch", "apply_patch"]))
  expect(RESETTING_TOOLS).toEqual(new Set(["write", "edit", "patch", "apply_patch", "subagent"]))
})

test("file changes and subagent dispatches reset a streak, reads and searches do not", () => {
  const streaks: Streaks = new Map([["one", { command: "pwd", count: 2 }]])
  for (const tool of ["write", "edit", "patch", "apply_patch", "subagent"]) {
    expect(loopStep(streaks, "one", tool, {})).toEqual({ streaks: new Map(), warn: false })
  }
  for (const tool of ["read", "grep", "glob", "webfetch"]) {
    expect(loopStep(streaks, "one", tool, {})).toEqual({ streaks, warn: false })
  }
})

test("a non-shell tool with a command input is not a shell call", () => {
  const streaks: Streaks = new Map([["one", { command: "git status", count: 2 }]])
  expect(loopStep(streaks, "one", "read", { command: "git status" })).toEqual({ streaks, warn: false })
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

test("a completed result with no content carries the warning alone", () => {
  expect(withWarning(undefined, "stop polling")).toEqual("stop polling")
})
