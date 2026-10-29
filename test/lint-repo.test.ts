import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { formatFinding, lintRepo } from "../scripts/lint-repo.ts"

const mask = "[RED" + "ACTED]"
const old = "github:heliowap/opencode-" + "v2-"
const dirs: string[] = []

const base: Record<string, string> = {
  "README.md": "# repo\n\n| `alpha` | thing |\n",
  "plugins/alpha/package.json": JSON.stringify({ name: "alpha", scripts: { typecheck: "tsgo --noEmit" } }, null, 2),
  "plugins/alpha/bun.lock": "{}\n",
  "plugins/alpha/README.md": "# alpha\n",
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
  test("a conforming repo has no findings", async () => {
    expect(await lintRepo(repo({}))).toEqual([])
  })

  test("formats findings as path:line rule message", async () => {
    const findings = await lintRepo(repo({ "plugins/alpha/bun.lock": "" }))
    expect(formatFinding(findings[0]!)).toBe("plugins/alpha/bun.lock:1 plugin-shape missing bun.lock")
  })

  describe("plugin-shape", () => {
    test("missing typecheck script", async () => {
      const root = repo({ "plugins/alpha/package.json": JSON.stringify({ name: "alpha", scripts: {} }, null, 2) })
      expect((await lintRepo(root)).map(formatFinding)).toEqual([
        'plugins/alpha/package.json:1 plugin-shape missing "typecheck" script',
      ])
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

    test("lines starting with Formerly are allowed", async () => {
      const root = repo({ "plugins/alpha/README.md": `# alpha\n\nFormerly ${old}alpha.\n` })
      expect(await lintRepo(root)).toEqual([])
    })

    test("the bare repo name without github: is allowed", async () => {
      const root = repo({ "docs/a.md": "see heliowap/opencode-v2-alpha\n" })
      expect(await lintRepo(root)).toEqual([])
    })
  })

  describe("redacted-literal", () => {
    test("flags the literal mask in a committed file", async () => {
      const root = repo({ "plugins/alpha/src/a.ts": `const x = "${mask}"\n` })
      expect((await lintRepo(root)).map(formatFinding)).toEqual([
        "plugins/alpha/src/a.ts:1 redacted-literal literal mask text; restore the original value",
      ])
    })

    test("plugins/redact-secrets and evidence are allowed", async () => {
      const root = repo({
        "plugins/redact-secrets/src/index.ts": `const MASK = "${mask}"\n`,
        "evidence/run.txt": `${mask}\n`,
      })
      expect((await lintRepo(root)).filter((f) => f.rule === "redacted-literal")).toEqual([])
    })

    test("a line that describes the mask is allowed", async () => {
      const root = repo({ "docs/a.md": `The mask is ${mask}.\n` })
      expect(await lintRepo(root)).toEqual([])
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

    test("the root package.json is not checked", async () => {
      const root = repo({ "package.json": '{"dependencies":{"x":"workspace:*"}}\n' })
      expect(await lintRepo(root)).toEqual([])
    })
  })

  test("untracked files are ignored", async () => {
    const root = repo({}, { "plugins/alpha/src/a.ts": `${mask}\n`, "docs/b.md": `${old}x\n` })
    expect(await lintRepo(root)).toEqual([])
  })

  test("files deleted from the worktree but still tracked are skipped", async () => {
    const root = repo({ "docs/gone.md": "x\n" })
    rmSync(join(root, "docs/gone.md"))
    expect(await lintRepo(root)).toEqual([])
  })

  test("the real repository is clean", async () => {
    expect((await lintRepo(join(import.meta.dir, ".."))).map(formatFinding)).toEqual([])
  })
})
