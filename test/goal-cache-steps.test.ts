import { expect, test } from "bun:test"
import { activeStepIds } from "../evidence/goal-cache-steps.ts"

test("includes steps started while the goal was active, even when a tool completes it", () => {
  const events = [
    { type: "rpc.goal.changed", data: { sessionID: "target", goal: { status: "active" } } },
    { type: "session.step.started", data: { sessionID: "target", assistantMessageID: "read" } },
    { type: "session.step.ended", data: { sessionID: "target", assistantMessageID: "read" } },
    { type: "rpc.goal.changed", data: { sessionID: "other", goal: { status: "complete" } } },
    { type: "session.step.started", data: { sessionID: "target", assistantMessageID: "complete" } },
    { type: "rpc.goal.changed", data: { sessionID: "target", goal: { status: "complete" } } },
    { type: "session.step.ended", data: { sessionID: "target", assistantMessageID: "complete" } },
    { type: "session.step.started", data: { sessionID: "target", assistantMessageID: "after" } },
    { type: "session.step.ended", data: { sessionID: "target", assistantMessageID: "after" } },
  ]

  expect([...activeStepIds(events, "target")]).toEqual(["read", "complete"])
})
