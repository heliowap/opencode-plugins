import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parsePackageJson } from "../scripts/ci-matrix.ts"
import { changedPaths, checkPackage, cleanEnv, lintCommand, parseArgs, planChecks, summaryLine, unitTestCommand } from "../scripts/check.ts"

const root = join(import.meta.dir, "..")
const all = ["base-check", "goal", "tps-meter"]
const dirs: string[] = []
const gitVars = ["GIT_DIR", "GIT_INDEX_FILE", "GIT_WORK_TREE"]

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  for (const name of gitVars) delete process.env[name]
})

const scratch = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

describe("parseArgs", () => {
  test("defaults, then each flag", () => {
    expect(parseArgs([])).toEqual({ every: false, staged: false })
    expect(parseArgs(["--all"])).toEqual({ every: true, staged: false })
    expect(parseArgs(["--staged"])).toEqual({ every: false, staged: true })
  })

  test("unknown flags are rejected", () => {
    expect(() => parseArgs(["--bogus"])).toThrow("Unknown argument: --bogus")
  })
})

describe("planChecks", () => {
  test("--all selects every plugin and the root", () => {
    expect(planChecks([], all, true)).toEqual({ plugins: all, root: true })
  })

  test("applies the CI selection rules to plugins", () => {
    expect(planChecks(["plugins/goal/src/a.ts", "plugins/tps-meter/README.md"], all, false)).toEqual({ plugins: ["goal"], root: false })
  })

  test("a docs-only change selects nothing, a source sibling selects a plugin", () => {
    const docs = ["README.md", "docs/a.md", "plugins/goal/docs/b.md"]
    expect(planChecks(docs, all, false)).toEqual({ plugins: [], root: false })
    expect(planChecks([...docs, "plugins/base-check/src/a.ts"], all, false)).toEqual({ plugins: ["base-check"], root: false })
  })

  test.each(["install.ts", "scripts/check.ts", "test/a.test.ts", "package.json", "bun.lock", "tsconfig.json"])(
    "%s selects the root and no plugin",
    (path) => {
      expect(planChecks([path], all, false)).toEqual({ plugins: [], root: true })
    },
  )

  test("a workflow change selects every plugin and the root", () => {
    expect(planChecks([".github/workflows/ci.yml"], all, false)).toEqual({ plugins: all, root: true })
  })
})

describe("unitTestCommand", () => {
  test("no test script runs nothing, a test script runs", () => {
    expect(unitTestCommand({ scripts: { typecheck: "tsgo" } }, false, "")).toBeUndefined()
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

describe("lintCommand", () => {
  test("passes --staged only for staged runs", () => {
    expect(lintCommand(false)).toEqual(["bun", join(root, "scripts/lint-repo.ts")])
    expect(lintCommand(true)).toEqual(["bun", join(root, "scripts/lint-repo.ts"), "--staged"])
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

describe("checkPackage", () => {
  function fakePlugin(testScript: string): string {
    const dir = scratch("check-package-")
    mkdirSync(join(dir, "node_modules"))
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fake", scripts: { typecheck: "true", test: testScript } }))
    return dir
  }

  const requiresCleanGit = 'test -z "$GIT_DIR$GIT_INDEX_FILE$GIT_WORK_TREE"'

  test("runs the plugin commands without the git variables a hook exports", async () => {
    const dir = fakePlugin(requiresCleanGit)
    for (const name of gitVars) process.env[name] = "/somewhere"
    const control = Bun.spawnSync(["sh", "-c", requiresCleanGit], { env: { ...process.env } })
    expect(control.exitCode).toBe(1)
    const result = await checkPackage("fake", dir)
    expect(result).toMatchObject({ name: "fake", ok: true })
  })

  test("a failing test step is reported with its step and output", async () => {
    const result = await checkPackage("fake", fakePlugin("echo boom-output; exit 3"))
    expect(result).toMatchObject({ name: "fake", ok: false, step: "test" })
    expect(result.output).toContain("boom-output")
  })

  test("a failing typecheck stops before the tests", async () => {
    const dir = fakePlugin("echo should-not-run")
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { typecheck: "exit 1", test: "echo should-not-run" } }))
    const result = await checkPackage("fake", dir)
    expect(result).toMatchObject({ ok: false, step: "typecheck" })
    expect(result.output).not.toContain("should-not-run")
  })
})

describe("changedPaths", () => {
  const git = (cwd: string, ...args: string[]) => {
    const proc = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, env: cleanEnv(process.env) })
    if (proc.exitCode !== 0) throw new Error(proc.stderr.toString())
    return proc.stdout.toString().trim()
  }

  function fixture() {
    const dir = scratch("check-paths-")
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

  test("returns undefined without origin/main, paths with it", async () => {
    const dir = scratch("check-paths-")
    git(dir, "init", "-q", "-b", "main")
    writeFileSync(join(dir, "a.txt"), "a\n")
    git(dir, "add", "-A")
    git(dir, "commit", "-qm", "a")
    expect(await changedPaths(dir, false)).toBeUndefined()
    expect(await changedPaths(fixture().dir, false)).toEqual(["committed.txt"])
  })
})

describe("wiring", () => {
  test("root scripts expose the documented interface", async () => {
    const pkg = parsePackageJson(await Bun.file(join(root, "package.json")).text())
    expect(pkg?.scripts).toMatchObject({
      check: "bun scripts/check.ts",
      "check:all": "bun run check --all",
      "lint:repo": "bun scripts/lint-repo.ts",
      prepare: "git config core.hooksPath .githooks",
    })
  })

  test("the pre-commit hook is executable, checks staged files and documents the bypass", async () => {
    const hook = join(root, ".githooks/pre-commit")
    expect(statSync(hook).mode & 0o111).toBe(0o111)
    const text = await Bun.file(hook).text()
    expect(text).toContain("bun run check --staged")
    expect(text).toContain("git commit --no-verify")
  })
})
