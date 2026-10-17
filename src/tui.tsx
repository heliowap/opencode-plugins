/** @jsxImportSource @opentui/solid */
import type { TextareaRenderable } from "@opentui/core"
import { Plugin } from "@opencode/plugin/tui"
import type { Context } from "@opencode/plugin/tui/context"
import { editedObjective, goalBadge, objectiveLines, type Tone } from "./badge.ts"
import { decodeGoal, type Goal } from "./goal.ts"
import { GoalRpc } from "./rpc.ts"

// Installed packages resolve `solid-js` to their own copy, which the host renderer does not track.
// Keep all reactive state in the host's store and import nothing from solid-js.

// The session sidebar is 42 columns wide with 2 columns of padding on each side.
const SIDEBAR_TEXT_WIDTH = 38
const EDITOR_HEIGHT = 12

const color = (context: Context, tone: Tone) =>
  ({
    accent: context.theme.text.feedback.info.base,
    muted: context.theme.text.muted,
    warning: context.theme.text.feedback.warning.base,
    error: context.theme.text.feedback.error.base,
  })[tone]

const EditGoal = (props: { context: Context; objective: string; save: (objective: string) => void }) => {
  const { context } = props
  let editor: TextareaRenderable | undefined
  const save = () => {
    const objective = editedObjective(props.objective, editor?.plainText ?? "")
    context.ui.dialog.clear()
    if (objective) props.save(objective)
  }
  context.keymap.layer(() => ({
    mode: "modal",
    priority: 1,
    commands: [{ bind: "ctrl+s", title: "Save goal", group: "Dialog", run: save }],
  }))
  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={context.theme.text.base}>
          <b>Edit goal</b>
        </text>
        <text fg={context.theme.text.muted} onMouseUp={() => context.ui.dialog.clear()}>
          esc
        </text>
      </box>
      <textarea
        height={EDITOR_HEIGHT}
        wrapMode="word"
        initialValue={props.objective}
        textColor={context.theme.text.formfield.base}
        focusedTextColor={context.theme.text.formfield.base}
        cursorColor={context.theme.text.base}
        ref={(element: TextareaRenderable) => {
          editor = element
          // The textarea cannot take focus until the dialog has mounted; the host's own prompt dialog waits the same way.
          setTimeout(() => {
            if (element.isDestroyed) return
            element.focus()
            element.gotoBufferEnd()
          }, 1)
        }}
      />
      <text fg={context.theme.text.base}>
        ctrl+s <span style={{ fg: context.theme.text.muted }}>save</span>
      </text>
    </box>
  )
}

export default Plugin.define({
  id: "goal.status",
  setup(context) {
    const rpc = context.client.rpc(GoalRpc)
    const [goals, update] = context.storage.memory("goals", { initial: {} as Record<string, Goal | null> })
    const remember = (sessionID: string, goal: unknown) =>
      update((draft) => {
        draft[sessionID] = decodeGoal(goal) ?? null
      })
    const goalOf = (sessionID: string) => goals[sessionID] ?? undefined
    const fetchGoal = (sessionID: string) => {
      // A changed event that lands while get is in flight is newer than its result.
      void rpc.get({ sessionID }).then((result) => {
        if (!(sessionID in goals)) remember(sessionID, (result as { goal: unknown }).goal)
      })
    }

    const stopChanged = rpc.events.on("changed", (event) => {
      const data = event.data as { sessionID: string; goal: unknown }
      remember(data.sessionID, data.goal)
    })

    const stopEdit = rpc.events.on("editRequested", (event) => {
      const { sessionID, objective } = event.data as { sessionID: string; objective: string }
      const route = context.ui.router.current()
      if (route.type !== "session" || route.sessionID !== sessionID) return
      context.ui.dialog.show(() => (
        <EditGoal
          context={context}
          objective={objective}
          save={(next) =>
            void rpc
              .edit({ sessionID, objective: next })
              .catch(() => context.ui.toast.show({ message: "The goal could not be saved.", variant: "error" }))
          }
        />
      ))
      context.ui.dialog.set({ size: "large" })
    })

    context.ui.slot({
      append: "session.composer.top",
      render: (slot) => {
        fetchGoal(slot.sessionID)
        const badge = () =>
          goalBadge(goalOf(slot.sessionID), context.data.session.status(slot.sessionID) === "running")
        return (
          <>
            {badge() ? (
              <box flexShrink={0} paddingLeft={1}>
                <text fg={color(context, badge()!.tone)}>{badge()!.text}</text>
              </box>
            ) : null}
          </>
        )
      },
    })

    context.ui.slot({
      prepend: "sidebar.footer",
      render: (slot) => {
        fetchGoal(slot.sessionID)
        const lines = () => objectiveLines(goalOf(slot.sessionID), SIDEBAR_TEXT_WIDTH)
        return (
          <>
            {lines() ? (
              <box flexShrink={0}>
                <text fg={context.theme.text.base}>
                  <b>Goal</b>
                </text>
                {lines()!.map((line) => (
                  <text fg={context.theme.text.muted}>{line}</text>
                ))}
              </box>
            ) : null}
          </>
        )
      },
    })

    return () => {
      stopChanged()
      stopEdit()
    }
  },
})
