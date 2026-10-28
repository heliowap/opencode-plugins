import { describe, expect, test } from "bun:test"
import { readdirSync } from "node:fs"
import { join } from "node:path"
import { OVERRIDES } from "../scripts/ci-matrix.ts"

const root = join(import.meta.dir, "..")
const script = join(root, "scripts/ci-matrix.ts")
const dirs = readdirSync(join(root, "plugins"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

type Row = { name: string; runner: string; bun: string; opencode: string; test: string }

async function run(args: string[], stdin = "") {
  const proc = Bun.spawn(["bun", script, ...args], {
    stdin: new Response(stdin),
    stdout: "pipe",
    stderr: "pipe",
  })
  const out = await new Response(proc.stdout).text()
  const code = await proc.exited
  const lines = Object.fromEntries(
    out
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  )
  return {
    code,
    plugins: JSON.parse(lines.plugins ?? "null") as string[],
    rows: (JSON.parse(lines.matrix ?? "null") as { include: Row[] }).include,
  }
}

describe("ci-matrix", () => {
  test("plugins/<n>/... selects plugin n only", async () => {
    const r = await run([], "plugins/goal/src/index.ts\nplugins/goal/README.md\nplugins/tps-meter/package.json\n")
    expect(r.code).toBe(0)
    expect(r.plugins).toEqual(["goal", "tps-meter"])
    expect(r.rows.map((row) => row.name)).toEqual(["goal", "tps-meter"])
  })

  test("workflow changes select every plugin", async () => {
    const r = await run([], ".github/workflows/ci.yml\n")
    expect(r.plugins).toEqual(dirs)
  })

  test("scripts/ci-matrix.ts selects every plugin", async () => {
    const r = await run([], "scripts/ci-matrix.ts\n")
    expect(r.plugins).toEqual(dirs)
  })

  test("--all selects every plugin without reading stdin", async () => {
    const r = await run(["--all"])
    expect(r.plugins).toEqual(dirs)
  })

  test("other paths select nothing", async () => {
    const r = await run([], "README.md\ninstall.ts\ntest/install.test.ts\nplugins/unknown/x.ts\n")
    expect(r.plugins).toEqual([])
    expect(r.rows).toEqual([])
  })

  test("defaults apply to plugins without overrides", async () => {
    const r = await run([], "plugins/base-check/src/index.ts\n")
    expect(r.rows).toEqual([
      { name: "base-check", runner: "ubuntu-latest", bun: "1.4.3", opencode: "", test: "bun run test" },
    ])
  })

  test("a plugin without a test script gets an empty test", async () => {
    const r = await run([], "plugins/redact-secrets/src/index.ts\n")
    expect(r.rows[0]?.test).toBe("")
  })

  test("overrides keep parity with the old per-repo CI", async () => {
    const r = await run(["--all"])
    const by = Object.fromEntries(r.rows.map((row) => [row.name, row]))
    expect(by.goal).toMatchObject({ bun: "1.4.0", test: "bun test --coverage" })
    expect(by["cliproxy-quota"]).toMatchObject({ bun: "1.4.0", test: "bun test && bun script/check-tests.ts" })
    expect(by["protect-agents-md"]).toMatchObject({ runner: "macos-latest", opencode: "2.0.32", bun: "1.4.3" })
  })

  test("every override key is a plugins/ directory", () => {
    for (const key of Object.keys(OVERRIDES)) expect(dirs).toContain(key)
  })
})
