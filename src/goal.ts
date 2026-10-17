import { Option, Schema } from "effect"

export const Status = Schema.Literals(["active", "paused", "blocked", "budget_limited", "complete"])
export type Status = typeof Status.Type

export const Goal = Schema.Struct({
  objective: Schema.String,
  status: Status,
  tokenBudget: Schema.NullOr(Schema.Int),
  tokensUsed: Schema.Int,
  emptyTurns: Schema.Int,
  directory: Schema.String,
  note: Schema.optional(Schema.String),
  verify: Schema.optional(Schema.String),
  verifyFailures: Schema.optional(Schema.Int),
  lastExitCode: Schema.optional(Schema.Int),
  failedTurns: Schema.optional(Schema.Int),
  createdAt: Schema.Finite,
  updatedAt: Schema.Finite,
})
export type Goal = typeof Goal.Type

export const decodeGoal = (value: unknown): Goal | undefined =>
  Option.getOrUndefined(Schema.decodeUnknownOption(Goal)(value))

const EMPTY_TURN_LIMIT = 3
export const RETRY_LIMIT = 3
const RETRY_DELAYS_MS = [30_000, 120_000, 300_000]

// Host canaries shorten the waits through the retryDelaysMs plugin option.
export const retryDelays = (option: unknown): readonly number[] =>
  Array.isArray(option) && option.length === RETRY_LIMIT && option.every((ms) => typeof ms === "number" && ms >= 0)
    ? option
    : RETRY_DELAYS_MS

// OpenCode reports HTTP statuses up to 599.
const serverError = (status: number | undefined) => (status ?? 0) >= 500

export type GoalEvent =
  | {
      readonly _tag: "Set"
      readonly objective: string
      readonly tokenBudget: number | null
      readonly verify: string | null
      readonly directory: string
    }
  | {
      readonly _tag: "Create"
      readonly objective: string
      readonly tokenBudget: number | null
      readonly verify: null
      readonly directory: string
    }
  | { readonly _tag: "Moved"; readonly directory: string }
  | { readonly _tag: "Edit"; readonly objective: string }
  | { readonly _tag: "EditRequested" }
  | { readonly _tag: "Pause" }
  | { readonly _tag: "Resume" }
  | { readonly _tag: "Clear" }
  | { readonly _tag: "Budget"; readonly tokenBudget: number | null }
  | { readonly _tag: "Verify"; readonly verify: string | null }
  | { readonly _tag: "Complete"; readonly note: string | undefined; readonly check?: Check }
  | { readonly _tag: "Block"; readonly note: string | undefined }
  | { readonly _tag: "PauseRequested"; readonly note: string | undefined }
  | { readonly _tag: "Usage"; readonly tokens: number; readonly closing: boolean }
  | { readonly _tag: "TurnEnded"; readonly activity: boolean; readonly planning: boolean }
  | { readonly _tag: "Interrupted"; readonly reason: "user" | "shutdown" | "superseded" | "inactivity" }
  | { readonly _tag: "Failed"; readonly message: string; readonly status?: number }
  | { readonly _tag: "RetryDue"; readonly attempt: number }
  | { readonly _tag: "Recovered" }

export interface Check {
  readonly command: string
  readonly exitCode: number
}

export type GoalEffect =
  | { readonly _tag: "None" }
  | { readonly _tag: "Continue" }
  | { readonly _tag: "WrapUp" }
  | { readonly _tag: "ObjectiveUpdated" }
  | { readonly _tag: "Notify"; readonly text: string }
  | { readonly _tag: "Refuse"; readonly text: string }
  | { readonly _tag: "OpenEditor"; readonly objective: string }
  | { readonly _tag: "Retry"; readonly attempt: number }

interface Step {
  readonly goal: Goal | undefined
  readonly effect: GoalEffect
}

const none: GoalEffect = { _tag: "None" }
const notify = (text: string): GoalEffect => ({ _tag: "Notify", text })
const refuse = (text: string): GoalEffect => ({ _tag: "Refuse", text })
const RESET_STREAK = { failedTurns: undefined }

export const isUnfinished = (goal: Goal | undefined): goal is Goal => goal !== undefined && goal.status !== "complete"

export const outOfBudget = (goal: Goal) => goal.tokenBudget !== null && goal.tokensUsed >= goal.tokenBudget

export const COMPLETE_REFUSAL = "The goal is complete. Set a new goal instead."

const resumeRefusal = (goal: Goal): string | undefined => {
  if (goal.status === "complete") return COMPLETE_REFUSAL
  if (outOfBudget(goal)) return "The goal has used its token budget. Set a new goal with a larger --tokens budget."
  return undefined
}

const NO_GOAL = "No goal is set for this session."

export const step = (goal: Goal | undefined, event: GoalEvent, now: number): Step => {
  const unchanged: Step = { goal, effect: none }
  // The goal.changed RPC event rejects undefined values, so a cleared field is removed.
  const update = (patch: Partial<Goal>, effect: GoalEffect = none): Step => ({
    goal:
      goal &&
      (Object.fromEntries(Object.entries({ ...goal, ...patch, updatedAt: now }).filter(([, value]) => value !== undefined)) as Goal),
    effect,
  })

  if (event._tag === "Set" || (event._tag === "Create" && !isUnfinished(goal))) {
    return {
      goal: {
        objective: event.objective,
        status: "active",
        tokenBudget: event.tokenBudget,
        tokensUsed: 0,
        emptyTurns: 0,
        directory: event.directory,
        ...(event.verify !== null && { verify: event.verify }),
        createdAt: now,
        updatedAt: now,
      },
      effect: event._tag === "Set" ? { _tag: "Continue" } : none,
    }
  }
  if (!goal) {
    return event._tag === "Pause" ||
      event._tag === "Resume" ||
      event._tag === "Clear" ||
      event._tag === "Edit" ||
      event._tag === "EditRequested" ||
      event._tag === "Budget" ||
      event._tag === "Verify"
      ? { goal, effect: refuse(NO_GOAL) }
      : unchanged
  }

  switch (event._tag) {
    case "Create":
      return unchanged
    case "Moved":
      return update({ directory: event.directory })
    case "Clear":
      return { goal: undefined, effect: notify("Goal cleared.") }
    case "Budget": {
      if (goal.status === "complete") return { goal, effect: refuse(COMPLETE_REFUSAL) }
      const next = { ...goal, tokenBudget: event.tokenBudget }
      if (goal.status === "active" && outOfBudget(next)) {
        return update({ tokenBudget: event.tokenBudget, status: "budget_limited", note: "Token budget reached." }, { _tag: "WrapUp" })
      }
      if (goal.status === "budget_limited" && !outOfBudget(next)) {
        return update({ tokenBudget: event.tokenBudget, status: "active", note: undefined, emptyTurns: 0, ...RESET_STREAK }, { _tag: "Continue" })
      }
      return update({ tokenBudget: event.tokenBudget }, notify(event.tokenBudget === null ? "Token budget removed." : "Token budget updated."))
    }
    case "Verify":
      if (goal.status === "complete") return { goal, effect: refuse(COMPLETE_REFUSAL) }
      return update(
        { verify: event.verify ?? undefined, verifyFailures: undefined, lastExitCode: undefined },
        notify(event.verify === null ? "Verify command removed." : "Verify command updated."),
      )
    case "EditRequested": {
      const refusal = resumeRefusal(goal)
      return { goal, effect: refusal ? refuse(refusal) : { _tag: "OpenEditor", objective: goal.objective } }
    }
    case "Edit": {
      const refusal = resumeRefusal(goal)
      if (refusal) return { goal, effect: refuse(refusal) }
      if (goal.status === "active") {
        return update({ objective: event.objective, emptyTurns: 0, ...RESET_STREAK }, { _tag: "ObjectiveUpdated" })
      }
      return update(
        { objective: event.objective },
        notify(`Objective updated. The goal is ${goal.status}; run /goal resume to continue.`),
      )
    }
    case "Pause":
      return goal.status === "active"
        ? update({ status: "paused", note: "Paused by the user." }, notify("Goal paused."))
        : { goal, effect: refuse(`The goal is ${goal.status}; nothing to pause.`) }
    case "PauseRequested":
      return goal.status === "active" ? update({ status: "paused", note: event.note ?? "Paused at the user's request." }) : unchanged
    case "Resume": {
      if (goal.status === "active") return { goal, effect: refuse("The goal is already active.") }
      const refusal = resumeRefusal(goal)
      if (refusal) return { goal, effect: refuse(refusal) }
      return update({ status: "active", note: undefined, emptyTurns: 0, ...RESET_STREAK }, { _tag: "Continue" })
    }
    case "Complete": {
      if (goal.status !== "active" && goal.status !== "budget_limited") return unchanged
      if (goal.verify === undefined) return update({ status: "complete", note: event.note, ...RESET_STREAK })
      if (event.check?.command !== goal.verify) return unchanged
      return event.check.exitCode === 0
        ? update({ status: "complete", note: event.note, lastExitCode: 0, ...RESET_STREAK })
        : update({ verifyFailures: (goal.verifyFailures ?? 0) + 1, lastExitCode: event.check.exitCode })
    }
    case "Block":
      return goal.status === "active" ? update({ status: "blocked", note: event.note }) : unchanged
    case "Usage": {
      const charged = { ...goal, tokensUsed: goal.tokensUsed + event.tokens }
      const crossed = outOfBudget(charged)
      const limited = { tokensUsed: charged.tokensUsed, status: "budget_limited", note: "Token budget reached." } as const
      switch (goal.status) {
        case "active":
          return crossed ? update(limited, { _tag: "WrapUp" }) : update({ tokensUsed: charged.tokensUsed })
        case "budget_limited":
          return update({ tokensUsed: charged.tokensUsed })
        case "paused":
          if (!event.closing) return unchanged
          return crossed ? update(limited) : update({ tokensUsed: charged.tokensUsed })
        case "blocked":
        case "complete":
          return event.closing ? update({ tokensUsed: charged.tokensUsed }) : unchanged
      }
    }
    case "Interrupted":
      return goal.status === "active" && event.reason === "user"
        ? update({ status: "paused", note: "Interrupted by the user." })
        : unchanged
    case "Recovered":
      return goal.status === "active"
        ? update({ status: "paused", note: "Recovered after a restart. Run /goal resume to continue." })
        : unchanged
    case "Failed": {
      if (goal.status !== "active") return unchanged
      const failed = goal.failedTurns ?? 0
      if (serverError(event.status) && failed < RETRY_LIMIT) {
        return update({ failedTurns: failed + 1 }, { _tag: "Retry", attempt: failed + 1 })
      }
      const retries = failed ? ` after ${failed} ${failed === 1 ? "retry" : "retries"}` : ""
      return update({ status: "blocked", note: `Turn failed${retries}: ${event.message}` })
    }
    case "RetryDue":
      return goal.status === "active" && goal.failedTurns === event.attempt ? { goal, effect: { _tag: "Continue" } } : unchanged
    case "TurnEnded": {
      if (goal.status !== "active" || event.planning) return unchanged
      const emptyTurns = event.activity ? 0 : goal.emptyTurns + 1
      return emptyTurns >= EMPTY_TURN_LIMIT
        ? update({ emptyTurns, ...RESET_STREAK, status: "blocked", note: `${EMPTY_TURN_LIMIT} consecutive turns produced no output.` })
        : update({ emptyTurns, ...RESET_STREAK }, { _tag: "Continue" })
    }
  }
}
