import { readFileSync, realpathSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { formatTokens } from "./format.ts"
import type { Check, Goal } from "./goal.ts"

const moduleUrl = pathToFileURL(realpathSync(new URL(import.meta.url)))
const template = (name: string) => readFileSync(new URL(`../templates/${name}.md`, moduleUrl), "utf8").trim()

const templates = {
  continuation: template("continuation"),
  budgetLimit: template("budget_limit"),
  objectiveUpdated: template("objective_updated"),
  sessionContext: template("session_context"),
  subagentStalled: template("subagent_stalled"),
  loopWarning: template("loop_warning"),
}

export const render = (source: string, values: Record<string, string>) =>
  source.replace(/\{\{(\w+)\}\}/g, (match, key: string) => values[key] ?? match)

export const escapeXml = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

export const formatElapsed = (ms: number) => {
  const minutes = Math.floor(ms / 60_000)
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

const verifyRule = (command: string) =>
  `The user set a verify command: \`${escapeXml(command)}\`. goal_update with status "complete" runs it in the goal's directory and keeps the goal open unless it exits 0.`

const values = (goal: Goal, now: number) => ({
  objective: escapeXml(goal.objective),
  tokensUsed: String(goal.tokensUsed),
  tokenBudget: goal.tokenBudget === null ? "none" : String(goal.tokenBudget),
  tokensRemaining: goal.tokenBudget === null ? "unbounded" : String(Math.max(0, goal.tokenBudget - goal.tokensUsed)),
  elapsed: formatElapsed(now - goal.createdAt),
  verification: goal.verify === undefined ? "" : `\n\nVerification:\n${verifyRule(goal.verify)}`,
  verifyRule: goal.verify === undefined ? "" : `${verifyRule(goal.verify)} `,
})

export const continuationPrompt = (goal: Goal, now: number) => render(templates.continuation, values(goal, now))
export const budgetLimitPrompt = (goal: Goal, now: number) => render(templates.budgetLimit, values(goal, now))
export const objectiveUpdatedPrompt = (goal: Goal, now: number) => render(templates.objectiveUpdated, values(goal, now))
export const sessionContext = (goal: Goal, now: number) => render(templates.sessionContext, values(goal, now))

export const subagentStalledText = (sessionID: string, idleMs: number) =>
  render(templates.subagentStalled, { sessionID, elapsed: formatElapsed(idleMs) })

export const loopWarningText = (command: string) => render(templates.loopWarning, { command: command.slice(0, 200) })

const usage = (goal: Goal) =>
  goal.tokenBudget === null
    ? `${formatTokens(goal.tokensUsed)} tokens, no budget`
    : `${formatTokens(goal.tokensUsed)} / ${formatTokens(goal.tokenBudget)} tokens`

export const COMMAND_HELP = [
  "User commands:",
  '/goal [--tokens N] [--verify "cmd"] <objective>',
  "                                 set or replace the goal (N accepts 50000, 250K, 1.5M)",
  "                                 completing it requires cmd to exit 0",
  "/goal                            show status and token usage",
  "/goal edit <objective>           change the objective, keeping usage",
  "/goal pause | resume | clear",
].join("\n")

export const statusText = (goal: Goal | undefined, now: number) => {
  if (!goal) return 'No goal is set for this session. Set one with /goal [--tokens N] [--verify "cmd"] <objective>.'
  return [
    `Goal ${goal.status} · ${usage(goal)} · ${formatElapsed(now - goal.createdAt)}`,
    goal.objective,
    ...(goal.note ? [`Note: ${goal.note}`] : []),
    ...(goal.verify === undefined ? [] : [`Verify: ${goal.verify}${checks(goal)}`]),
  ].join("\n")
}

const checks = (goal: Goal) => {
  const failures = goal.verifyFailures ?? 0
  if (failures === 0) return ""
  return ` · ${failures} failed ${failures === 1 ? "check" : "checks"}, last exit code ${goal.lastExitCode}`
}

const OUTPUT_TAIL = 2_000

export const verifyFailedText = (goal: Goal, check: Check & { readonly output: string }) =>
  [
    `The goal is not complete: the verify command \`${check.command}\` exited with code ${check.exitCode} (failed check ${goal.verifyFailures}).`,
    `Fix the cause and call goal_update with status "complete" again once it passes. ${
      check.output.trim() ? `Last ${OUTPUT_TAIL} characters of its output:\n${check.output.slice(-OUTPUT_TAIL)}` : "It printed nothing."
    }`,
  ].join("\n")
