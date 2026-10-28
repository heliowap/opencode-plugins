/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import type { Context } from "@opencode/plugin/tui/context"
import { createMemo, createSignal, For, Show } from "solid-js"
import { fetchAccounts, resolveSettings, type ProbeMemory } from "./client.ts"
import { bar, footerText, formatReset, level, nativeError, nativeSource, quotaSource, quotaView, type Account, type NativeID, type QuotaResult, type Window } from "./quota.ts"
import { QuotaRpc } from "./rpc.ts"

const LABEL = { "5h": "5h", day: "day", week: "week", month: "month", fable: "fable" } as const

export default Plugin.define({
  id: "cliproxy.quota",
  setup(context) {
    const settings = resolveSettings(context.options, process.env)
    const rpc = context.client.rpc(QuotaRpc)
    const [proxyAccounts, setProxyAccounts] = createSignal<Account[]>([])
    const [proxyError, setProxyError] = createSignal<string>()
    const [native, setNative] = createSignal<Readonly<Partial<Record<NativeID, QuotaResult>>>>({})
    const [now, setNow] = createSignal(Date.now())
    const memory: ProbeMemory = new Map()
    let revision = 0

    const refresh = async () => {
      const current = ++revision
      await Promise.all([
        fetchAccounts(settings, Date.now(), memory).then((result) => {
          if (!result.ok) return setProxyError(result.error)
          setProxyError(undefined)
          setProxyAccounts(result.accounts)
        }),
        rpc
          .native({}, { location: context.location })
          .catch(() => nativeError("Unable to read native quota from the OpenCode server"))
          .then((result) => {
            if (current !== revision) return
            setNative(result as Partial<Record<NativeID, QuotaResult>>)
          }),
      ])
      setNow(Date.now())
    }

    const source = createMemo(() => {
      const model = context.ui.model.current()
      if (!model) return undefined
      const info = context.data.location.provider.list(context.location)?.find((item) => item.id === model.providerID)
      return quotaSource(info ?? { id: model.providerID }, settings)
    })
    const view = createMemo(() =>
      quotaView(source(), context.ui.model.current()?.modelID, { accounts: proxyAccounts(), error: proxyError() }, native()),
    )

    context.ui.slot({
      append: "prompt.footer.status",
      render: () => (
        <Show when={view().windows.length > 0}>
          <box flexShrink={0}>
            <text fg={color(context, Math.max(...view().windows.map((item) => item.usedPercent)))}>{footerText(view().windows)}</text>
          </box>
        </Show>
      ),
    })

    context.ui.slot({
      append: "sidebar.content",
      render: () => (
        <Show when={view().provider}>
          <box flexDirection="column">
            <text fg={context.theme.text.base}>
              <b>Quota</b>
            </text>
            <Show when={view().error}>
              <text fg={context.theme.text.feedback.error.base}>{view().error}</text>
            </Show>
            <For each={view().accounts}>
              {(account) => (
                <box flexDirection="column">
                  <text fg={context.theme.text.muted}>{account.label}</text>
                  <For each={account.windows}>{(item) => <WindowRow context={context} item={item} now={now()} />}</For>
                </box>
              )}
            </For>
          </box>
        </Show>
      ),
    })

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "cliproxy.quota.refresh",
          title: "Refresh quota",
          group: "Quota",
          palette: true,
          slash: { name: "quota" },
          run: async () => {
            await refresh()
            const message = view().error ?? (footerText(view().windows) || "No quota data for the selected model")
            context.ui.toast.show({ title: "Quota", message, variant: view().error ? "error" : "info" })
          },
        },
      ],
    }))

    void context.data.location.provider.sync(context.location)
    void refresh()
    const timer = setInterval(() => void refresh(), settings.intervalMs)
    const stop = context.data.on("session.execution.succeeded", () => void refresh())
    const stopCredential = context.data.on("credential.switched", (event) => {
      if (!nativeSource(event.data.integrationID)) return
      setNative((previous) => ({ ...previous, [event.data.integrationID]: undefined }))
      void refresh()
    })
    return () => {
      revision++
      clearInterval(timer)
      stop()
      stopCredential()
    }
  },
})

function WindowRow(props: { context: Context; item: Window; now: number }) {
  return (
    <text fg={color(props.context, props.item.usedPercent)}>
      {`${LABEL[props.item.kind].padEnd(6)}${bar(100 - props.item.usedPercent)} ${String(Math.round(100 - props.item.usedPercent)).padStart(3)}% left ${formatReset(props.item.resetAt, props.now)}`}
    </text>
  )
}

function color(context: Context, usedPercent: number) {
  const current = level(usedPercent)
  if (current === "ok") return context.theme.text.muted
  return context.theme.text.feedback[current].base
}
