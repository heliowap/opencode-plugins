import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { formatFinding, lintRepo } from "../scripts/lint-repo.ts"

const mask = "[RED" + "ACTED]"
const violation = `const x = "${mask}"\n`
const old = "github:heliowap/opencode-" + "v2-"
const dirs: string[] = []

const base: Record<string, string> = {
  "README.md": "# repo\n\n| `alpha` | thing |\n",
  "plugins/alpha/package.json": JSON.stringify({ name: "alpha", scripts: { typecheck: "tsgo --noEmit" } }, null, 2),
  "plugins/alpha/bun.lock": "{}\n",
  "plugins/alpha/README.md": "# alpha\n",
  "plugins/alpha/tsconfig.json": "{}\n",
}

function repo(files: Record<string, string>, untracked: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "lint-repo-"))
  dirs.push(root)
  const put = (name: string, content: string) => {
    mkdirSync(dirname(join(root, name)), { recursive: true })
    writeFileSync(join(root, name), content)
  }
  for (const [name, content] of Object.entries({ ...base, ...files })) if (content !== "") put(name, content)
  Bun.spawnSync(["git", "init", "-q"], { cwd: root })
  Bun.spawnSync(["git", "add", "-A"], { cwd: root })
  for (const [name, content] of Object.entries(untracked)) put(name, content)
  return root
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("lintRepo", () => {
  test("a conforming repo has no findings, the same repo with one violating line has one", async () => {
    expect(await lintRepo(repo({}))).toEqual([])
    expect((await lintRepo(repo({ "plugins/alpha/src/a.ts": violation }))).map(formatFinding)).toEqual([
      "plugins/alpha/src/a.ts:1 redacted-literal literal mask text; restore the original value",
    ])
  })

  test("formats findings as path:line rule message", async () => {
    const findings = await lintRepo(repo({ "plugins/alpha/bun.lock": "" }))
    expect(findings.map(formatFinding)).toEqual(["plugins/alpha/bun.lock:1 plugin-shape missing bun.lock"])
  })

  describe("plugin-shape", () => {
    test("missing typecheck script", async () => {
      const root = repo({ "plugins/alpha/package.json": JSON.stringify({ name: "alpha", scripts: {} }, null, 2) })
      expect((await lintRepo(root)).map(formatFinding)).toEqual([
        'plugins/alpha/package.json:1 plugin-shape missing "typecheck" script',
      ])
    })

    test("missing tsconfig.json", async () => {
      const root = repo({ "plugins/alpha/tsconfig.json": "" })
      expect((await lintRepo(root)).map(formatFinding)).toEqual(["plugins/alpha/tsconfig.json:1 plugin-shape missing tsconfig.json"])
    })

    test("a package.json with the wrong shape is reported", async () => {
      const root = repo({ "plugins/alpha/package.json": '{"scripts":[]}' })
      expect((await lintRepo(root)).map(formatFinding)).toEqual(["plugins/alpha/package.json:1 plugin-shape invalid package.json shape"])
    })

    test("missing plugin README", async () => {
      const root = repo({ "plugins/alpha/README.md": "" })
      expect((await lintRepo(root)).map(formatFinding)).toEqual(["plugins/alpha/README.md:1 plugin-shape missing README.md"])
    })

    test("plugin absent from the root README", async () => {
      const root = repo({ "README.md": "# repo\n" })
      expect((await lintRepo(root)).map(formatFinding)).toEqual([
        "README.md:1 plugin-shape plugins/alpha is not listed in the root README.md",
      ])
    })

    test("a directory without package.json is reported once", async () => {
      const root = repo({ "plugins/beta/README.md": "# beta\n" })
      expect((await lintRepo(root)).map(formatFinding)).toEqual([
        "plugins/beta/package.json:1 plugin-shape missing package.json",
        "plugins/beta/bun.lock:1 plugin-shape missing bun.lock",
        "plugins/beta/tsconfig.json:1 plugin-shape missing tsconfig.json",
        "README.md:1 plugin-shape plugins/beta is not listed in the root README.md",
      ])
    })
  })

  describe("old-spec", () => {
    test("flags the old install spec with its line", async () => {
      const root = repo({ "docs/a.md": `ok\nuse ${old}goal-plugin here\n` })
      expect((await lintRepo(root)).map(formatFinding)).toEqual([
        "docs/a.md:2 old-spec old install spec; use github:heliowap/opencode-plugins#main::path:plugins/<name>",
      ])
    })

    test("lines starting with Formerly are allowed, other lines are not", async () => {
      const root = repo({ "plugins/alpha/README.md": `# alpha\n\nFormerly ${old}alpha.\nNow ${old}alpha.\n` })
      expect((await lintRepo(root)).map((f) => `${f.path}:${f.line}`)).toEqual(["plugins/alpha/README.md:4"])
    })

    test("the bare repo name without github: is allowed, with github: it is not", async () => {
      const root = repo({ "docs/a.md": `see heliowap/opencode-v2-alpha\nsee ${old}alpha\n` })
      expect((await lintRepo(root)).map((f) => `${f.path}:${f.line}`)).toEqual(["docs/a.md:2"])
    })
  })

  describe("redacted-literal", () => {
    test("flags the literal mask in a committed file", async () => {
      const root = repo({ "plugins/alpha/src/a.ts": `const x = "${mask}"\n` })
      expect((await lintRepo(root)).map(formatFinding)).toEqual([
        "plugins/alpha/src/a.ts:1 redacted-literal literal mask text; restore the original value",
      ])
    })

    test("plugins/redact-secrets and evidence are allowed, another path is not", async () => {
      const root = repo({
        "plugins/redact-secrets/src/index.ts": violation,
        "evidence/run.txt": `${mask}\n`,
        "plugins/alpha/src/b.ts": violation,
      })
      expect((await lintRepo(root)).filter((f) => f.rule === "redacted-literal").map((f) => f.path)).toEqual(["plugins/alpha/src/b.ts"])
    })

    test("a markdown line that describes the mask is allowed, one that does not is flagged", async () => {
      const root = repo({ "docs/a.md": `The mask is ${mask}.\nplain ${mask}\n` })
      expect((await lintRepo(root)).map((f) => `${f.path}:${f.line} ${f.rule}`)).toEqual(["docs/a.md:2 redacted-literal"])
    })

    test("code that names the mask is still flagged outside plugins/redact-secrets", async () => {
      const root = repo({ "plugins/alpha/src/a.ts": `const mask = "${mask}"\n` })
      expect((await lintRepo(root)).map((f) => `${f.path}:${f.line} ${f.rule}`)).toEqual(["plugins/alpha/src/a.ts:1 redacted-literal"])
    })

    test("a sibling plugin is not allowed", async () => {
      const root = repo({ "plugins/redact-secrets-extra/a.txt": `${mask}\n` })
      expect((await lintRepo(root)).filter((f) => f.rule === "redacted-literal")).toHaveLength(1)
    })
  })

  describe("workspace-dep", () => {
    test("flags the workspace protocol with its line", async () => {
      const pkg = '{\n  "name": "alpha",\n  "scripts": { "typecheck": "tsgo" },\n  "dependencies": {\n    "beta": "workspace:*"\n  }\n}\n'
      const root = repo({ "plugins/alpha/package.json": pkg })
      expect((await lintRepo(root)).map(formatFinding)).toEqual([
        "plugins/alpha/package.json:5 workspace-dep workspace: protocol; each plugin must install alone",
      ])
    })

    test("the root package.json is not checked, a plugin one is", async () => {
      const pkg = '{"scripts":{"typecheck":"x"},"dependencies":{"x":"workspace:*"}}\n'
      const root = repo({ "package.json": pkg, "plugins/alpha/package.json": pkg })
      expect((await lintRepo(root)).map((f) => f.path)).toEqual(["plugins/alpha/package.json"])
    })
  })

  test("untracked files are ignored, tracked ones are linted", async () => {
    const root = repo({ "plugins/alpha/src/t.ts": violation }, { "plugins/alpha/src/a.ts": `${mask}\n`, "docs/b.md": `${old}x\n` })
    expect((await lintRepo(root)).map((f) => f.path)).toEqual(["plugins/alpha/src/t.ts"])
  })

  test("files deleted from the worktree but still tracked are skipped", async () => {
    const root = repo({ "docs/gone.md": `${old}x\n`, "docs/kept.md": `${old}y\n` })
    rmSync(join(root, "docs/gone.md"))
    expect((await lintRepo(root)).map((f) => f.path)).toEqual(["docs/kept.md"])
  })

  describe("staged mode", () => {
    const git = (root: string, ...args: string[]) => Bun.spawnSync(["git", ...args], { cwd: root })

    test("lints the staged blob, not the working tree", async () => {
      const root = repo({})
      writeFileSync(join(root, "plugins/alpha/src.ts"), violation)
      git(root, "add", "plugins/alpha/src.ts")
      writeFileSync(join(root, "plugins/alpha/src.ts"), "const x = 1\n")
      expect((await lintRepo(root, { staged: true })).map(formatFinding)).toEqual([
        "plugins/alpha/src.ts:1 redacted-literal literal mask text; restore the original value",
      ])
      expect(await lintRepo(root, { staged: false })).toEqual([])
    })

    test("ignores an unstaged violation that the index does not have", async () => {
      const root = repo({ "plugins/alpha/src.ts": "const x = 1\n" })
      writeFileSync(join(root, "plugins/alpha/src.ts"), violation)
      expect(await lintRepo(root, { staged: true })).toEqual([])
      expect((await lintRepo(root, { staged: false })).map((f) => f.rule)).toEqual(["redacted-literal"])
    })

    test("plugin-shape reads the staged package.json", async () => {
      const root = repo({})
      writeFileSync(join(root, "plugins/alpha/package.json"), '{"scripts":{}}')
      git(root, "add", "plugins/alpha/package.json")
      writeFileSync(join(root, "plugins/alpha/package.json"), '{"scripts":{"typecheck":"x"}}')
      expect((await lintRepo(root, { staged: true })).map(formatFinding)).toEqual([
        'plugins/alpha/package.json:1 plugin-shape missing "typecheck" script',
      ])
    })
  })
})
