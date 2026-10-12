type SessionData = { sessionID: string }

export type MeterEvent =
  | { type: "session.step.started"; data: SessionData & { started: number } }
  | { type: "session.step.streamed"; created: number; data: SessionData }
  | { type: "session.step.failed" | "session.execution.interrupted" | "session.execution.failed"; data: SessionData }
  | {
      type: "session.text.delta" | "session.reasoning.delta" | "session.tool.input.delta"
      data: SessionData & { delta: string }
    }
  | { type: "session.step.ended"; data: SessionData & { tokens: { output: number; reasoning: number } } }

export const METER_EVENTS = [
  "session.step.started",
  "session.text.delta",
  "session.reasoning.delta",
  "session.tool.input.delta",
  "session.step.streamed",
  "session.step.ended",
  "session.step.failed",
  "session.execution.interrupted",
  "session.execution.failed",
] as const satisfies ReadonlyArray<MeterEvent["type"]>

// Fails to compile when MeterEvent gains a type that METER_EVENTS does not subscribe to.
const subscribesToEveryEvent: Exclude<MeterEvent["type"], (typeof METER_EVENTS)[number]> extends never ? true : never = true
void subscribesToEveryEvent

type Gauge = {
  startedAt?: number
  firstDeltaAt?: number
  streamedAt?: number
  chars: number
  final?: number
}

export type Meter = Readonly<Record<string, Gauge>>

export type Reading = { tps: number; live: boolean }

const CHARS_PER_TOKEN = 4
// The first deltas arrive in bursts; a shorter window shows wild spikes.
const MIN_LIVE_SECONDS = 0.5

export function record(meter: Meter, event: MeterEvent, now: number): Meter {
  const sessionID = event.data.sessionID
  const gauge = meter[sessionID] ?? { chars: 0 }
  return { ...meter, [sessionID]: advance(gauge, event, now) }
}

function advance(gauge: Gauge, event: MeterEvent, now: number): Gauge {
  switch (event.type) {
    case "session.step.started":
      return { ...idle(gauge.final), startedAt: event.data.started }
    case "session.text.delta":
    case "session.reasoning.delta":
    case "session.tool.input.delta":
      return { ...gauge, firstDeltaAt: gauge.firstDeltaAt ?? now, chars: gauge.chars + event.data.delta.length }
    case "session.step.streamed":
      return { ...gauge, streamedAt: event.created }
    case "session.step.ended": {
      // Same formula and guards as OpenCode's built-in footer: server dispatch time to end of stream.
      if (gauge.startedAt === undefined || gauge.streamedAt === undefined) return idle(gauge.final)
      const tokens = event.data.tokens.output + event.data.tokens.reasoning
      const seconds = (gauge.streamedAt - gauge.startedAt) / 1000
      if (tokens <= 0 || seconds <= 0) return idle(gauge.final)
      return idle(tokens / seconds)
    }
    case "session.step.failed":
    case "session.execution.interrupted":
    case "session.execution.failed":
      return idle(gauge.final)
  }
}

function idle(final: number | undefined): Gauge {
  return { chars: 0, final }
}

export function reading(meter: Meter, sessionID: string, now: number): Reading | undefined {
  const gauge = meter[sessionID]
  if (gauge === undefined) return
  if (gauge.firstDeltaAt !== undefined && gauge.streamedAt === undefined) {
    const seconds = (now - gauge.firstDeltaAt) / 1000
    if (seconds >= MIN_LIVE_SECONDS) return { tps: gauge.chars / CHARS_PER_TOKEN / seconds, live: true }
  }
  if (gauge.final === undefined) return
  return { tps: gauge.final, live: false }
}

export function label(value: Reading) {
  if (value.live) return `~${Math.round(value.tps)} tok/s`
  return `${value.tps.toFixed(1)} tok/s`
}
