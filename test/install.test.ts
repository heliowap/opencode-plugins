import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const root = join(import.meta.dir, "..")
const installer = join(root, "install.ts")
const names = readdirSync(join(root, "plugins"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()
const spec = (name: string) => `github:heliowap/opencode-plugins#main::path:plugins/${name}`

let tmp: string
let bin: string
let log: string

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "install-test-"))
  bin = join(tmp, "bin")
  log = join(tmp, "calls.log")
  Bun.spawnSync(["mkdir", "-p", bin])
  const fake = join(bin, "opencode")
  writeFileSync(
    fake,
    `#!/bin/sh
echo "$*" >> "$FAKE_LOG"
case "$*" in *"$FAKE_FAIL"*) [ -n "$FAKE_FAIL" ] && exit 7;; esac
exit 0
`,
  )
  chmodSync(fake, 0o755)
})

afterAll(() => rmSync(tmp, { recursive: true, force: true }))

async function run(args: string[], opts: { stdin?: string; env?: Record<string, string> } = {}) {
  rmSync(log, { force: true })
  const proc = Bun.spawn([installer, ...args], {
    stdin: new Response(opts.stdin ?? ""),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_LOG: log, ...opts.env },
  })
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  const code = await proc.exited
  const calls = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean) : []
  return { code, stdout, stderr, calls }
}

const add = (name: string) => `plugin add ${spec(name)}`

describe("install.ts", () => {
  test("--all installs every plugin", async () => {
    const r = await run(["--all"])
    expect(r.code).toBe(0)
    expect(r.calls).toEqual(names.map(add))
  })

  test("named subset installs only those", async () => {
    const r = await run(["goal", "tps-meter"])
    expect(r.code).toBe(0)
    expect(r.calls).toEqual([add("goal"), add("tps-meter")])
  })

  test("unknown name exits 2, lists valid names, installs nothing", async () => {
    const r = await run(["goal", "nope"])
    expect(r.code).toBe(2)
    expect(r.calls).toEqual([])
    const out = r.stdout + r.stderr
    expect(out).toContain("nope")
    for (const name of names) expect(out).toContain(name)
  })

  test("--dry-run prints commands and runs nothing", async () => {
    const r = await run(["--dry-run", "--all"])
    expect(r.code).toBe(0)
    expect(r.calls).toEqual([])
    expect(r.stdout.trim().split("\n")).toEqual(names.map((n) => `opencode plugin add '${spec(n)}'`))
  })

  test("interactive: '1 3' then 'y' installs the 1st and 3rd plugin", async () => {
    const r = await run([], { stdin: "1 3\ny\n", env: { OPENCODE_PLUGINS_INTERACTIVE: "1" } })
    expect(r.code).toBe(0)
    expect(r.calls).toEqual([add(names[0]!), add(names[2]!)])
    expect(r.stdout).toContain("1)")
  })

  test("interactive: 'all' installs everything", async () => {
    const r = await run([], { stdin: "all\ny\n", env: { OPENCODE_PLUGINS_INTERACTIVE: "1" } })
    expect(r.calls).toEqual(names.map(add))
  })

  test("interactive: declining installs nothing", async () => {
    const r = await run([], { stdin: "1\nn\n", env: { OPENCODE_PLUGINS_INTERACTIVE: "1" } })
    expect(r.calls).toEqual([])
    expect(r.code).toBe(0)
  })

  test("a failing install does not stop the rest and exits 1 with a summary", async () => {
    const r = await run(["goal", "model-policy", "tps-meter"], { env: { FAKE_FAIL: "model-policy" } })
    expect(r.code).toBe(1)
    expect(r.calls).toEqual([add("goal"), add("model-policy"), add("tps-meter")])
    expect(r.stdout).toMatch(/failed:.*model-policy/)
    expect(r.stdout).toMatch(/installed:.*goal.*tps-meter/)
  })
})
