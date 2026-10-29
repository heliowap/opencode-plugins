import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { changedPaths, cleanEnv, parseArgs, selectChecks, summaryLine, unitTestCommand } from "../scripts/check.ts"

const root = join(import.meta.dir, "..")
const all = ["base-check", "goal", "tps-meter"]
const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("parseArgs", () => {
  test("defaults", () => {
    expect(parseArgs([])).toEqual({ every: false, staged: false })
  })

  test("--all and --staged", () => {
    expect(parseArgs(["--all"])).toEqual({ every: true, staged: false })
    expect(parseArgs(["--staged"])).toEqual({ every: false, staged: true })
  })

  test("unknown flags are rejected", () => {
    expect(() => parseArgs(["--bogus"])).toThrow("Unknown argument: --bogus")
  })
})

describe("selectChecks", () => {
  test("--all selects every plugin", () => {
    expect(selectChecks([], all, true)).toEqual(all)
  })

  test("applies the CI selection rules", () => {
    expect(selectChecks(["plugins/goal/src/a.ts", "plugins/tps-meter/README.md"], all, false)).toEqual(["goal"])
  })

  test("a docs-only change selects nothing", () => {
    expect(selectChecks(["README.md", "docs/a.md", "plugins/goal/docs/b.md"], all, false)).toEqual([])
  })

  test("a workflow change selects every plugin", () => {
    expect(selectChecks([".github/workflows/ci.yml"], all, false)).toEqual(all)
  })
})

describe("unitTestCommand", () => {
  test("no test script runs nothing", () => {
    expect(unitTestCommand({ scripts: { typecheck: "tsgo" } }, false, "")).toBeUndefined()
  })

  test("a plain test script runs through the package script", () => {
    expect(unitTestCommand({ scripts: { test: "bun test" } }, false, "")).toEqual(["bun", "run", "test"])
  })

  test("a composite script without host suites keeps running through the package script", () => {
    expect(unitTestCommand({ scripts: { test: "bun test && python3 -m unittest" } }, false, "")).toEqual(["bun", "run", "test"])
  })

  test("a host directory without a test root restricts bun test to ./test", () => {
    expect(unitTestCommand({ scripts: { test: "bun test" } }, true, "")).toEqual(["bun", "test", "./test"])
  })

  test("a bunfig that roots tests at test keeps the package script even with a host directory", () => {
    expect(unitTestCommand({ scripts: { test: "bun test" } }, true, '[test]\nroot = "test"\n')).toEqual(["bun", "run", "test"])
  })

  test("a test script that names ./host is restricted to ./test", () => {
    expect(unitTestCommand({ scripts: { test: "bun test ./host" } }, false, "")).toEqual(["bun", "test", "./test"])
  })
})

describe("cleanEnv", () => {
  test("drops the git variables a hook exports so plugin tests cannot touch this repository", () => {
    expect(
      cleanEnv({ PATH: "/bin", GIT_DIR: "/repo/.git", GIT_INDEX_FILE: "/repo/.git/index.lock", GIT_WORK_TREE: "/repo", HOME: "/h" }),
    ).toEqual({ PATH: "/bin", HOME: "/h", FORCE_COLOR: "0" })
  })
})

describe("summaryLine", () => {
  test("pass", () => {
    expect(summaryLine({ name: "goal", ok: true, ms: 12345 })).toBe("PASS goal 12.3s")
  })

  test("fail names the step", () => {
    expect(summaryLine({ name: "goal", ok: false, ms: 4100, step: "typecheck" })).toBe("FAIL goal 4.1s typecheck")
  })
})

describe("changedPaths", () => {
  const git = (cwd: string, ...args: string[]) => {
    const proc = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd })
    if (proc.exitCode !== 0) throw new Error(proc.stderr.toString())
    return proc.stdout.toString().trim()
  }

  function fixture() {
    const dir = mkdtempSync(join(tmpdir(), "check-paths-"))
    dirs.push(dir)
    const put = (name: string, text: string) => writeFileSync(join(dir, name), text)
    git(dir, "init", "-q", "-b", "main")
    put("base.txt", "base\n")
    put("keep.txt", "keep\n")
    git(dir, "add", "-A")
    git(dir, "commit", "-qm", "base")
    git(dir, "update-ref", "refs/remotes/origin/main", "HEAD")
    git(dir, "checkout", "-qb", "topic")
    put("committed.txt", "x\n")
    git(dir, "add", "-A")
    git(dir, "commit", "-qm", "topic work")
    return { dir, put }
  }

  test("includes commits, staged, unstaged and untracked changes since the merge-base", async () => {
    const { dir, put } = fixture()
    put("staged.txt", "s\n")
    git(dir, "add", "staged.txt")
    put("keep.txt", "changed\n")
    put("untracked.txt", "u\n")
    expect((await changedPaths(dir, false))?.sort()).toEqual(["committed.txt", "keep.txt", "staged.txt", "untracked.txt"])
  })

  test("staged mode returns only the staged paths", async () => {
    const { dir, put } = fixture()
    put("staged.txt", "s\n")
    git(dir, "add", "staged.txt")
    put("keep.txt", "changed\n")
    expect(await changedPaths(dir, true)).toEqual(["staged.txt"])
  })

  test("returns undefined when origin/main does not exist", async () => {
    const dir = mkdtempSync(join(tmpdir(), "check-paths-"))
    dirs.push(dir)
    git(dir, "init", "-q", "-b", "main")
    writeFileSync(join(dir, "a.txt"), "a\n")
    git(dir, "add", "-A")
    git(dir, "commit", "-qm", "a")
    expect(await changedPaths(dir, false)).toBeUndefined()
  })
})

describe("wiring", () => {
  test("root scripts expose the documented interface", async () => {
    const pkg = await Bun.file(join(root, "package.json")).json()
    expect(pkg.scripts).toMatchObject({
      check: "bun scripts/check.ts",
      "check:all": "bun run check --all",
      "lint:repo": "bun scripts/lint-repo.ts",
      prepare: "git config core.hooksPath .githooks",
    })
  })

  test("the pre-commit hook is executable, checks staged files and documents the bypass", async () => {
    const hook = join(root, ".githooks/pre-commit")
    expect(statSync(hook).mode & 0o111).not.toBe(0)
    const text = await Bun.file(hook).text()
    expect(text).toContain("bun run check --staged")
    expect(text).toContain("git commit --no-verify")
  })
})
