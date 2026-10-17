import type { GoalCommand } from "./command.ts"
import type { Goal, GoalEffect, GoalEvent } from "./goal.ts"

type GoalState = Goal["status"] | "none"

export type TraceRecord =
  | {
      readonly _tag: "Transition"
      readonly at: number
      readonly sessionID: string
      readonly event: GoalEvent["_tag"]
      readonly from: GoalState
      readonly to: GoalState
      readonly effect: GoalEffect["_tag"]
      readonly tokensUsed?: number
      readonly note?: string
      readonly objective?: string
      readonly status?: number
      readonly attempt?: number
      readonly text?: string
    }
  | {
      readonly _tag: "Command"
      readonly at: number
      readonly sessionID: string
      readonly text: string
      readonly result: GoalCommand["_tag"]
      readonly message?: string
    }
  | { readonly _tag: "ToolError"; readonly at: number; readonly sessionID: string; readonly tool: string; readonly message: string }
  | { readonly _tag: "Error"; readonly at: number; readonly sessionID?: string; readonly where: string; readonly cause: string }

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
    _tag: "Transition",
    at,
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
  _tag: "Command",
  at,
  sessionID,
  text,
  result: command._tag,
  ...(command._tag === "Invalid" && { message: command.message }),
})

export const toolErrorRecord = (sessionID: string, tool: string, message: string, at: number): TraceRecord => ({
  _tag: "ToolError",
  at,
  sessionID,
  tool,
  message,
})

export const errorRecord = (where: string, cause: string, sessionID: string | undefined, at: number): TraceRecord => ({
  _tag: "Error",
  at,
  ...(sessionID !== undefined && { sessionID }),
  where,
  cause,
})

export const logEnabled = (options: { readonly log?: unknown }, env: Readonly<Record<string, string | undefined>>) =>
  options.log !== false && env.OPENCODE_GOAL_LOG !== "0" && env.OPENCODE_GOAL_LOG !== "false"
