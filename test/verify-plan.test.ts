import { expect, test } from "bun:test"
import { importClosure, type Plan, selectCommands } from "../src/verify-plan.ts"

const TYPECHECK = ["bun", "run", "typecheck"]
const UNIT = ["bun", "test", "--coverage"]
const HOST = ["bun", "test", "./host"]
const TUI = ["bun", "test", "./host/tui.test.ts"]
const MUTATION = ["bun", "run", "mutation"]
const hostFile = (file: string) => ["bun", "test", `./${file}`]

const plan: Plan = {
  mutate: ["src/goal.ts", "src/controls.ts", "src/verify-plan.ts"],
  indexGraph: ["src/index.ts", "src/goal.ts", "src/rpc.ts"],
  tuiGraph: ["src/tui.tsx", "src/badge.ts", "src/rpc.ts"],
  exists: () => true,
}

const select = (changed: string[], overrides: Partial<Plan> = {}) => selectCommands(changed, { ...plan, ...overrides })

test("a docs-only change selects nothing", () => {
  expect(select(["AGENTS.md", "CODING_STANDARDS.md", "README.md", "docs/guide.md", ".github/workflows/ci.yml"])).toEqual([])
})

test("no changed files select nothing", () => {
  expect(select([])).toEqual([])
})

test("a docs file that only looks like a source file selects nothing", () => {
  expect(select(["docs/snippet.ts.md"])).toEqual([])
})

test("a change under src/ selects typecheck and unit tests", () => {
  expect(select(["src/format.ts"])).toEqual([TYPECHECK, UNIT])
})

test("a change to a module only the index imports selects the full host suite", () => {
  expect(select(["src/rpc.ts"])).toEqual([TYPECHECK, UNIT, HOST])
})

test("a change to src/index.ts selects the full host suite", () => {
  expect(select(["src/index.ts"])).toEqual([TYPECHECK, UNIT, HOST])
})

test("a change to a mutated module in the index graph selects the full host suite and mutation", () => {
  expect(select(["src/goal.ts"])).toEqual([TYPECHECK, UNIT, HOST, MUTATION])
})

test("a change to a file only the tui imports selects the tui host file", () => {
  expect(select(["src/badge.ts"])).toEqual([TYPECHECK, UNIT, TUI])
})

test("a change to src/tui.tsx selects the tui host file", () => {
  expect(select(["src/tui.tsx"])).toEqual([TYPECHECK, UNIT, TUI])
})

test("a tui change and a host/harness change select the full host suite only", () => {
  expect(select(["src/tui.tsx", "host/harness/host.ts"])).toEqual([TYPECHECK, UNIT, HOST])
})

test("a change to a mutated module selects mutation", () => {
  expect(select(["src/controls.ts"])).toEqual([TYPECHECK, UNIT, MUTATION])
})

test("a change to the pure selection module selects mutation", () => {
  expect(select(["src/verify-plan.ts"])).toEqual([TYPECHECK, UNIT, MUTATION])
})

test("a change to a unit test selects typecheck and unit tests", () => {
  expect(select(["test/prompts.test.ts"])).toEqual([TYPECHECK, UNIT])
})

test("a change to a unit test of a mutated module selects mutation", () => {
  expect(select(["test/controls.test.ts"])).toEqual([TYPECHECK, UNIT, MUTATION])
})

test("a changed module and its test select mutation once", () => {
  expect(select(["test/controls.test.ts", "src/controls.ts"])).toEqual([TYPECHECK, UNIT, MUTATION])
})

test("a template change selects unit tests and the full host suite, without typecheck", () => {
  expect(select(["templates/continuation.md"])).toEqual([UNIT, HOST])
})

test("a change to the CLI adapter selects typecheck and unit tests", () => {
  expect(select(["scripts/verify-changed.ts"])).toEqual([TYPECHECK, UNIT])
  expect(select(["scripts/x.ts"])).toEqual([TYPECHECK, UNIT])
})

test("a change to bunfig.toml selects unit tests", () => {
  expect(select(["bunfig.toml"])).toEqual([UNIT])
})

test("a change to tsconfig.json selects typecheck only", () => {
  expect(select(["tsconfig.json"])).toEqual([TYPECHECK])
})

test("a change to package.json or bun.lock selects typecheck, unit tests and the full host suite", () => {
  expect(select(["package.json"])).toEqual([TYPECHECK, UNIT, HOST])
  expect(select(["bun.lock"])).toEqual([TYPECHECK, UNIT, HOST])
})

test("a change to stryker.config.json selects mutation only", () => {
  expect(select(["stryker.config.json"])).toEqual([MUTATION])
})

test("a change under host/live selects typecheck only", () => {
  expect(select(["host/live/x.ts"])).toEqual([TYPECHECK])
})

test("a change to a single host test file selects typecheck and that file only", () => {
  expect(select(["host/budget.test.ts"])).toEqual([TYPECHECK, hostFile("host/budget.test.ts")])
})

test("a change under host/harness selects the full host suite", () => {
  expect(select(["host/harness/host.ts"])).toEqual([TYPECHECK, HOST])
})

test("a non-test file under host selects the full host suite, whatever its extension", () => {
  expect(select(["host/notes.md"])).toEqual([HOST])
  expect(select(["host/budget.test.tsx"])).toEqual([TYPECHECK, HOST])
})

test("a deleted host test file is not selected", () => {
  expect(select(["host/gone.test.ts"], { exists: () => false })).toEqual([TYPECHECK])
})

test("a deleted tui host test file is not selected for a tui change", () => {
  expect(select(["src/tui.tsx"], { exists: (file) => file !== "host/tui.test.ts" })).toEqual([TYPECHECK, UNIT])
})

test("the full host suite subsumes single host files", () => {
  expect(select(["host/budget.test.ts", "host/harness/fixture.ts"])).toEqual([TYPECHECK, HOST])
  expect(select(["package.json", "host/budget.test.ts"])).toEqual([TYPECHECK, UNIT, HOST])
})

test("a tui change and a change to its host test select the tui host file once", () => {
  expect(select(["src/tui.tsx", "host/tui.test.ts", "host/tui.test.ts"])).toEqual([TYPECHECK, UNIT, TUI])
})

test("single host test files run in name order", () => {
  expect(select(["host/loop.test.ts", "host/budget.test.ts"])).toEqual([
    TYPECHECK,
    hostFile("host/budget.test.ts"),
    hostFile("host/loop.test.ts"),
  ])
})

test("the tui host file runs in name order among other single host files", () => {
  expect(select(["host/watchdog.test.ts", "src/badge.ts"])).toEqual([
    TYPECHECK,
    UNIT,
    TUI,
    hostFile("host/watchdog.test.ts"),
  ])
})

test("a path only partly matching a rule selects nothing it does not match", () => {
  expect(select(["notes/host/budget.test.ts"])).toEqual([TYPECHECK])
  expect(select(["mytest/goal.test.ts"])).toEqual([TYPECHECK])
  expect(select(["test/goal.test.ts.bak"])).toEqual([UNIT])
})

test("commands run in the order typecheck, unit, host, mutation, whatever the input order", () => {
  expect(select(["src/controls.ts", "host/loop.test.ts"])).toEqual([
    TYPECHECK,
    UNIT,
    hostFile("host/loop.test.ts"),
    MUTATION,
  ])
})

test("the import closure follows relative imports transitively and keeps only src files", () => {
  const imports: Record<string, string[]> = {
    "src/index.ts": ["src/command.ts", "src/rpc.ts", "host/harness/host.ts"],
    "src/command.ts": ["src/format.ts"],
    "src/rpc.ts": ["src/index.ts"],
  }
  expect(importClosure("src/index.ts", (file) => imports[file] ?? [])).toEqual([
    "src/command.ts",
    "src/format.ts",
    "src/index.ts",
    "src/rpc.ts",
  ])
})

test("the import closure of a file with no imports is the file itself", () => {
  expect(importClosure("src/tui.tsx", () => [])).toEqual(["src/tui.tsx"])
})
