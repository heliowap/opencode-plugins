import { parseTokens } from "./command.ts"
import { formatTokens } from "./format.ts"
import { continueRefusal, type Goal, type GoalEvent } from "./goal.ts"

type ControlID = "pause" | "resume" | "edit" | "budget" | "verify" | "clear"

interface Control {
  readonly id: ControlID
  readonly title: string
  readonly description?: string
  readonly value?: string
}

export const controlsFor = (goal: Goal): readonly Control[] => {
  if (goal.status === "complete") return []
  const continuable = continueRefusal(goal) === undefined
  const controls: Control[] = []
  if (goal.status === "active") controls.push({ id: "pause", title: "Pause goal" })
  if ((goal.status === "paused" || goal.status === "blocked") && continuable) controls.push({ id: "resume", title: "Resume goal" })
  if (continuable) controls.push({ id: "edit", title: "Edit objective" })
  controls.push({
    id: "budget",
    title: "Token budget",
    description: goal.tokenBudget === null ? `${formatTokens(goal.tokensUsed)} used, no limit` : `${formatTokens(goal.tokensUsed)} of ${formatTokens(goal.tokenBudget)}`,
    value: goal.tokenBudget === null ? "" : String(goal.tokenBudget),
  })
  controls.push({ id: "verify", title: "Verify command", description: goal.verify ?? "none", value: goal.verify ?? "" })
  controls.push({ id: "clear", title: "Clear goal" })
  return controls
}

export const controlEvent = (id: ControlID): GoalEvent | undefined => {
  if (id === "budget" || id === "verify") return undefined
  switch (id) {
    case "pause": return { _tag: "Pause" }
    case "resume": return { _tag: "Resume" }
    case "edit": return { _tag: "EditRequested" }
    case "clear": return { _tag: "Clear" }
  }
  throw new Error(id)
}

export const budgetEvent = (text: string): GoalEvent | undefined => {
  const trimmed = text.trim()
  if (!trimmed) return { _tag: "Budget", tokenBudget: null }
  const tokenBudget = parseTokens(trimmed)
  return tokenBudget === undefined ? undefined : { _tag: "Budget", tokenBudget }
}

export const verifyEvent = (text: string): GoalEvent => {
  const verify = text.trim()
  return { _tag: "Verify", verify: verify || null }
}
