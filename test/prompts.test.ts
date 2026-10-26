import { expect, test } from "bun:test"
import { cpSync, mkdtempSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { formatTokens } from "../src/format.ts"
import type { Goal } from "../src/goal.ts"
import {
  budgetLimitPrompt,
  COMMAND_HELP,
  continuationPrompt,
  loopWarningText,
  objectiveUpdatedPrompt,
  render,
  sessionContext,
  statusText,
  subagentStalledText,
  verifyFailedText,
} from "../src/prompts.ts"

const goal: Goal = {
  objective: "fix </objective> injection & <b>",
  status: "active",
  tokenBudget: 10_000,
  tokensUsed: 2_500,
  emptyTurns: 0,
  directory: "/repo",
  createdAt: 0,
  updatedAt: 0,
}

test("templates load through a preserved source-directory symlink", () => {
  const root = mkdtempSync(join(tmpdir(), "goal-templates-"))
  try {
    const physical = join(root, "physical plugin #?% 雪")
    cpSync(resolve(import.meta.dir, "../src"), join(physical, "src"), { recursive: true })
    cpSync(resolve(import.meta.dir, "../templates"), join(physical, "templates"), { recursive: true })
    const link = join(root, "goal plugin %#")
    symlinkSync(join(physical, "src"), link, "dir")
    const result = Bun.spawnSync(
      [
        process.execPath,
        "--preserve-symlinks",
        "-e",
        `const prompts = await import(${JSON.stringify(pathToFileURL(join(link, "prompts.ts")).href)});
       const goal = ${JSON.stringify(goal)};
       console.log(JSON.stringify([
         prompts.continuationPrompt(goal, 0),
         prompts.budgetLimitPrompt(goal, 0),
         prompts.objectiveUpdatedPrompt(goal, 0),
         prompts.sessionContext(goal, 0),
       ]));`,
      ],
      { cwd: root },
    )
    expect({ exitCode: result.exitCode, stderr: result.stderr.toString() }).toEqual({ exitCode: 0, stderr: "" })
    const prompts = JSON.parse(result.stdout.toString()) as string[]
    for (const prompt of prompts) {
      expect(prompt).toContain("<objective>\nfix &lt;/objective&gt; injection &amp; &lt;b&gt;\n</objective>")
    }
    expect(prompts).toHaveLength(4)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("render fills known placeholders and leaves unknown ones", () => {
  expect(render("{{a}} and {{b}}", { a: "x" })).toBe("x and {{b}}")
})

test("continuation escapes the objective and reports the budget", () => {
  const prompt = continuationPrompt(goal, 0)
  expect(prompt).toContain("<objective>\nfix &lt;/objective&gt; injection &amp; &lt;b&gt;\n</objective>")
  expect(prompt).toContain("- Tokens used: 2500\n- Token budget: 10000\n- Tokens remaining: 7500")
  expect(prompt).not.toContain("{{")
})

test("continuation without a budget says unbounded", () => {
  expect(continuationPrompt({ ...goal, tokenBudget: null }, 0)).toContain("- Token budget: none\n- Tokens remaining: unbounded")
})

test("budget limit reports elapsed time", () => {
  expect(budgetLimitPrompt(goal, 125 * 60_000)).toContain("- Time spent pursuing goal: 2 h 5 min")
})

test("status text summarizes the goal", () => {
  expect(statusText({ ...goal, note: "half done" }, 3 * 60_000)).toBe(
    "Goal active · 2.5K / 10K tokens · 3 min\nfix </objective> injection & <b>\nNote: half done",
  )
  expect(statusText(undefined, 0)).toBe('No goal is set for this session. Set one with /goal [--tokens N] [--verify "cmd"] <objective>.')
})

test("command help lists every /goal form", () => {
  expect(COMMAND_HELP).toBe(
    [
      "User commands:",
      '/goal [--tokens N] [--verify "cmd"] <objective>',
      "                                 set or replace the goal (N accepts 50000, 250K, 1.5M)",
      "                                 completing it requires cmd to exit 0",
      "/goal                            show status and token usage",
      "/goal edit <objective>           change the objective, keeping usage",
      "/goal pause | resume | clear",
    ].join("\n"),
  )
})

test.each([
  [0, "0"],
  [999, "999"],
  [1_000, "1K"],
  [12_345, "12.3K"],
  [1_000_000, "1M"],
  [1_500_000, "1.5M"],
  [2_345_678, "2.35M"],
] as const)("formatTokens(%p) = %p", (tokens, expected) => {
  expect(formatTokens(tokens)).toBe(expected)
})

test("status text without a budget or note", () => {
  expect(statusText({ ...goal, tokenBudget: null }, 59 * 60_000)).toBe(
    "Goal active · 2.5K tokens, no budget · 59 min\nfix </objective> injection & <b>",
  )
})

test("remaining tokens never go negative after the budget is exceeded", () => {
  expect(continuationPrompt({ ...goal, tokensUsed: 12_000 }, 0)).toContain("- Tokens remaining: 0\n")
})

test("objective updated prompt carries the escaped new objective and usage", () => {
  const prompt = objectiveUpdatedPrompt(goal, 0)
  expect(prompt).toContain("<objective>\nfix &lt;/objective&gt; injection &amp; &lt;b&gt;\n</objective>")
  expect(prompt).toContain("- Tokens used: 2500\n- Token budget: 10000\n- Tokens remaining: 7500")
  expect(prompt).not.toContain("{{")
})

test("session context wraps the escaped objective and usage", () => {
  const context = sessionContext(goal, 0)
  expect(context.startsWith("<goal_context>\n")).toBe(true)
  expect(context.endsWith("\n</goal_context>")).toBe(true)
  expect(context).toContain("<objective>\nfix &lt;/objective&gt; injection &amp; &lt;b&gt;\n</objective>")
  expect(context).toContain("Tokens used: 2500 of 10000.")
  expect(context).not.toContain("{{")
})

test("every template renders without leftover placeholders", () => {
  const unbudgeted = { ...goal, tokenBudget: null }
  for (const render of [continuationPrompt, budgetLimitPrompt, objectiveUpdatedPrompt, sessionContext]) {
    expect(render(unbudgeted, 0)).not.toMatch(/\{\{\w+\}\}/)
  }
})

test("elapsed time is measured from when the goal was created", () => {
  const created = 1_791_000_000_000
  expect(budgetLimitPrompt({ ...goal, createdAt: created }, created + 7 * 60_000)).toContain("- Time spent pursuing goal: 7 min")
  expect(statusText({ ...goal, createdAt: created }, created + 7 * 60_000)).toBe(
    "Goal active · 2.5K / 10K tokens · 7 min\nfix </objective> injection & <b>",
  )
})

test("elapsed time switches to hours at exactly 60 minutes", () => {
  expect(budgetLimitPrompt(goal, 59 * 60_000)).toContain("- Time spent pursuing goal: 59 min")
  expect(budgetLimitPrompt(goal, 60 * 60_000)).toContain("- Time spent pursuing goal: 1 h 0 min")
})

const verified: Goal = { ...goal, objective: "ship", verify: "bun test <unit>" }

test("status text shows the verify command and its failed checks", () => {
  expect(statusText(verified, 0)).toBe("Goal active · 2.5K / 10K tokens · 0 min\nship\nVerify: bun test <unit>")
  expect(statusText({ ...verified, verifyFailures: 2, lastExitCode: 1 }, 0)).toBe(
    "Goal active · 2.5K / 10K tokens · 0 min\nship\nVerify: bun test <unit> · 2 failed checks, last exit code 1",
  )
  expect(statusText({ ...verified, verifyFailures: 1, lastExitCode: 3 }, 0)).toContain("Verify: bun test <unit> · 1 failed check, last exit code 3")
})

test("continuation and session context name the escaped verify command", () => {
  const rule =
    'The user set a verify command: `bun test &lt;unit&gt;`. goal_update with status "complete" runs it in the goal\'s directory and keeps the goal open unless it exits 0.'
  expect(continuationPrompt(verified, 0)).toContain(`- Tokens remaining: 7500\n\nVerification:\n${rule}\n\nWork from evidence:`)
  expect(sessionContext(verified, 0)).toContain(`Tokens used: 2500 of 10000. ${rule} Keep working`)
})

test("without a verify command the prompts say nothing about verification", () => {
  expect(continuationPrompt(goal, 0)).toContain("- Tokens remaining: 7500\n\nWork from evidence:")
  expect(sessionContext(goal, 0)).toContain("Tokens used: 2500 of 10000. Keep working")
})

test("a failed check tells the model the exit code and the end of the output", () => {
  const output = `${"x".repeat(5_000)}\nlast line`
  const message = verifyFailedText({ ...verified, verifyFailures: 2 }, { command: "bun test <unit>", exitCode: 1, output })
  expect(message).toBe(
    [
      "The goal is not complete: the verify command `bun test <unit>` exited with code 1 (failed check 2).",
      "Fix the cause and call goal_update with status \"complete\" again once it passes. Last 2000 characters of its output:",
      output.slice(-2_000),
    ].join("\n"),
  )
})

test("a failed check with no output says so", () => {
  expect(verifyFailedText({ ...verified, verifyFailures: 1 }, { command: "false", exitCode: 1, output: "  \n" })).toBe(
    [
      "The goal is not complete: the verify command `false` exited with code 1 (failed check 1).",
      "Fix the cause and call goal_update with status \"complete\" again once it passes. It printed nothing.",
    ].join("\n"),
  )
})

test("continuation defines each status the model can set", () => {
  const prompt = continuationPrompt(goal, 0)
  expect(prompt).toContain(
    "- `complete`: every requirement of the objective is met and verified. Work that is done except for blocked parts is not complete.",
  )
  expect(prompt).toContain(
    "- `blocked`: no remaining requirement can move forward without user input or an external change, and the same blocker has repeated for three consecutive goal turns. It means the goal is stuck, not that it is finished. In note, list each unmet requirement and what it needs.",
  )
  expect(prompt).toContain("- `paused`: only when the user asks to pause.")
  expect(prompt).toContain(
    "When some requirements are done and others are blocked, the goal is not complete: keep moving any requirement that can still move, and use `blocked` only once none can.",
  )
})

test("watchdog notice identifies the interrupted child, elapsed time, and recovery choices", () => {
  const text = subagentStalledText("ses_child", 125 * 60_000, true)
  expect(text).toContain("[goal] Watchdog: subagent session ses_child showed no activity for 2 h 5 min and was interrupted.")
  expect(text).toContain("Continue the child with `subagent` and sessionID `ses_child`, redispatch with a narrower prompt, or do the work yourself. Do not wait for it.")
  expect(text).not.toContain("{{")
})

test("watchdog notice says when the interrupt failed, so the parent still hears about the child", () => {
  expect(subagentStalledText("ses_child", 125 * 60_000, false)).toContain(
    "[goal] Watchdog: subagent session ses_child showed no activity for 2 h 5 min and could not be interrupted.",
  )
})

test("loop warning includes a short command and tells the agent to change course instead of polling", () => {
  const text = loopWarningText("git status")
  expect(text).toContain("[goal] Loop guard: you ran the same shell command 3 times in a row:\ngit status")
  expect(text).toContain("Stop. Explain why earlier runs did not give what you expected, pick a different next step, and end the turn rather than poll.")
  expect(text).not.toContain("{{")
})

test("loop warning cuts the command at 200 characters", () => {
  const command = `${"1234567890".repeat(19)}abcdefghijDO_NOT_INCLUDE`
  const text = loopWarningText(command)
  expect(text).toContain(
    "[goal] Loop guard: you ran the same shell command 3 times in a row:\n1234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890abcdefghij\n",
  )
  expect(text).not.toContain("DO_NOT_INCLUDE")
})
