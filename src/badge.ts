import { isUnfinished, type Goal, type Status } from "./goal.ts"
import { formatTokens } from "./format.ts"

export type Tone = "accent" | "muted" | "warning" | "error"

export interface Badge {
  readonly text: string
  readonly tone: Tone
}

const usage = (goal: Goal) =>
  goal.tokenBudget === null
    ? formatTokens(goal.tokensUsed)
    : `${formatTokens(goal.tokensUsed)} / ${formatTokens(goal.tokenBudget)}`

const badges: Record<Status, (goal: Goal, running: boolean) => Badge | undefined> = {
  active: (goal, running) =>
    running
      ? { text: `◎ goal running · ${usage(goal)}`, tone: "accent" }
      : { text: `◎ goal active · ${usage(goal)}`, tone: "muted" },
  paused: () => ({ text: "⏸ goal paused", tone: "warning" }),
  blocked: () => ({ text: "⚠ goal blocked", tone: "error" }),
  budget_limited: (goal) => ({ text: `goal budget reached · ${usage(goal)}`, tone: "warning" }),
  complete: () => undefined,
}

export const goalBadge = (goal: Goal | undefined, running: boolean): Badge | undefined =>
  goal && badges[goal.status](goal, running)

export const editedObjective = (original: string, text: string): string | undefined => {
  const objective = text.trim()
  return objective && objective !== original.trim() ? objective : undefined
}

const OBJECTIVE_LINES = 3

const wrap = (text: string, width: number) => {
  const lines: string[] = []
  let line = ""
  for (const word of text.split(" ")) {
    const joined = line ? `${line} ${word}` : word
    if (joined.length <= width) {
      line = joined
      continue
    }
    if (line) lines.push(line)
    line = word
    while (line.length > width) {
      lines.push(line.slice(0, width))
      line = line.slice(width)
    }
  }
  lines.push(line)
  return lines
}

export const objectiveLines = (goal: Goal | undefined, width: number): string[] | undefined => {
  if (!isUnfinished(goal)) return undefined
  const lines = wrap(goal.objective.trim().replace(/\s+/g, " "), width)
  if (lines.length <= OBJECTIVE_LINES) return lines
  const last = lines[OBJECTIVE_LINES - 1]!
  return [...lines.slice(0, OBJECTIVE_LINES - 1), `${last.slice(0, width - 1)}…`]
}
