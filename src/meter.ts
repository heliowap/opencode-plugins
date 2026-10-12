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
  return { ...meter, [sessionID]: next(gauge, event, now) }
}

function next(gauge: Gauge, event: MeterEvent, now: number): Gauge {
  switch (event.type) {
    case "session.step.started":
      return { startedAt: event.data.started, chars: 0, final: gauge.final }
    case "session.text.delta":
    case "session.reasoning.delta":
    case "session.tool.input.delta":
      return { ...gauge, firstDeltaAt: gauge.firstDeltaAt ?? now, chars: gauge.chars + event.data.delta.length }
    case "session.step.streamed":
      return { ...gauge, streamedAt: event.created }
    case "session.step.ended": {
      // Same formula as OpenCode's built-in footer: server dispatch time to end of stream.
      if (gauge.startedAt === undefined || gauge.streamedAt === undefined) return gauge
      const tokens = event.data.tokens.output + event.data.tokens.reasoning
      return { chars: 0, final: tokens / ((gauge.streamedAt - gauge.startedAt) / 1000) }
    }
    case "session.step.failed":
    case "session.execution.interrupted":
    case "session.execution.failed":
      return { chars: 0, final: gauge.final }
  }
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

export function label(reading: Reading) {
  if (reading.live) return `~${Math.round(reading.tps)} tok/s`
  return `${reading.tps.toFixed(1)} tok/s`
}
