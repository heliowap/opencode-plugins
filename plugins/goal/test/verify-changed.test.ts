import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

const script = resolve(import.meta.dir, "../scripts/verify-changed.ts")
const USAGE = "usage: bun run verify:changed [--base <ref>] [--dry-run]\n"

let dir: string | undefined

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

function git(repo: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", "-c", "user.name=test", "-c", "user.email=test@example.com", ...args], {
    cwd: repo,
    stdout: "pipe",
    stderr: "pipe",
  })
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`)
  return result.stdout.toString().trim()
}

function write(repo: string, path: string, text: string) {
  mkdirSync(dirname(join(repo, path)), { recursive: true })
  writeFileSync(join(repo, path), text)
}

function verify(repo: string, ...args: string[]) {
  const result = Bun.spawnSync([process.execPath, script, ...args], { cwd: repo, stdout: "pipe", stderr: "pipe" })
  return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() }
}

function dryRun(repo: string, base: string) {
  return verify(repo, "--dry-run", "--base", base)
}

function throwawayRepo(files: Record<string, string> = {}): string {
  dir = mkdtempSync(join(tmpdir(), "verify-changed-"))
  const repo = dir
  git(repo, "init", "-q")
  write(repo, "stryker.config.json", JSON.stringify({ mutate: ["src/goal.ts"] }))
  write(repo, "src/goal.ts", "export const goal = 1\n")
  write(repo, "README.md", "# repo\n")
  for (const [path, text] of Object.entries(files)) write(repo, path, text)
  git(repo, "add", "-A")
  git(repo, "commit", "-q", "-m", "base")
  return repo
}

test("--dry-run unions committed, uncommitted and untracked changes and prints the selected commands", () => {
  const repo = throwawayRepo({ "src/index.ts": "export {}\n" })
  const base = git(repo, "rev-parse", "HEAD")
  write(repo, "src/index.ts", "export const index = 2\n")
  git(repo, "add", "-A")
  git(repo, "commit", "-q", "-m", "change index")
  write(repo, "src/goal.ts", "export const goal = 2\n")
  write(repo, "host/loop.test.ts", "export {}\n")

  const result = dryRun(repo, base)

  expect(result.exitCode).toEqual(0)
  expect(result.stdout).toEqual(
    [
      "changed files:",
      "  host/loop.test.ts",
      "  src/goal.ts",
      "  src/index.ts",
      "selected commands:",
      "  bun run typecheck",
      "  bun test --coverage",
      "  bun test ./host",
      "  bun run mutation",
      "",
    ].join("\n"),
  )
})

test("--dry-run on a docs-only change says nothing needs verifying and exits 0", () => {
  const repo = throwawayRepo()
  const base = git(repo, "rev-parse", "HEAD")
  write(repo, "README.md", "# changed\n")

  const result = dryRun(repo, base)

  expect(result.exitCode).toEqual(0)
  expect(result.stdout).toEqual(
    ["changed files:", "  README.md", "selected commands:", "  none: nothing needs verifying", ""].join("\n"),
  )
})

test("a change to a file the index imports selects the full host suite, found by scanning imports", () => {
  const repo = throwawayRepo({
    "src/index.ts": 'import { rpc } from "./rpc.ts"\nexport const index = rpc\n',
    "src/rpc.ts": "export const rpc = 1\n",
    "host/budget.test.ts": "export {}\n",
  })
  const base = git(repo, "rev-parse", "HEAD")
  write(repo, "src/rpc.ts", "export const rpc = 2\n")

  const result = dryRun(repo, base)

  expect(result.exitCode).toEqual(0)
  expect(result.stdout).toEqual(
    [
      "changed files:",
      "  src/rpc.ts",
      "selected commands:",
      "  bun run typecheck",
      "  bun test --coverage",
      "  bun test ./host",
      "",
    ].join("\n"),
  )
})

test("a change to a file only the tui imports selects the tui host file", () => {
  const repo = throwawayRepo({
    "src/tui.tsx": 'import { badge } from "./badge.ts"\nexport const tui = badge\n',
    "src/badge.ts": "export const badge = 1\n",
    "host/tui.test.ts": "export {}\n",
    "host/budget.test.ts": "export {}\n",
  })
  const base = git(repo, "rev-parse", "HEAD")
  write(repo, "src/badge.ts", "export const badge = 2\n")

  const result = dryRun(repo, base)

  expect(result.exitCode).toEqual(0)
  expect(result.stdout).toEqual(
    [
      "changed files:",
      "  src/badge.ts",
      "selected commands:",
      "  bun run typecheck",
      "  bun test --coverage",
      "  bun test ./host/tui.test.ts",
      "",
    ].join("\n"),
  )
})

test("a deleted host test file is not selected", () => {
  const repo = throwawayRepo({ "host/gone.test.ts": "export {}\n" })
  const base = git(repo, "rev-parse", "HEAD")
  rmSync(join(repo, "host/gone.test.ts"))

  const result = dryRun(repo, base)

  expect(result.exitCode).toEqual(0)
  expect(result.stdout).toEqual(
    ["changed files:", "  host/gone.test.ts", "selected commands:", "  bun run typecheck", ""].join("\n"),
  )
})

test("an unknown argument exits 2 with the usage message", () => {
  const repo = throwawayRepo()
  const result = verify(repo, "--bogus")

  expect(result.exitCode).toEqual(2)
  expect(result.stdout).toEqual("")
  expect(result.stderr).toEqual(`unknown argument: --bogus\n${USAGE}`)
})

test("--base without a ref exits 2 with the usage message", () => {
  const repo = throwawayRepo()
  const result = verify(repo, "--base")

  expect(result.exitCode).toEqual(2)
  expect(result.stderr).toEqual(USAGE)
})

test("a stryker.config.json whose mutate is not a string array exits 2", () => {
  const repo = throwawayRepo()
  write(repo, "stryker.config.json", JSON.stringify({ mutate: "src/goal.ts" }))

  const result = verify(repo, "--dry-run", "--base", git(repo, "rev-parse", "HEAD"))

  expect(result.exitCode).toEqual(2)
  expect(result.stdout).toEqual("")
  expect(result.stderr).toEqual("stryker.config.json: mutate must be an array of strings\n")
})
