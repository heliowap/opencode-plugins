import type { Content } from "@opencode/schema/tool"

export const LOOP_LIMIT = 3
export type Streaks = ReadonlyMap<string, { readonly command: string; readonly count: number }>

// The one list of file-changing tools. Their calls mark a turn as progress, and they also end a shell streak.
export const MUTATING_TOOLS: ReadonlySet<string> = new Set(["write", "edit", "patch", "apply_patch"])
// A subagent dispatch also ends a streak: the work it hands off is no longer a repeated poll.
export const RESETTING_TOOLS: ReadonlySet<string> = new Set([...MUTATING_TOOLS, "subagent"])

export const shellCommand = (tool: string, input: unknown): string | undefined => {
  const command = (input as { command?: unknown } | null | undefined)?.command
  return tool === "shell" && typeof command === "string" ? command.trim() : undefined
}

const shellCall = (streaks: Streaks, sessionID: string, command: string) => {
  const previous = streaks.get(sessionID)
  const count = previous?.command === command ? previous.count + 1 : 1
  return { streaks: new Map(streaks).set(sessionID, { command, count }), warn: count === LOOP_LIMIT }
}

const resetStreak = (streaks: Streaks, sessionID: string): Streaks => {
  const next = new Map(streaks)
  next.delete(sessionID)
  return next
}

// The whole streak decision for one tool call. The guard never blocks a call; it only reports the warn.
export const loopStep = (
  streaks: Streaks,
  sessionID: string,
  tool: string,
  input: unknown,
): { readonly streaks: Streaks; readonly warn: boolean } => {
  const command = shellCommand(tool, input)
  if (command !== undefined) return shellCall(streaks, sessionID, command)
  return { streaks: RESETTING_TOOLS.has(tool) ? resetStreak(streaks, sessionID) : streaks, warn: false }
}

export const withWarning = (content: string | ReadonlyArray<Content> | undefined, text: string): string | ReadonlyArray<Content> =>
  content === undefined ? text : typeof content === "string" ? `${content}\n\n${text}` : [...content, { type: "text", text }]
