/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { createSignal, Show } from "solid-js"
import { label, reading, record, type Meter, type MeterEvent, type Reading } from "./meter.ts"

const EVENTS = [
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

const TICK_MS = 250

export default Plugin.define({
  id: "tps.meter",
  setup(context) {
    const [meter, setMeter] = createSignal<Meter>({})
    const [now, setNow] = createSignal(Date.now())

    const stops = EVENTS.map((type) =>
      context.data.on(type, (event) => {
        setMeter((current) => record(current, event, Date.now()))
        setNow(Date.now())
      }),
    )
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)

    context.ui.slot({
      append: "prompt.footer.status",
      render: (input) => {
        const current = () => (input.sessionID ? reading(meter(), input.sessionID, now()) : undefined)
        return (
          <Show when={current()}>
            {(value: () => Reading) => (
              <box flexShrink={0}>
                <text fg={context.theme.text.muted}>{label(value())}</text>
              </box>
            )}
          </Show>
        )
      },
    })

    return () => {
      clearInterval(timer)
      stops.forEach((stop) => stop())
    }
  },
})
