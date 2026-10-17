import { Plugin } from "@opencode/plugin/effect"
import { Tool } from "@opencode/schema/tool"
import { Cause, Effect, Schema, Semaphore, Stream } from "effect"
import { spawn } from "node:child_process"
import { homedir } from "node:os"
import { parseCommand, type GoalCommand } from "./command.ts"
import { formatTokens } from "./format.ts"
import { decodeGoal, editRefusal, isUnfinished, RETRY_LIMIT, step, type Check, type Goal, type GoalEffect, type GoalEvent } from "./goal.ts"
import {
  budgetLimitPrompt,
  COMMAND_HELP,
  continuationPrompt,
  objectiveUpdatedPrompt,
  sessionContext,
  statusText,
  verifyFailedText,
} from "./prompts.ts"
import { appendCapped, LOG_LIMIT, logPath } from "./log.ts"
import { GoalRpc } from "./rpc.ts"
import { commandRecord, errorRecord, logEnabled, toolErrorRecord, transitionRecord, type TraceRecord } from "./trace.ts"

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

const RETRY_DELAYS_MS = [30_000, 120_000, 300_000]

// Host canaries shorten the waits.
const retryDelays = (raw: string | undefined) => {
  const parsed = raw?.split(",").map(Number)
  return parsed?.length === RETRY_LIMIT && parsed.every((ms) => Number.isFinite(ms) && ms >= 0)
    ? parsed
    : RETRY_DELAYS_MS
}

const KEY_PREFIX = "goal/"

// Per-turn bookkeeping for one location. It lives on globalThis so a plugin reload inside a running
// server keeps the turns already in flight, while a process restart starts clean.
interface LocationState {
  readonly activity: Set<string>
  readonly agents: Map<string, string>
  readonly resumePending: Set<string>
  readonly closingSteps: Map<string, string>
}

const LOCATIONS: Map<string, LocationState> = ((globalThis as Record<symbol, Map<string, LocationState> | undefined>)[
  Symbol.for("opencode-v2-goal-plugin/locations")
] ??= new Map())

const locationState = (directory: string) => {
  const existing = LOCATIONS.get(directory)
  if (existing) return { state: existing, fresh: false }
  const state: LocationState = { activity: new Set(), agents: new Map(), resumePending: new Set(), closingSteps: new Map() }
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

const eventSession = (event: { readonly data?: unknown }) => {
  const sessionID = (event.data as { readonly sessionID?: unknown } | undefined)?.sessionID
  return typeof sessionID === "string" ? sessionID : undefined
}

const toolError = (error: unknown) =>
  error instanceof Tool.Error ? error : new Tool.Error({ message: `goal: ${String(error)}` })

export default Plugin.define({
  id: "goal",
  effect: (ctx) =>
    Effect.gen(function* () {
      const lock = yield* Semaphore.make(1)
      const scope = yield* Effect.scope
      const delays = retryDelays(process.env.GOAL_RETRY_DELAYS_MS)
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

      const failure = (where: string, sessionID?: string) => (cause: Cause.Cause<unknown>) =>
        Effect.logError(`goal: ${where} failed`, cause).pipe(
          Effect.andThen(trace(errorRecord(where, Cause.pretty(cause), sessionID, now()))),
        )
      const { state, fresh } = locationState(ctx.location.directory)
      const { activity, agents, resumePending, closingSteps } = state
      const key = (sessionID: string) => `${KEY_PREFIX}${sessionID}`
      const now = () => Date.now()
      const planning = (sessionID: string) => PLANNING_AGENTS.has(agents.get(sessionID) ?? "")

      const load = (sessionID: string) => ctx.storage.get(key(sessionID)).pipe(Effect.map(decodeGoal))

      const rpc = yield* ctx.rpc
        .register(GoalRpc, {
          get: (input) => load((input as { sessionID: string }).sessionID).pipe(Effect.map((goal) => ({ goal: goal ?? null }))),
          edit: (input) => {
            const { sessionID, objective } = input as { sessionID: string; objective: string }
            return transition(sessionID, { _tag: "Edit", objective }).pipe(
              Effect.map(({ goal }) => ({ goal: goal ?? null })),
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

      const scheduleRetry = (sessionID: string, attempt: number) =>
        Effect.forkIn(
          Effect.sleep(delays[attempt - 1]!).pipe(
            Effect.andThen(onEvent(sessionID, { _tag: "RetryDue", attempt })),
            Effect.catchCause(failure("retry", sessionID)),
          ),
          scope,
        ).pipe(Effect.asVoid)

      const perform = (sessionID: string, goal: Goal | undefined, effect: GoalEffect) => {
        switch (effect._tag) {
          case "None":
            return Effect.void
          case "Notify":
            return notice(sessionID, effect.text)
          case "Continue":
            return goal ? queue(sessionID, continuationPrompt(goal, now())) : Effect.void
          case "WrapUp":
            return goal ? steer(sessionID, budgetLimitPrompt(goal, now())) : Effect.void
          case "ObjectiveUpdated":
            return goal ? steer(sessionID, objectiveUpdatedPrompt(goal, now())) : Effect.void
          case "Retry":
            return scheduleRetry(sessionID, effect.attempt)

        }
      }

      // Annotated because the goal.edit RPC handler and transition refer to each other.
      const transition = (
        sessionID: string,
        event: GoalEvent,
        options: { readonly quiet?: boolean } = {},
      ): Effect.Effect<{ readonly before: Goal | undefined; readonly goal: Goal | undefined }, unknown> =>
        lock.withPermits(1)(
          Effect.gen(function* () {
            const before = yield* load(sessionID)
            const next = step(before, event, now())
            yield* trace(transitionRecord(sessionID, event, before, next.goal, next.effect, now()))
            if (next.goal !== before) {
              yield* save(sessionID, next.goal)
              yield* rpc.events
                .emit("changed", { sessionID, goal: next.goal ?? null })
                .pipe(Effect.catchCause(failure("changed event", sessionID)))
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

      const run = (sessionID: string, command: GoalCommand) => {
        switch (command._tag) {
          case "Invalid":
            return notice(sessionID, command.message)
          case "Status":
            return load(sessionID).pipe(Effect.flatMap((goal) => notice(sessionID, statusText(goal, now()))))
          case "EditPrompt":
            return load(sessionID).pipe(
              Effect.flatMap((goal) => {
                const refusal = editRefusal(goal)
                return refusal === undefined
                  ? rpc.events.emit("editRequested", { sessionID, objective: goal!.objective })
                  : notice(sessionID, refusal)
              }),
            )
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
            return trace(commandRecord(sessionID, prompt.text.trim(), command, now())).pipe(Effect.andThen(run(sessionID, command)))
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
            }).pipe(
              Effect.mapError(toolError),
              Effect.tapError((error) => trace(toolErrorRecord(context.sessionID, "goal_create", error.message, now()))),
            ),
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
              Effect.mapError(toolError),
              Effect.tapError((error) => trace(toolErrorRecord(context.sessionID, "goal_get", error.message, now()))),
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
            }).pipe(
              Effect.mapError(toolError),
              Effect.tapError((error) => trace(toolErrorRecord(context.sessionID, "goal_update", error.message, now()))),
            ),
        })
      })

      yield* ctx.tool.hook("execute.after", (event) => Effect.sync(() => activity.add(event.sessionID)))

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
            })
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
            return onEvent(event.data.sessionID, {
              _tag: "TurnEnded",
              activity: activity.has(event.data.sessionID),
              planning: planning(event.data.sessionID),
            })
          case "session.execution.interrupted":
            return onEvent(event.data.sessionID, { _tag: "Interrupted", reason: event.data.reason })
          case "session.execution.failed":
            return onEvent(event.data.sessionID, {
              _tag: "Failed",
              message: event.data.error.message,
              ...(event.data.error.status !== undefined && { status: event.data.error.status }),
            })
          case "session.moved":
            return onEvent(event.data.sessionID, { _tag: "Moved", directory: event.data.location.directory })
          case "session.deleted":
            return onEvent(event.data.sessionID, { _tag: "Clear" }, { quiet: true })
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

      // A reload closes the previous scope and with it any pending retry wait.
      const startup = fresh
        ? forActiveGoals((sessionID) => transition(sessionID, { _tag: "Recovered" }, { quiet: true }))
        : forActiveGoals((sessionID, goal) => (goal.failedTurns ? scheduleRetry(sessionID, goal.failedTurns) : Effect.void))
      yield* startup.pipe(Effect.catchCause(failure("recovery")))

      yield* ctx.event.subscribe().pipe(
        Stream.runForEach((event) =>
          handle(event).pipe(Effect.catchCause(failure(event.type, eventSession(event)))),
        ),
        Effect.catchCause(failure("event stream")),
        Effect.forkScoped,
      )
    }),
})
