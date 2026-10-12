import { describe, expect, test } from "bun:test"
import { label, record, reading, type Meter } from "../src/meter.ts"

const session = "ses_a"

function run(events: Array<[number, Parameters<typeof record>[1]]>) {
  return events.reduce<Meter>((meter, [now, event]) => record(meter, event, now), {})
}

describe("reading", () => {
  test("estimates live speed from streamed characters at four per token", () => {
    const meter = run([
      [1000, { type: "session.step.started", data: { sessionID: session, started: 1000 } }],
      [1500, { type: "session.text.delta", data: { sessionID: session, delta: "a".repeat(40) } }],
      [2000, { type: "session.reasoning.delta", data: { sessionID: session, delta: "b".repeat(40) } }],
    ])
    expect(reading(meter, session, 2500)).toEqual({ tps: 20, live: true })
  })

  test("waits half a second of streaming before showing a live estimate", () => {
    const meter = run([
      [1000, { type: "session.step.started", data: { sessionID: session, started: 1000 } }],
      [1500, { type: "session.text.delta", data: { sessionID: session, delta: "a".repeat(40) } }],
    ])
    expect(reading(meter, session, 1700)).toBeUndefined()
    expect(reading(meter, session, 2000)).toEqual({ tps: 20, live: true })
  })

  test.each(["session.step.failed", "session.execution.interrupted", "session.execution.failed"] as const)(
    "falls back to the last finished step after %s",
    (type) => {
      const meter = run([
        [1000, { type: "session.step.started", data: { sessionID: session, started: 1000 } }],
        [1500, { type: "session.text.delta", data: { sessionID: session, delta: "a".repeat(400) } }],
        [3000, { type: "session.step.streamed", created: 3000, data: { sessionID: session } }],
        [3100, { type: "session.step.ended", data: { sessionID: session, tokens: { output: 60, reasoning: 0 } } }],
        [4000, { type: "session.step.started", data: { sessionID: session, started: 4000 } }],
        [4500, { type: "session.text.delta", data: { sessionID: session, delta: "a".repeat(40) } }],
        [5000, { type, data: { sessionID: session } }],
      ])
      expect(reading(meter, session, 9000)).toEqual({ tps: 30, live: false })
    },
  )

  test("reports the provider's output and reasoning tokens from the server's dispatch time to the end of the stream", () => {
    const meter = run([
      [1000, { type: "session.step.started", data: { sessionID: session, started: 0 } }],
      [1500, { type: "session.text.delta", data: { sessionID: session, delta: "a".repeat(400) } }],
      [3000, { type: "session.step.streamed", created: 3000, data: { sessionID: session } }],
      [3100, { type: "session.step.ended", data: { sessionID: session, tokens: { output: 50, reasoning: 10 } } }],
    ])
    expect(reading(meter, session, 9000)).toEqual({ tps: 20, live: false })
  })
})

describe("label", () => {
  test("marks a live estimate with a tilde and rounds it to whole tokens", () => {
    expect(label({ tps: 41.6, live: true })).toBe("~42 tok/s")
  })

  test("shows a finished step with one decimal like the built-in footer", () => {
    expect(label({ tps: 38.04, live: false })).toBe("38.0 tok/s")
  })
})
