import type { Content } from "@opencode/schema/tool"

export const LOOP_LIMIT = 3
export type Streaks = ReadonlyMap<string, { readonly command: string; readonly count: number }>
export const RESETTING_TOOLS: ReadonlySet<string> = new Set(["write", "edit", "patch", "apply_patch", "subagent"])

export const shellCommand = (tool: string, input: unknown): string | undefined => {
  const command = (input as { command?: unknown } | null | undefined)?.command
  return tool === "shell" && typeof command === "string" ? command.trim() : undefined
}

export const shellCall = (streaks: Streaks, sessionID: string, command: string): { readonly streaks: Streaks; readonly warn: boolean } => {
  const previous = streaks.get(sessionID)
  const count = previous?.command === command ? previous.count + 1 : 1
  return { streaks: new Map(streaks).set(sessionID, { command, count }), warn: count === LOOP_LIMIT }
}

export const resetStreak = (streaks: Streaks, sessionID: string): Streaks => {
  const next = new Map(streaks)
  next.delete(sessionID)
  return next
}

export const withWarning = (content: string | ReadonlyArray<Content>, text: string): string | ReadonlyArray<Content> =>
  typeof content === "string" ? `${content}\n\n${text}` : [...content, { type: "text", text }]
