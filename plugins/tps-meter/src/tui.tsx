/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { createSignal, Show } from "solid-js"
import { label, METER_EVENTS, reading, record, type Meter, type Reading } from "./meter.ts"

const TICK_MS = 250

export default Plugin.define({
  id: "tps.meter",
  setup(context) {
    const [meter, setMeter] = createSignal<Meter>({})
    const [now, setNow] = createSignal(Date.now())

    const stops = METER_EVENTS.map((type) =>
      context.data.on(type, (event) => {
        const at = Date.now()
        setMeter((current) => record(current, event, at))
        setNow(at)
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
