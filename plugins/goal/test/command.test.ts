import { expect, test } from "bun:test"
import { parseCommand, parseTokens } from "../src/command.ts"

test.each([
  ["", { _tag: "Status" }],
  ["  status ", { _tag: "Status" }],
  ["pause", { _tag: "Pause" }],
  ["RESUME", { _tag: "Resume" }],
  ["clear", { _tag: "Clear" }],
  ["edit only fix the login test", { _tag: "Edit", objective: "only fix the login test" }],
  ["edit", { _tag: "EditPrompt" }],
  ["EDIT", { _tag: "EditPrompt" }],
  ["edit   spaced   objective", { _tag: "Edit", objective: "spaced   objective" }],
  ["editorial pass on the docs", { _tag: "Set", objective: "editorial pass on the docs", tokenBudget: null, verify: null }],
  ["audit the edit history", { _tag: "Set", objective: "audit the edit history", tokenBudget: null, verify: null }],
  ["fix the flaky auth tests", { _tag: "Set", objective: "fix the flaky auth tests", tokenBudget: null, verify: null }],
  ["--tokens 50000 migrate to vitest", { _tag: "Set", objective: "migrate to vitest", tokenBudget: 50_000, verify: null }],
  ["--tokens=250K shrink the bundle", { _tag: "Set", objective: "shrink the bundle", tokenBudget: 250_000, verify: null }],
  ["--tokens 1.5m port the parser", { _tag: "Set", objective: "port the parser", tokenBudget: 1_500_000, verify: null }],
  ["--tokens   5K   spaced   objective", { _tag: "Set", objective: "spaced   objective", tokenBudget: 5_000, verify: null }],
  ["fix --tokens 5K parsing", { _tag: "Set", objective: "fix --tokens 5K parsing", tokenBudget: null, verify: null }],
  ["--tokens 0 x", { _tag: "Invalid", message: '--tokens needs a positive number such as 50000, 250K or 1.5M, got "0".' }],
  ["--tokens abc x", { _tag: "Invalid", message: '--tokens needs a positive number such as 50000, 250K or 1.5M, got "abc".' }],
  ["--tokens 3K", { _tag: "Invalid", message: "Write the objective after the options." }],
  ['--verify "bun test" make it green', { _tag: "Set", objective: "make it green", tokenBudget: null, verify: "bun test" }],
  ["--verify 'test -f done.txt' write it", { _tag: "Set", objective: "write it", tokenBudget: null, verify: "test -f done.txt" }],
  ["--verify=make write it", { _tag: "Set", objective: "write it", tokenBudget: null, verify: "make" }],
  ['--tokens 5K --verify "bun test" ship', { _tag: "Set", objective: "ship", tokenBudget: 5_000, verify: "bun test" }],
  ['--verify "bun test" --tokens 5K ship', { _tag: "Set", objective: "ship", tokenBudget: 5_000, verify: "bun test" }],
  ['--VERIFY   "a b"   spaced', { _tag: "Set", objective: "spaced", tokenBudget: null, verify: "a b" }],
  ['fix --verify "x" parsing', { _tag: "Set", objective: 'fix --verify "x" parsing', tokenBudget: null, verify: null }],
  ['--verify "" x', { _tag: "Invalid", message: '--verify needs a command such as --verify "bun test".' }],
  ['--verify "unclosed x', { _tag: "Invalid", message: '--verify needs a command such as --verify "bun test".' }],
  ['--verify "open --verify=c x', { _tag: "Invalid", message: '--verify needs a command such as --verify "bun test".' }],
  ["--verify", { _tag: "Invalid", message: '--verify needs a command such as --verify "bun test".' }],
  ['--verify "bun test"', { _tag: "Invalid", message: "Write the objective after the options." }],
  ['--verify "a" --verify "b" x', { _tag: "Invalid", message: "--verify can be given only once." }],
  ["--tokens 1K --tokens 2K x", { _tag: "Invalid", message: "--tokens can be given only once." }],
] as const)("parseCommand(%p)", (input, expected) => {
  expect(parseCommand(input)).toEqual(expected)
})

test.each([
  ["2k", 2_000],
  ["2K", 2_000],
  ["0.5m", 500_000],
  ["1.25m", 1_250_000],
  ["10", 10],
  ["0.0001", undefined],
  ["-5", undefined],
  ["5x", undefined],
  ["", undefined],
] as const)("parseTokens(%p) = %p", (text, expected) => {
  expect(parseTokens(text)).toBe(expected)
})
