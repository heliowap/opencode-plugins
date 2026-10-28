type SessionData = { sessionID: string }

export type MeterEvent =
  | { type: "session.step.started"; data: SessionData & { started: number } }
  | { type: "session.step.streamed"; created: number; data: SessionData }
  | {
      type:
        | "session.execution.started"
        | "session.step.failed"
        | "session.execution.interrupted"
        | "session.execution.failed"
      data: SessionData
    }
  | {
      type: "session.text.delta" | "session.reasoning.delta" | "session.tool.input.delta"
      data: SessionData & { delta: string }
    }
  | { type: "session.step.ended"; data: SessionData & { tokens: { output: number; reasoning: number } } }

export const METER_EVENTS = [
  "session.execution.started",
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

type Step = { startedAt: number; streamedAt?: number; firstDeltaAt?: number; chars: number }

type Totals = { tokens: number; ms: number }

// `turn` is undefined once a step of the current execution has no stream end; the built-in footer shows nothing then.
type Gauge = { step?: Step; turn?: Totals; final?: number }

export type Meter = Readonly<Record<string, Gauge>>

export type Reading = { tps: number; live: boolean }

const CHARS_PER_TOKEN = 4
// The first deltas arrive in bursts; a shorter window shows wild spikes.
const MIN_LIVE_SECONDS = 0.5
const NO_STEPS: Totals = { tokens: 0, ms: 0 }

export function record(meter: Meter, event: MeterEvent, now: number): Meter {
  const sessionID = event.data.sessionID
  const gauge = meter[sessionID] ?? { turn: NO_STEPS }
  return { ...meter, [sessionID]: advance(gauge, event, now) }
}

function advance(gauge: Gauge, event: MeterEvent, now: number): Gauge {
  const step = gauge.step
  switch (event.type) {
    case "session.execution.started":
      return { final: gauge.final, turn: NO_STEPS }
    case "session.step.started":
      return { ...gauge, step: { startedAt: event.data.started, chars: 0 } }
    case "session.text.delta":
    case "session.reasoning.delta":
    case "session.tool.input.delta":
      if (step === undefined) return gauge
      return {
        ...gauge,
        step: { ...step, firstDeltaAt: step.firstDeltaAt ?? now, chars: step.chars + event.data.delta.length },
      }
    case "session.step.streamed":
      if (step === undefined) return gauge
      return { ...gauge, step: { ...step, streamedAt: event.created } }
    case "session.step.ended": {
      // Same rule as OpenCode's built-in footer: output plus reasoning tokens of every step since the
      // execution started, over the sum of each step's dispatch-to-end-of-stream time.
      const turn =
        gauge.turn === undefined || step?.streamedAt === undefined
          ? undefined
          : {
              tokens: gauge.turn.tokens + event.data.tokens.output + event.data.tokens.reasoning,
              ms: gauge.turn.ms + Math.max(0, step.streamedAt - step.startedAt),
            }
      return { turn, final: turn && turn.tokens > 0 && turn.ms > 0 ? turn.tokens / (turn.ms / 1000) : gauge.final }
    }
    case "session.step.failed":
      return { final: gauge.final }
    case "session.execution.interrupted":
    case "session.execution.failed":
      return { turn: gauge.turn, final: gauge.final }
  }
}

export function reading(meter: Meter, sessionID: string, now: number): Reading | undefined {
  const gauge = meter[sessionID]
  if (gauge === undefined) return
  const step = gauge.step
  if (step?.firstDeltaAt !== undefined && step.streamedAt === undefined) {
    const seconds = (now - step.firstDeltaAt) / 1000
    if (seconds >= MIN_LIVE_SECONDS) return { tps: step.chars / CHARS_PER_TOKEN / seconds, live: true }
  }
  if (gauge.final === undefined) return
  return { tps: gauge.final, live: false }
}

export function label(value: Reading) {
  if (value.live) return `~${Math.round(value.tps)} tok/s`
  return `${value.tps.toFixed(1)} tok/s`
}
