import { Plugin } from "@opencode/plugin/effect"
import { Tool } from "@opencode/schema/tool"
import { Cause, Effect, Schema, Semaphore, Stream } from "effect"
import { spawn } from "node:child_process"
import { homedir } from "node:os"
import { parseCommand, type GoalCommand } from "./command.ts"
import { formatTokens } from "./format.ts"
import {
  continuationDelay, decodeGoal, isUnfinished, retryDelays, step,
  type Check, type Goal, type GoalEffect, type GoalEvent,
} from "./goal.ts"
import {
  budgetLimitPrompt,
  COMMAND_HELP,
  continuationPrompt,
  loopWarningText,
  objectiveUpdatedPrompt,
  sessionContext,
  statusText,
  subagentStalledText,
  verifyFailedText,
} from "./prompts.ts"
import { appendCapped, LOG_LIMIT, logPath } from "./log.ts"
import { GoalRpc } from "./rpc.ts"
import { loopStep, MUTATING_TOOLS, shellCommand, withWarning, type Streaks } from "./loop.ts"
import { commandRecord, errorRecord, logEnabled, sessionOf, toolErrorRecord, transitionRecord, type GoalTool, type TraceRecord } from "./trace.ts"
import { stallDelay, tickInterval, watch, watchEventOf, type Children, type Stall, type WatchEvent } from "./watchdog.ts"

const CreateInput = Schema.Struct({
  objective: Schema.String.annotate({
    description:
      "Required. Rewrite the user's request as an auditable objective: the end state, the command, test, file, or measurement that proves it, and what must not regress. If the proof does not fit in one sentence, ask the user before creating the goal.",
  }),
  token_budget: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))).annotate({
    description: "Positive token budget for the goal. Omit unless the user explicitly asks for one.",
  }),
})

const UpdateInput = Schema.Struct({
  status: Schema.Literals(["complete", "blocked", "paused"]).annotate({
    description:
      "Required. `paused` requires an explicit user request. `complete` only when the objective is achieved and no required work remains. `blocked` only after the same blocking condition has recurred for at least three consecutive goal turns.",
  }),
  note: Schema.optional(Schema.String).annotate({
    description:
      "For `complete`, the requirement-by-requirement evidence. For `blocked`, the blocking condition and the user input or external change it needs.",
  }),
})

// OpenCode 2.0.23 rejected `turn_budget: 6` against Schema.Int ("Expected an integer"). Hand the
// host plain JSON Schema and decode here instead.
const toolInput = <S extends Schema.Top & { readonly DecodingServices: never }>(schema: S) => ({
  input: Schema.toJsonSchemaDocument(schema).schema,
  decode: (value: unknown) =>
    Schema.decodeUnknownEffect(schema)(value).pipe(
      Effect.mapError((issue) => new Tool.Error({ message: `goal: invalid input. ${String(issue)}` })),
    ),
})

const createInput = toolInput(CreateInput)
const updateInput = toolInput(UpdateInput)
const getInput = toolInput(Schema.Struct({}))

const PLANNING_AGENTS = new Set(["plan"])

const KEY_PREFIX = "goal/"

// Per-turn bookkeeping for one location. It lives on globalThis so a plugin reload inside a running
// server keeps the turns already in flight, while a process restart starts clean.
interface LocationState {
  readonly activity: Set<string>
  readonly agents: Map<string, string>
  readonly resumePending: Set<string>
  readonly closingSteps: Map<string, string>
  readonly retries: Map<string, { readonly attempt: number; readonly at: number }>
  readonly continuations: Map<string, number>
  readonly watchdog: { children: Children }
  readonly loops: { streaks: Streaks }
  // Calls whose result gets the loop warning, by call id, with the session that made them.
  readonly warnedCalls: Map<string, string>
}

const LOCATIONS: Map<string, LocationState> = ((globalThis as Record<symbol, Map<string, LocationState> | undefined>)[
  Symbol.for("opencode-v2-goal-plugin/locations")
] ??= new Map())

const locationState = (directory: string) => {
  const existing = LOCATIONS.get(directory)
  if (existing) {
    // A running server may still hold bookkeeping created before cooldowns were added.
    if (!existing.continuations) Object.assign(existing, { continuations: new Map() })
    if (!existing.watchdog) Object.assign(existing, { watchdog: { children: new Map() } })
    if (!existing.loops) Object.assign(existing, { loops: { streaks: new Map() } })
    if (!existing.warnedCalls) Object.assign(existing, { warnedCalls: new Map() })
    return { state: existing, fresh: false }
  }
  const state: LocationState = {
    activity: new Set(),
    agents: new Map(),
    resumePending: new Set(),
    closingSteps: new Map(),
    retries: new Map(),
    continuations: new Map(),
    watchdog: { children: new Map() },
    loops: { streaks: new Map() },
    warnedCalls: new Map(),
  }
  LOCATIONS.set(directory, state)
  return { state, fresh: true }
}

const updateEvents = {
  complete: (note) => ({ _tag: "Complete", note }),
  blocked: (note) => ({ _tag: "Block", note }),
  paused: (note) => ({ _tag: "PauseRequested", note }),
} satisfies Record<typeof UpdateInput.Type.status, (note: string | undefined) => GoalEvent>

const OUTPUT_LIMIT = 64_000

type CheckRun = Check & { readonly output: string }

// Interrupting the turn interrupts this effect, which kills the whole process group.
const runCheck = (command: string, directory: string) =>
  Effect.callback<CheckRun>((resume) => {
    let output = ""
    const child = spawn("sh", ["-c", command], { cwd: directory, detached: true, stdio: ["ignore", "pipe", "pipe"] })
    const collect = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-OUTPUT_LIMIT)
    }
    child.stdout.on("data", collect)
    child.stderr.on("data", collect)
    child.on("error", (error) => resume(Effect.succeed({ command, exitCode: 127, output: error.message })))
    child.on("close", (code, signal) =>
      resume(Effect.succeed({ command, exitCode: code ?? 128, output: signal ? `${output}\nKilled by ${signal}.` : output })),
    )
    return Effect.sync(() => {
      if (child.pid !== undefined && child.exitCode === null) process.kill(-child.pid, "SIGKILL")
    })
  })

const toolError = (error: unknown) =>
  error instanceof Tool.Error ? error : new Tool.Error({ message: `goal: ${String(error)}` })

export default Plugin.define({
  id: "goal",
  effect: (ctx) =>
    Effect.gen(function* () {
      const lock = yield* Semaphore.make(1)
      const scope = yield* Effect.scope
      const now = () => Date.now()
      const delays = retryDelays(ctx.options.retryDelaysMs)
      const cooldownMs = continuationDelay(ctx.options.continuationDelayMs)
      const tracing = logEnabled(ctx.options, process.env)
      const traceFile = logPath(process.env, homedir())

      // The log is a diagnostic aid: a write that fails must never fail the goal.
      const trace = (record: TraceRecord | undefined) =>
        tracing && record
          ? Effect.sync(() => {
              try {
                appendCapped(traceFile, JSON.stringify(record), LOG_LIMIT)
              } catch {}
            })
          : Effect.void

      const logFailure = (where: string, sessionID?: string) => (cause: Cause.Cause<unknown>) =>
        Effect.logError(`goal: ${where} failed`, cause).pipe(
          Effect.andThen(trace(errorRecord(where, Cause.pretty(cause), sessionID, now()))),
        )

      const failingTool = (tool: GoalTool, sessionID: string) =>
        <A, R>(effect: Effect.Effect<A, unknown, R>) =>
          effect.pipe(
            Effect.mapError(toolError),
            Effect.tapError((error) => trace(toolErrorRecord(sessionID, tool, error.message, now()))),
          )

      const goalOutput = ({ goal }: { readonly goal: Goal | undefined }) => ({ goal: goal ?? null })

      const { state, fresh } = locationState(ctx.location.directory)
      const { activity, agents, resumePending, closingSteps, retries, continuations, watchdog, loops, warnedCalls } = state
      const key = (sessionID: string) => `${KEY_PREFIX}${sessionID}`
      const planning = (sessionID: string) => PLANNING_AGENTS.has(agents.get(sessionID) ?? "")

      const load = (sessionID: string) => ctx.storage.get(key(sessionID)).pipe(Effect.map(decodeGoal))

      const rpc = yield* ctx.rpc
        .register(GoalRpc, {
          get: (input) => load((input as { sessionID: string }).sessionID).pipe(Effect.map((goal) => goalOutput({ goal }))),
          apply: (input) => {
            const { sessionID, action } = input as { sessionID: string; action: GoalEvent }
            return transition(sessionID, action).pipe(
              Effect.map(goalOutput),
              Effect.tapCause(logFailure("goal.apply", sessionID)),
              Effect.orDie,
            )
          },
        })
        .pipe(Effect.orDie)

      const save = (sessionID: string, goal: Goal | undefined) =>
        goal ? ctx.storage.set(key(sessionID), goal) : ctx.storage.remove(key(sessionID))

      const send = (sessionID: string, text: string, options: { resume: boolean; delivery: "steer" | "queue" }) =>
        ctx.session
          .synthetic({ sessionID: sessionID as never, text, description: "goal", ...options })
          .pipe(Effect.asVoid)

      const notice = (sessionID: string, text: string) =>
        send(sessionID, `[goal] ${text}`, { resume: false, delivery: "queue" })

      // A queued continuation starts the next turn, so one is enough until that turn starts.
      // Steers land in the running turn and are never deduplicated.
      const queue = (sessionID: string, text: string) =>
        resumePending.has(sessionID)
          ? Effect.void
          : send(sessionID, text, { resume: true, delivery: "queue" }).pipe(
              Effect.tap(() => Effect.sync(() => resumePending.add(sessionID))),
            )

      const steer = (sessionID: string, text: string) => send(sessionID, text, { resume: true, delivery: "steer" })

      // The wait is kept in the location state, so a plugin reload can resume it where it stopped.
      const scheduleRetry = (sessionID: string, attempt: number, at: number) =>
        Effect.sync(() => retries.set(sessionID, { attempt, at })).pipe(
          Effect.andThen(
            Effect.forkIn(
              Effect.sleep(Math.max(0, at - now())).pipe(
                Effect.andThen(Effect.sync(() => retries.delete(sessionID))),
                Effect.andThen(onEvent(sessionID, { _tag: "RetryDue", attempt })),
                Effect.catchCause(logFailure("retry", sessionID)),
              ),
              scope,
            ),
          ),
          Effect.asVoid,
        )

      const scheduleContinuation = (sessionID: string, at: number) =>
        Effect.sync(() => continuations.set(sessionID, at)).pipe(
          Effect.andThen(
            Effect.forkIn(
              Effect.sleep(Math.max(0, Math.min(60_000, at - now()))).pipe(
                Effect.andThen(onEvent(sessionID, { _tag: "ContinueDue", at })),
                Effect.catchCause(logFailure("continuation", sessionID)),
              ),
              scope,
            ),
          ),
          Effect.asVoid,
        )

      // A silent child is interrupted without `resume`: with a pending steer, resume would hand the
      // child to a successor instead of cancelling it. The parent notice goes through `send` directly,
      // because `queue` skips while a goal continuation is pending.
      const stallMs = stallDelay(ctx.options.watchdogStallMs)
      const stalled = (stall: Stall) =>
        ctx.session
          .interrupt({ sessionID: stall.sessionID as never })
          .pipe(
            Effect.as(true),
            Effect.catchCause((cause) => logFailure("watchdog interrupt", stall.sessionID)(cause).pipe(Effect.as(false))),
            Effect.flatMap((interrupted) =>
              send(stall.parentID, subagentStalledText(stall.sessionID, stall.idleMs, interrupted), {
                resume: true,
                delivery: "queue",
              }),
            ),
            Effect.catchCause(logFailure("watchdog", stall.sessionID)),
          )

      const applyWatch = (event: WatchEvent) =>
        Effect.sync(() => {
          const result = watch(watchdog.children, event, now(), stallMs)
          watchdog.children = result.children
          return result.stalls
        }).pipe(Effect.flatMap((stalls) => Effect.forEach(stalls, stalled, { discard: true })))

      // A session that ends (or is deleted) can leave warned calls whose result never arrives.
      const forgetWarnings = (sessionID: string) =>
        Effect.sync(() => {
          for (const [callID, owner] of warnedCalls) if (owner === sessionID) warnedCalls.delete(callID)
        })

      yield* Effect.forkIn(
        Effect.forever(
          Effect.sleep(tickInterval(stallMs)).pipe(
            Effect.andThen(applyWatch({ _tag: "Tick" })),
            Effect.catchCause(logFailure("watchdog tick")),
          ),
        ),
        scope,
      )

      const perform = (sessionID: string, goal: Goal | undefined, effect: GoalEffect) => {
        switch (effect._tag) {
          case "None":
            return Effect.void
          case "Notify":
          case "Refuse":
            return notice(sessionID, effect.text)
          case "OpenEditor":
            return rpc.events
              .emit("editRequested", { sessionID, objective: effect.objective })
              .pipe(Effect.catchCause(logFailure("editRequested event", sessionID)))
          case "Continue":
            return goal ? queue(sessionID, continuationPrompt(goal, now())) : Effect.void
          case "WrapUp":
            return goal ? steer(sessionID, budgetLimitPrompt(goal, now())) : Effect.void
          case "ObjectiveUpdated":
            return goal ? steer(sessionID, objectiveUpdatedPrompt(goal, now())) : Effect.void
          case "Retry":
            return scheduleRetry(sessionID, effect.attempt, now() + delays[effect.attempt - 1]!)
          case "Cooldown":
            return scheduleContinuation(sessionID, effect.at)
        }
      }

      // Annotated because the goal.apply RPC handler and transition refer to each other.
      const transition = (
        sessionID: string,
        event: GoalEvent,
        options: { readonly quiet?: boolean } = {},
      ): Effect.Effect<{ readonly before: Goal | undefined; readonly goal: Goal | undefined }, unknown> =>
        lock.withPermits(1)(
          Effect.gen(function* () {
            const before = yield* load(sessionID)
            const next = step(before, event, now())
            if (next.goal?.status !== "active" || next.goal.continueAt === undefined) continuations.delete(sessionID)
            yield* trace(transitionRecord(sessionID, event, before, next.goal, next.effect, now()))
            if (next.goal !== before) {
              yield* save(sessionID, next.goal)
              yield* rpc.events
                .emit("changed", { sessionID, goal: next.goal ?? null })
                .pipe(Effect.catchCause(logFailure("changed event", sessionID)))
            }
            if (!options.quiet) yield* perform(sessionID, next.goal, next.effect)
            return { before, goal: next.goal }
          }),
        )

      const ownedGoal = (sessionID: string) =>
        load(sessionID).pipe(Effect.map((goal) => (goal?.directory === ctx.location.directory ? goal : undefined)))

      const onEvent = (sessionID: string, event: GoalEvent, options: { readonly quiet?: boolean } = {}) =>
        ownedGoal(sessionID).pipe(
          Effect.flatMap((goal) => (goal ? Effect.asVoid(transition(sessionID, event, options)) : Effect.void)),
        )

      const runCommand = (sessionID: string, command: GoalCommand) => {
        switch (command._tag) {
          case "Invalid":
            return notice(sessionID, command.message)
          case "Status":
            return load(sessionID).pipe(Effect.flatMap((goal) => notice(sessionID, statusText(goal, now()))))
          case "EditPrompt":
            return Effect.asVoid(transition(sessionID, { _tag: "EditRequested" }))
          case "Set":
            return Effect.asVoid(transition(sessionID, { ...command, directory: ctx.location.directory }))
          case "Edit":
          case "Pause":
          case "Resume":
          case "Clear":
            return Effect.asVoid(transition(sessionID, command))
        }
      }

      yield* ctx.command.transform((editor) => {
        editor.add({
          name: "goal",
          description: "Set, show, edit, pause, resume, or clear the session's persistent goal",
          execute: ({ sessionID, prompt }) => {
            const command = parseCommand(prompt.text)
            return trace(commandRecord(sessionID, prompt.text, command, now())).pipe(Effect.andThen(runCommand(sessionID, command)))
          },
        })
      })

      yield* ctx.tool.transform((editor) => {
        editor.namespace({ name: "goal", description: "The session's persistent goal" })
        editor.add({
          name: "create",
          description:
            "Create a persistent goal that keeps this session working across turns until the objective is audited as complete. Create a goal only when the user or system instructions explicitly ask for one; do not infer goals from ordinary tasks. Set token_budget only when the user asks for a budget. Fails if an unfinished goal exists.",
          input: createInput.input,
          options: { namespace: "goal", codemode: false },
          execute: (raw, context) =>
            Effect.gen(function* () {
              const input = yield* createInput.decode(raw)
              const { before, goal } = yield* transition(context.sessionID, {
                _tag: "Create",
                objective: input.objective,
                tokenBudget: input.token_budget ?? null,
                verify: null,
                directory: ctx.location.directory,
              })
              if (isUnfinished(before)) {
                return yield* new Tool.Error({
                  message: `This session already has an unfinished goal (${before.status}). Finish it, or ask the user to replace it with /goal <objective>.`,
                })
              }
              return { content: `Goal created.\n${statusText(goal, now())}` }
            }).pipe(failingTool("goal_create", context.sessionID)),
        })
        editor.add({
          name: "get",
          description:
            "Get the session's goal: objective, status, token usage, remaining token budget, and elapsed time. Also returns the /goal command syntax the user can type.",
          input: getInput.input,
          options: { namespace: "goal", codemode: false },
          execute: (_input, context) =>
            load(context.sessionID).pipe(
              Effect.map((goal) => ({ content: `${statusText(goal, now())}\n\n${COMMAND_HELP}` })),
              failingTool("goal_get", context.sessionID),
            ),
        })
        editor.add({
          name: "update",
          description: [
            "Update the status of the existing goal.",
            "Set `paused` only at the user's explicit request, never on your own initiative. Report the returned status and stop goal work. Budget limits take precedence over pausing.",
            "Set `complete` only when the objective has actually been achieved and no required work remains, and put the requirement-by-requirement evidence in note.",
            "Set `blocked` only when the same blocking condition has repeated for at least three consecutive goal turns and you cannot make meaningful progress without user input or an external-state change. A resumed goal starts a fresh blocked audit.",
            "Do not use `blocked` merely because the work is hard, slow, uncertain, incomplete, or would benefit from clarification. Do not mark a goal complete because its budget is nearly exhausted or because you are stopping work.",
            "You cannot resume or budget-limit a goal with this tool.",
          ].join("\n"),
          input: updateInput.input,
          options: { namespace: "goal", codemode: false },
          execute: (raw, context) =>
            Effect.gen(function* () {
              const input = yield* updateInput.decode(raw)
              const current = yield* load(context.sessionID)
              const check =
                input.status === "complete" && current?.verify !== undefined && (current.status === "active" || current.status === "budget_limited")
                  ? yield* runCheck(current.verify, current.directory)
                  : undefined
              const event: GoalEvent = check ? { _tag: "Complete", note: input.note, check } : updateEvents[input.status](input.note)
              const { before, goal } = yield* transition(context.sessionID, event)
              if (!before) return yield* new Tool.Error({ message: "No goal is set for this session." })
              if (check && check.exitCode !== 0 && goal) return yield* new Tool.Error({ message: verifyFailedText(goal, check) })
              if (goal?.status !== input.status) {
                return yield* new Tool.Error({
                  message: `The goal is ${goal?.status ?? "cleared"} and cannot move to ${input.status}.`,
                })
              }
              closingSteps.set(context.sessionID, context.messageID)
              const budget =
                goal.tokenBudget === null
                  ? ""
                  : ` Usage so far: ${formatTokens(goal.tokensUsed)} of ${formatTokens(goal.tokenBudget)} tokens; this step is added when it ends.`
              return { content: `Goal ${goal.status}.${budget}` }
            }).pipe(failingTool("goal_update", context.sessionID)),
        })
      })

      // A loop-guard failure is logged and dropped: it must never break the tool call it watches.
      yield* ctx.tool.hook("execute.before", (event) =>
        Effect.sync(() => {
          const step = loopStep(loops.streaks, event.sessionID, event.tool, event.input)
          loops.streaks = step.streaks
          if (step.warn) warnedCalls.set(event.id, event.sessionID)
        }).pipe(Effect.catchCause(logFailure("loop guard", event.sessionID))),
      )

      yield* ctx.tool.hook("execute.after", (event) =>
        Effect.sync(() => {
          if (event.status === "completed" && MUTATING_TOOLS.has(event.tool)) activity.add(event.sessionID)
          if (!warnedCalls.delete(event.id)) return
          const text = loopWarningText(shellCommand(event.tool, event.input) ?? "")
          if (event.status === "error") {
            event.error = new Tool.Error({ message: `${event.error.message}\n\n${text}` })
          } else {
            event.result = { ...event.result, content: withWarning(event.result.content, text) }
          }
        }).pipe(Effect.catchCause(logFailure("loop guard", event.sessionID))),
      )

      yield* ctx.session.hook("context", (event) =>
        Effect.gen(function* () {
          agents.set(event.sessionID, event.agent)
          const goal = yield* ownedGoal(event.sessionID)
          if (goal?.status === "active") event.system.push({ type: "text", text: sessionContext(goal, now()) })
        }),
      )

      const handle = (event: Stream.Success<ReturnType<typeof ctx.event.subscribe>>) => {
        switch (event.type) {
          case "session.execution.started":
            return Effect.sync(() => {
              activity.delete(event.data.sessionID)
              resumePending.delete(event.data.sessionID)
            }).pipe(Effect.andThen(onEvent(event.data.sessionID, { _tag: "TurnStarted" })))
          case "session.text.ended":
            return Effect.sync(() => {
              if (event.data.text.trim()) activity.add(event.data.sessionID)
            })
          case "session.step.ended": {
            const { sessionID, tokens, assistantMessageID } = event.data
            if (planning(sessionID)) return Effect.void
            const closing = closingSteps.get(sessionID) === assistantMessageID
            if (closing) closingSteps.delete(sessionID)
            return onEvent(sessionID, { _tag: "Usage", tokens: tokens.input + tokens.output + tokens.reasoning, closing })
          }
          case "session.execution.succeeded":
            return forgetWarnings(event.data.sessionID).pipe(
              Effect.andThen(
                onEvent(event.data.sessionID, {
                  _tag: "TurnEnded",
                  activity: activity.has(event.data.sessionID),
                  planning: planning(event.data.sessionID),
                  delayMs: cooldownMs,
                }),
              ),
            )
          case "session.execution.interrupted":
            return forgetWarnings(event.data.sessionID).pipe(
              Effect.andThen(onEvent(event.data.sessionID, { _tag: "Interrupted", reason: event.data.reason })),
            )
          case "session.execution.failed":
            return forgetWarnings(event.data.sessionID).pipe(
              Effect.andThen(
                onEvent(event.data.sessionID, {
                  _tag: "Failed",
                  message: event.data.error.message,
                  ...(event.data.error.status !== undefined && { status: event.data.error.status }),
                }),
              ),
            )
          case "session.moved":
            return onEvent(event.data.sessionID, { _tag: "Moved", directory: event.data.location.directory })
          case "session.deleted":
            return forgetWarnings(event.data.sessionID).pipe(
              Effect.andThen(onEvent(event.data.sessionID, { _tag: "Clear" }, { quiet: true })),
            )
          default:
            return Effect.void
        }
      }

      const forActiveGoals = (visit: (sessionID: string, goal: Goal) => Effect.Effect<unknown, unknown>) =>
        Effect.gen(function* () {
          let after: string | undefined
          do {
            const page = yield* ctx.storage.scan({ prefix: KEY_PREFIX, after, limit: 100 })
            for (const entry of page.entries) {
              const goal = decodeGoal(entry.value)
              if (goal?.status === "active" && goal.directory === ctx.location.directory) {
                yield* visit(entry.key.slice(KEY_PREFIX.length), goal)
              }
            }
            after = page.next
          } while (after)
        })

      // A reload closes the previous scope and its pending retry and continuation waits.
      const startup = fresh
        ? forActiveGoals((sessionID) => transition(sessionID, { _tag: "Recovered" }, { quiet: true }))
        : Effect.all(
            [
              Effect.forEach([...retries], ([sessionID, { attempt, at }]) => scheduleRetry(sessionID, attempt, at), { discard: true }),
              Effect.forEach([...continuations], ([sessionID, at]) => scheduleContinuation(sessionID, at), { discard: true }),
            ],
            { discard: true },
          )
      yield* startup.pipe(Effect.catchCause(logFailure("recovery")))

      yield* ctx.event.subscribe().pipe(
        Stream.runForEach((event) => {
          const sessionID = sessionOf(event)
          const watchEvent = watchEventOf(event, ctx.location.directory)
          // Each part has its own catchCause, so a watchdog failure cannot drop the goal handler's event.
          return (watchEvent ? applyWatch(watchEvent) : Effect.void).pipe(
            Effect.catchCause(logFailure("watchdog", sessionID)),
            Effect.andThen(handle(event).pipe(Effect.catchCause(logFailure(event.type, sessionID)))),
          )
        }),
        Effect.catchCause(logFailure("event stream")),
        Effect.forkScoped,
      )
    }),
})
