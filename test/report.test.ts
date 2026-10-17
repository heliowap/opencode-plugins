import { expect, test } from "bun:test"
import { summarize } from "../src/report.ts"

const T = Date.UTC(2026, 9, 17, 12, 0, 0)

const lines = [
  { at: T, _tag: "Command", sessionID: "ses_a", text: "fix the login", result: "Set" },
  { at: T + 1_000, _tag: "Transition", sessionID: "ses_a", event: "Set", from: "none", to: "active", effect: "Continue", tokensUsed: 0, objective: "fix the login" },
  { at: T + 2_000, _tag: "ToolError", sessionID: "ses_a", tool: "goal_update", message: "The goal is paused and cannot move to complete." },
  { at: T + 3_000, _tag: "Command", sessionID: "ses_a", text: "edit", result: "Invalid", message: "Write the new objective after /goal edit." },
  { at: T + 4_000, _tag: "Transition", sessionID: "ses_a", event: "Failed", from: "active", to: "blocked", effect: "None", tokensUsed: 900, note: "Turn failed: boom" },
  { at: T + 4_200, _tag: "Error", sessionID: "ses_a", where: "session.step.ended", cause: "Error: boom" },
  { at: T + 4_500, _tag: "Command", sessionID: "ses_a", text: "pause", result: "Pause" },
  { at: T + 5_000, _tag: "Transition", sessionID: "ses_b", event: "Set", from: "none", to: "active", effect: "Continue", tokensUsed: 0, objective: "x" },
  { at: T + 6_000, _tag: "Error", where: "recovery", cause: "Error: disk full" },
].map((record) => JSON.stringify(record))

test("without a session, one row per session with its last status and problems, then errors outside sessions", () => {
  expect(summarize([...lines, "not json"])).toBe(
    [
      "ses_a  blocked  7 records  3 commands (1 refused)  1 tool errors  1 errors  last 2026-10-17T12:00:04.500Z",
      "ses_b  active  1 records  0 commands (0 refused)  0 tool errors  0 errors  last 2026-10-17T12:00:05.000Z",
      "1 errors outside sessions, last 2026-10-17T12:00:06.000Z: recovery failed: Error: disk full",
    ].join("\n"),
  )
})

test("with a session, its timeline in order", () => {
  expect(summarize(lines, "ses_a")).toBe(
    [
      "2026-10-17T12:00:00.000Z  /goal fix the login -> Set",
      "2026-10-17T12:00:01.000Z  Set: none -> active [Continue] objective: fix the login",
      "2026-10-17T12:00:02.000Z  goal_update failed: The goal is paused and cannot move to complete.",
      "2026-10-17T12:00:03.000Z  /goal edit -> Invalid: Write the new objective after /goal edit.",
      "2026-10-17T12:00:04.000Z  Failed: active -> blocked [None] note: Turn failed: boom",
      "2026-10-17T12:00:04.200Z  session.step.ended failed: Error: boom",
      "2026-10-17T12:00:04.500Z  /goal pause -> Pause",
    ].join("\n"),
  )
})

test("long objectives and notes are cut to 120 characters", () => {
  const long = JSON.stringify({ at: T, _tag: "Transition", sessionID: "s", event: "Edit", from: "active", to: "active", effect: "ObjectiveUpdated", objective: "y".repeat(200) })
  expect(summarize([long], "s")).toBe(`2026-10-17T12:00:00.000Z  Edit: active -> active [ObjectiveUpdated] objective: ${"y".repeat(119)}…`)
})

test("an empty log or an unknown session says so", () => {
  expect(summarize([])).toBe("The goal log is empty.")
  expect(summarize(lines, "ses_missing")).toBe("No records for ses_missing.")
})

test("a session without transitions shows unknown, and a log without loose errors has no error row", () => {
  expect(summarize([JSON.stringify({ at: T, _tag: "Command", sessionID: "s", text: "", result: "Status" })])).toBe(
    "s  unknown  1 records  1 commands (0 refused)  0 tool errors  0 errors  last 2026-10-17T12:00:00.000Z",
  )
})

test("a transition without objective or note shows only the move, and 120 characters stay whole", () => {
  const turn = JSON.stringify({ at: T, _tag: "Transition", sessionID: "s", event: "TurnEnded", from: "active", to: "active", effect: "Continue" })
  const exact = JSON.stringify({ at: T, _tag: "Transition", sessionID: "s", event: "Edit", from: "active", to: "active", effect: "None", objective: "z".repeat(120) })
  expect(summarize([turn, exact], "s")).toBe(
    [
      "2026-10-17T12:00:00.000Z  TurnEnded: active -> active [Continue]",
      `2026-10-17T12:00:00.000Z  Edit: active -> active [None] objective: ${"z".repeat(120)}`,
    ].join("\n"),
  )
})
