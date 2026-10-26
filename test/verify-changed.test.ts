import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

const script = resolve(import.meta.dir, "../scripts/verify-changed.ts")

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

function dryRun(repo: string, base: string) {
  const result = Bun.spawnSync([process.execPath, script, "--dry-run", "--base", base], { cwd: repo, stdout: "pipe", stderr: "pipe" })
  return { exitCode: result.exitCode, stdout: result.stdout.toString() }
}

function throwawayRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "verify-changed-"))
  git(repo, "init", "-q")
  write(repo, "stryker.config.json", JSON.stringify({ mutate: ["src/goal.ts"] }))
  write(repo, "src/goal.ts", "export const goal = 1\n")
  write(repo, "README.md", "# repo\n")
  git(repo, "add", "-A")
  git(repo, "commit", "-q", "-m", "base")
  return repo
}

test("--dry-run unions committed, uncommitted and untracked changes and prints the selected commands", () => {
  const repo = throwawayRepo()
  const base = git(repo, "rev-parse", "HEAD")
  write(repo, "src/index.ts", "export {}\n")
  git(repo, "add", "-A")
  git(repo, "commit", "-q", "-m", "add index")
  write(repo, "src/goal.ts", "export const goal = 2\n")
  write(repo, "host/loop.test.ts", "export {}\n")

  const result = dryRun(repo, base)

  expect(result.exitCode).toBe(0)
  expect(result.stdout).toBe(
    [
      "changed files:",
      "  host/loop.test.ts",
      "  src/goal.ts",
      "  src/index.ts",
      "selected commands:",
      "  bun run typecheck",
      "  bun test",
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

  expect(result.exitCode).toBe(0)
  expect(result.stdout).toBe(
    ["changed files:", "  README.md", "selected commands:", "  none: nothing needs verifying", ""].join("\n"),
  )
})
