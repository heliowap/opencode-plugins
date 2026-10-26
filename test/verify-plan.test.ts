import { expect, test } from "bun:test"
import { selectCommands } from "../src/verify-plan.ts"

const TYPECHECK = ["bun", "run", "typecheck"]
const UNIT = ["bun", "test"]
const HOST = ["bun", "test", "./host"]
const TUI = ["bun", "test", "./host/tui.test.ts"]
const MUTATION = ["bun", "run", "mutation"]
const mutate = ["src/goal.ts", "src/controls.ts"]

test("a docs-only change selects nothing", () => {
  expect(selectCommands(["AGENTS.md", "CODING_STANDARDS.md", "docs/guide.md", ".github/workflows/ci.yml"], mutate)).toEqual([])
})

test("no changed files select nothing", () => {
  expect(selectCommands([], mutate)).toEqual([])
})

test("a change under src/ selects typecheck and unit tests", () => {
  expect(selectCommands(["src/badge.ts"], mutate)).toEqual([TYPECHECK, UNIT])
})

test("a template change selects unit tests without typecheck", () => {
  expect(selectCommands(["templates/continuation.md"], mutate)).toEqual([UNIT])
})

test("a change to a unit test selects typecheck and unit tests", () => {
  expect(selectCommands(["test/prompts.test.ts"], mutate)).toEqual([TYPECHECK, UNIT])
})

test("a change to a mutated module selects mutation", () => {
  expect(selectCommands(["src/goal.ts"], mutate)).toEqual([TYPECHECK, UNIT, MUTATION])
})

test("a change to a unit test of a mutated module selects mutation", () => {
  expect(selectCommands(["test/controls.test.ts"], mutate)).toEqual([TYPECHECK, UNIT, MUTATION])
})

test("a change to the pure selection module selects unit tests", () => {
  expect(selectCommands(["src/verify-plan.ts"], [])).toEqual([TYPECHECK, UNIT])
})

test("a path only partly matching a rule selects nothing it does not match", () => {
  expect(selectCommands(["docs/snippet.ts.md"], mutate)).toEqual([])
  expect(selectCommands(["notes/host/budget.test.ts"], mutate)).toEqual([TYPECHECK])
  expect(selectCommands(["host/budget.test.tsx"], mutate)).toEqual([TYPECHECK])
  expect(selectCommands(["mytest/goal.test.ts"], mutate)).toEqual([TYPECHECK])
  expect(selectCommands(["test/goal.test.ts.bak"], mutate)).toEqual([UNIT])
})

test("a change to the CLI adapter alone selects typecheck only", () => {
  expect(selectCommands(["scripts/verify-changed.ts"], mutate)).toEqual([TYPECHECK])
})

test("a change to a single host test file selects typecheck and that file only", () => {
  expect(selectCommands(["host/budget.test.ts"], mutate)).toEqual([TYPECHECK, ["bun", "test", "./host/budget.test.ts"]])
})

test("a change under host/harness selects the full host suite", () => {
  expect(selectCommands(["host/harness/host.ts"], mutate)).toEqual([TYPECHECK, HOST])
})

test("a change to src/index.ts selects unit tests and the full host suite", () => {
  expect(selectCommands(["src/index.ts"], mutate)).toEqual([TYPECHECK, UNIT, HOST])
})

test("the full host suite subsumes single host files", () => {
  expect(selectCommands(["host/budget.test.ts", "host/harness/fixture.ts"], mutate)).toEqual([TYPECHECK, HOST])
})

test("a change to src/tui.tsx selects the tui host file", () => {
  expect(selectCommands(["src/tui.tsx"], mutate)).toEqual([TYPECHECK, UNIT, TUI])
})

test("the full host suite subsumes the tui host file", () => {
  expect(selectCommands(["src/tui.tsx", "host/harness/host.ts"], mutate)).toEqual([TYPECHECK, UNIT, HOST])
})

test("a tui change and a change to its host test select the tui host file once", () => {
  expect(selectCommands(["src/tui.tsx", "host/tui.test.ts", "host/tui.test.ts"], mutate)).toEqual([TYPECHECK, UNIT, TUI])
})

test("single host test files run in name order", () => {
  expect(selectCommands(["host/loop.test.ts", "host/budget.test.ts"], mutate)).toEqual([
    TYPECHECK,
    ["bun", "test", "./host/budget.test.ts"],
    ["bun", "test", "./host/loop.test.ts"],
  ])
})

test("the tui host file runs in name order among other single host files", () => {
  expect(selectCommands(["host/watchdog.test.ts", "src/tui.tsx"], mutate)).toEqual([
    TYPECHECK,
    UNIT,
    TUI,
    ["bun", "test", "./host/watchdog.test.ts"],
  ])
})

test("a changed module and its test select mutation once", () => {
  expect(selectCommands(["test/goal.test.ts", "src/goal.ts"], mutate)).toEqual([TYPECHECK, UNIT, MUTATION])
})

test("commands run in the order typecheck, unit, host, mutation, whatever the input order", () => {
  expect(selectCommands(["src/goal.ts", "host/loop.test.ts"], mutate)).toEqual([
    TYPECHECK,
    UNIT,
    ["bun", "test", "./host/loop.test.ts"],
    MUTATION,
  ])
})
