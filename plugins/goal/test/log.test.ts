import { afterEach, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { appendCapped, LOG_LIMIT, logPath, rotatedPath } from "../src/log.ts"

let dir: string | undefined

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

const temp = () => (dir = mkdtempSync(join(tmpdir(), "goal-log-")))

test("appends one line per call and creates missing directories", () => {
  const path = join(temp(), "log", "goal.jsonl")
  appendCapped(path, "one", 1_000)
  appendCapped(path, "two", 1_000)
  expect(readFileSync(path, "utf8")).toBe("one\ntwo\n")
})

test("rotates to goal.1.jsonl when the next line would pass half the limit", () => {
  const path = join(temp(), "goal.jsonl")
  for (const line of ["aaaa", "bbbb", "cccc"]) appendCapped(path, line, 20)
  expect(readFileSync(join(dir!, "goal.1.jsonl"), "utf8")).toBe("aaaa\nbbbb\n")
  expect(readFileSync(path, "utf8")).toBe("cccc\n")
})

test("a second rotation deletes the oldest lines, so both files stay within the limit", () => {
  const path = join(temp(), "goal.jsonl")
  for (let index = 0; index < 50; index++) appendCapped(path, `line ${String(index).padStart(2, "0")}`, 40)
  const rotated = join(dir!, "goal.1.jsonl")
  expect(statSync(path).size + statSync(rotated).size).toBeLessThanOrEqual(40)
  expect(readFileSync(path, "utf8")).toBe("line 48\nline 49\n")
  expect(readFileSync(rotated, "utf8")).toBe("line 46\nline 47\n")
})

test("the log keeps at most 200 MB", () => {
  expect(LOG_LIMIT).toBe(209_715_200)
})

test("a line of exactly half the limit is kept", () => {
  const path = join(temp(), "goal.jsonl")
  appendCapped(path, "123456789", 20)
  expect(readFileSync(path, "utf8")).toBe("123456789\n")
})

test("a line over half the limit is dropped instead of breaking the cap", () => {
  const path = join(temp(), "goal.jsonl")
  appendCapped(path, "x".repeat(30), 40)
  expect(existsSync(path)).toBe(false)
})

test("rotatedPath names the older file", () => {
  expect(rotatedPath("/data/goal.jsonl")).toBe("/data/goal.1.jsonl")
  expect(rotatedPath("/logs.jsonl.d/goal.jsonl")).toBe("/logs.jsonl.d/goal.1.jsonl")
})

test("logPath sits next to opencode.log in the data directory", () => {
  expect(logPath({ XDG_DATA_HOME: "/data" }, "/home/me")).toBe("/data/opencode/log/goal.jsonl")
  expect(logPath({}, "/home/me")).toBe("/home/me/.local/share/opencode/log/goal.jsonl")
  expect(logPath({ XDG_DATA_HOME: "" }, "/home/me")).toBe("/home/me/.local/share/opencode/log/goal.jsonl")
})
