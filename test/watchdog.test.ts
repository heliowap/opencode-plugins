import { expect, test } from "bun:test"
import { DEFAULT_STALL_MS, stallDelay, tickInterval, watch, watchEventOf, type Children } from "../src/watchdog.ts"

test("stall setting accepts only finite positive numbers", () => {
  expect(DEFAULT_STALL_MS).toEqual(600_000)
  for (const option of [undefined, null, 0, -1, Infinity, -Infinity, NaN, "x", "1500"]) {
    expect(stallDelay(option)).toEqual(600_000)
  }
  expect(stallDelay(1500)).toEqual(1500)
  expect(stallDelay(0.5)).toEqual(0.5)
})

test.each([[100, 50], [1500, 375], [1503, 375], [600_000, 60_000]])(
  "tick interval for %p ms is %p ms", (stallMs, expected) => {
    expect(tickInterval(stallMs)).toEqual(expected)
  },
)

test("a child starts idle, then stalls exactly at the threshold once", () => {
  const empty: Children = new Map()
  const created = watch(empty, { _tag: "Created", sessionID: "child", parentID: "parent" }, 10, 1500)
  expect(created).toEqual({
    children: new Map([["child", { parentID: "parent", running: false, lastActivity: 10, openCalls: new Set() }]]), stalls: [],
  })
  expect(empty).toEqual(new Map())
  expect(watch(created.children, { _tag: "Tick" }, 10_000, 1500).stalls).toEqual([])
  const started = watch(created.children, { _tag: "Started", sessionID: "child" }, 100, 1500)
  expect(started).toEqual({
    children: new Map([["child", { parentID: "parent", running: true, lastActivity: 100, openCalls: new Set() }]]), stalls: [],
  })
  expect(watch(started.children, { _tag: "Tick" }, 1599, 1500).stalls).toEqual([])
  const stalled = watch(started.children, { _tag: "Tick" }, 1600, 1500)
  expect(stalled).toEqual({
    children: new Map([["child", { parentID: "parent", running: false, lastActivity: 100, openCalls: new Set() }]]),
    stalls: [{ sessionID: "child", parentID: "parent", idleMs: 1500 }],
  })
  expect(watch(stalled.children, { _tag: "Tick" }, 2000, 1500).stalls).toEqual([])
  expect(started.children).toEqual(new Map([["child", { parentID: "parent", running: true, lastActivity: 100, openCalls: new Set() }]]))
})

test("activity refreshes the clock without changing calls or running status", () => {
  const children: Children = new Map([["child", { parentID: "parent", running: true, lastActivity: 10, openCalls: new Set(["call"]) }]])
  expect(watch(children, { _tag: "Activity", sessionID: "child" }, 100, 1500)).toEqual({
    children: new Map([["child", { parentID: "parent", running: true, lastActivity: 100, openCalls: new Set(["call"]) }]]), stalls: [],
  })
  expect(children).toEqual(new Map([["child", { parentID: "parent", running: true, lastActivity: 10, openCalls: new Set(["call"]) }]]))
})

test("all open tools must settle before a silent running child can stall", () => {
  const children: Children = new Map([["child", { parentID: "parent", running: true, lastActivity: 0, openCalls: new Set(["first"]) }]])
  const called = watch(children, { _tag: "ToolCalled", sessionID: "child", callID: "second" }, 100, 1500)
  expect(called).toEqual({
    children: new Map([["child", { parentID: "parent", running: true, lastActivity: 100, openCalls: new Set(["first", "second"]) }]]), stalls: [],
  })
  expect(watch(called.children, { _tag: "Tick" }, 10_000, 1500).stalls).toEqual([])
  const firstSettled = watch(called.children, { _tag: "ToolSettled", sessionID: "child", callID: "first" }, 10_000, 1500)
  expect(firstSettled).toEqual({
    children: new Map([["child", { parentID: "parent", running: true, lastActivity: 10_000, openCalls: new Set(["second"]) }]]), stalls: [],
  })
  expect(watch(firstSettled.children, { _tag: "Tick" }, 20_000, 1500).stalls).toEqual([])
  const settled = watch(firstSettled.children, { _tag: "ToolSettled", sessionID: "child", callID: "second" }, 20_000, 1500)
  expect(settled).toEqual({
    children: new Map([["child", { parentID: "parent", running: true, lastActivity: 20_000, openCalls: new Set() }]]), stalls: [],
  })
  expect(watch(settled.children, { _tag: "Tick" }, 21_499, 1500).stalls).toEqual([])
  expect(watch(settled.children, { _tag: "Tick" }, 21_501, 1500).stalls).toEqual([{ sessionID: "child", parentID: "parent", idleMs: 1501 }])
  expect(children).toEqual(new Map([["child", { parentID: "parent", running: true, lastActivity: 0, openCalls: new Set(["first"]) }]]))
  expect(called.children).toEqual(new Map([["child", { parentID: "parent", running: true, lastActivity: 100, openCalls: new Set(["first", "second"]) }]]))
})

test("ending clears calls, restarting refreshes activity, and deleting untracks only that child", () => {
  const children: Children = new Map([
    ["child", { parentID: "parent", running: true, lastActivity: 10, openCalls: new Set(["call"]) }],
    ["other", { parentID: "another", running: true, lastActivity: 50, openCalls: new Set() }],
  ])
  const ended = watch(children, { _tag: "Ended", sessionID: "child" }, 100, 1500)
  expect(ended).toEqual({ children: new Map([
    ["child", { parentID: "parent", running: false, lastActivity: 10, openCalls: new Set() }],
    ["other", { parentID: "another", running: true, lastActivity: 50, openCalls: new Set() }],
  ]), stalls: [] })
  expect(watch(children, { _tag: "Started", sessionID: "child" }, 200, 1500)).toEqual({ children: new Map([
    ["child", { parentID: "parent", running: true, lastActivity: 200, openCalls: new Set() }],
    ["other", { parentID: "another", running: true, lastActivity: 50, openCalls: new Set() }],
  ]), stalls: [] })
  expect(watch(children, { _tag: "Deleted", sessionID: "child" }, 300, 1500)).toEqual({
    children: new Map([["other", { parentID: "another", running: true, lastActivity: 50, openCalls: new Set() }]]), stalls: [],
  })
})

test("events for an untracked session preserve the same map", () => {
  const children: Children = new Map([["other", { parentID: "parent", running: false, lastActivity: 10, openCalls: new Set() }]])
  for (const event of [
    { _tag: "Started", sessionID: "missing" }, { _tag: "Activity", sessionID: "missing" },
    { _tag: "ToolCalled", sessionID: "missing", callID: "call" }, { _tag: "ToolSettled", sessionID: "missing", callID: "call" },
    { _tag: "Ended", sessionID: "missing" }, { _tag: "Deleted", sessionID: "missing" },
  ] as const) {
    const result = watch(children, event, 100, 1500)
    expect(result).toEqual({ children: new Map([["other", { parentID: "parent", running: false, lastActivity: 10, openCalls: new Set() }]]), stalls: [] })
    expect(result.children).toBe(children)
  }
})

test("only children created in this directory are tracked", () => {
  expect(watchEventOf({ type: "session.created", data: { sessionID: "child", parentID: "parent", location: { directory: "/repo" } } }, "/repo"))
    .toEqual({ _tag: "Created", sessionID: "child", parentID: "parent" })
  for (const data of [
    { sessionID: "child", parentID: "parent", location: { directory: "/elsewhere" } },
    { sessionID: "child", location: { directory: "/repo" } },
    { sessionID: "child", parentID: 1, location: { directory: "/repo" } },
    { sessionID: "child", parentID: "parent" },
    { sessionID: "child", parentID: "parent", location: null },
  ]) expect(watchEventOf({ type: "session.created", data }, "/repo")).toEqual(undefined)
})

test.each([
  ["session.execution.started", { _tag: "Started", sessionID: "child" }],
  ["session.execution.succeeded", { _tag: "Ended", sessionID: "child" }],
  ["session.execution.failed", { _tag: "Ended", sessionID: "child" }],
  ["session.execution.interrupted", { _tag: "Ended", sessionID: "child" }],
  ["session.tool.called", { _tag: "ToolCalled", sessionID: "child", callID: "call" }],
  ["session.tool.success", { _tag: "ToolSettled", sessionID: "child", callID: "call" }],
  ["session.tool.failed", { _tag: "ToolSettled", sessionID: "child", callID: "call" }],
  ["session.deleted", { _tag: "Deleted", sessionID: "child" }],
  ["session.text.delta", { _tag: "Activity", sessionID: "child" }],
  ["session.tool.progress", { _tag: "Activity", sessionID: "child" }],
  ["future.event", { _tag: "Activity", sessionID: "child" }],
] as const)("maps %s to a watchdog event", (type, expected) => {
  expect(watchEventOf({ type, data: { sessionID: "child", id: "call", callID: "not-the-id" } }, "/repo")).toEqual(expected)
})

test("events without a string session id or tool call id are ignored", () => {
  for (const data of [undefined, null, "x", {}, { sessionID: 1 }]) {
    expect(watchEventOf({ type: "session.execution.started", data }, "/repo")).toEqual(undefined)
  }
  for (const type of ["session.tool.called", "session.tool.success", "session.tool.failed"]) {
    for (const id of [undefined, 1]) {
      expect(watchEventOf({ type, data: { sessionID: "child", id } }, "/repo")).toEqual(undefined)
    }
  }
})
