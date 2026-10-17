import type { GoalCommand } from "./command.ts"
import type { Goal, GoalEffect, GoalEvent } from "./goal.ts"

export type TraceRecord = { readonly at: number; readonly kind: string } & Record<string, unknown>

export const transitionRecord = (
  sessionID: string,
  event: GoalEvent,
  before: Goal | undefined,
  after: Goal | undefined,
  effect: GoalEffect,
  at: number,
): TraceRecord | undefined => {
  const from = before?.status ?? "none"
  const to = after?.status ?? "none"
  if (from === to && effect._tag === "None" && (event._tag === "Usage" || before === after)) return undefined
  return {
    at,
    kind: "transition",
    sessionID,
    event: event._tag,
    from,
    to,
    effect: effect._tag,
    ...(after && { tokensUsed: after.tokensUsed }),
    ...(after?.note !== undefined && after.note !== before?.note && { note: after.note }),
    ...("objective" in event && { objective: event.objective }),
    ...("status" in event && { status: event.status }),
    ...(effect._tag === "Retry" && { attempt: effect.attempt }),
    ...(effect._tag === "Notify" && { text: effect.text }),
  }
}

export const commandRecord = (sessionID: string, text: string, command: GoalCommand, at: number): TraceRecord => ({
  at,
  kind: "command",
  sessionID,
  text,
  result: command._tag,
  ...(command._tag === "Invalid" && { message: command.message }),
})

export const toolErrorRecord = (sessionID: string, tool: string, message: string, at: number): TraceRecord => ({
  at,
  kind: "tool_error",
  sessionID,
  tool,
  message,
})

export const errorRecord = (where: string, cause: string, at: number): TraceRecord => ({ at, kind: "error", where, cause })

export const logEnabled = (options: { readonly log?: unknown }, env: Readonly<Record<string, string | undefined>>) =>
  typeof options.log === "boolean" ? options.log : env.OPENCODE_GOAL_LOG !== "0" && env.OPENCODE_GOAL_LOG !== "false"
