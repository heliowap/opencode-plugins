#!/usr/bin/env bun
import { existsSync } from "node:fs"
import { join } from "node:path"
import { listPlugins } from "../install.ts"
import { selectPlugins } from "./ci-matrix.ts"

type Args = { every: boolean; staged: boolean }
type Result = { name: string; ok: boolean; ms: number; step?: string; output?: string }
type PackageJson = { scripts?: Record<string, string> }

const root = join(import.meta.dir, "..")

export function parseArgs(argv: string[]): Args {
  const unknown = argv.find((arg) => arg !== "--all" && arg !== "--staged")
  if (unknown !== undefined) throw new Error(`Unknown argument: ${unknown}`)
  return { every: argv.includes("--all"), staged: argv.includes("--staged") }
}

export const selectChecks = (paths: string[], all: string[], every: boolean): string[] =>
  every ? all : selectPlugins(paths, all)

export function unitTestCommand(pkg: PackageJson, hasHostDir: boolean, bunfig: string): string[] | undefined {
  const script = pkg.scripts?.test
  if (!script) return undefined
  const rootedAtTest = /^\s*root\s*=\s*"test"/m.test(bunfig)
  const reachesHost = script.includes("./host") || (hasHostDir && !rootedAtTest)
  return reachesHost ? ["bun", "test", "./test"] : ["bun", "run", "test"]
}

export const summaryLine = (result: Pick<Result, "name" | "ok" | "ms" | "step">): string =>
  `${result.ok ? "PASS" : "FAIL"} ${result.name} ${(result.ms / 1000).toFixed(1)}s${result.ok ? "" : ` ${result.step}`}`

async function git(cwd: string, args: string[]): Promise<{ code: number; out: string }> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" })
  const out = await new Response(proc.stdout).text()
  return { code: await proc.exited, out }
}

const lines = (text: string) => text.split("\n").filter(Boolean)

export async function changedPaths(cwd: string, staged: boolean): Promise<string[] | undefined> {
  if (staged) return lines((await git(cwd, ["diff", "--cached", "--name-only", "--no-renames"])).out)
  const base = await git(cwd, ["merge-base", "HEAD", "origin/main"])
  if (base.code !== 0) return undefined
  const [tracked, untracked] = await Promise.all([
    git(cwd, ["diff", "--name-only", "--no-renames", base.out.trim()]),
    git(cwd, ["ls-files", "--others", "--exclude-standard"]),
  ])
  return [...new Set([...lines(tracked.out), ...lines(untracked.out)])]
}

export function cleanEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const kept = Object.entries(env).filter(([key]) => !key.startsWith("GIT_"))
  return { ...Object.fromEntries(kept), FORCE_COLOR: "0" }
}

async function exec(cmd: string[], cwd: string, env = process.env): Promise<{ ok: boolean; output: string }> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe", env })
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  return { ok: (await proc.exited) === 0, output: out + err }
}

async function checkPlugin(name: string): Promise<Result> {
  const started = performance.now()
  const dir = join(root, "plugins", name)
  const pkg: PackageJson = await Bun.file(join(dir, "package.json")).json()
  const bunfig = (await Bun.file(join(dir, "bunfig.toml")).exists()) ? await Bun.file(join(dir, "bunfig.toml")).text() : ""
  const steps: [string, string[]][] = []
  if (!existsSync(join(dir, "node_modules"))) steps.push(["install", ["bun", "install", "--frozen-lockfile"]])
  steps.push(["typecheck", ["bun", "run", "typecheck"]])
  const test = unitTestCommand(pkg, existsSync(join(dir, "host")), bunfig)
  if (test) steps.push(["test", test])
  for (const [step, cmd] of steps) {
    const { ok, output } = await exec(cmd, dir, cleanEnv(process.env))
    if (!ok) return { name, ok, ms: performance.now() - started, step, output }
  }
  return { name, ok: true, ms: performance.now() - started }
}

async function lintRepoStep(): Promise<Result> {
  const started = performance.now()
  const { ok, output } = await exec(["bun", join(root, "scripts/lint-repo.ts")], root)
  return { name: "lint:repo", ok, ms: performance.now() - started, step: "lint", output }
}

if (import.meta.main) {
  const started = performance.now()
  const args = parseArgs(process.argv.slice(2))
  const all = (await listPlugins(root)).map((plugin) => plugin.name)
  const paths = args.every ? [] : await changedPaths(root, args.staged)
  if (!args.every && paths === undefined) console.log("origin/main not found; checking every plugin")
  const selected = selectChecks(paths ?? [], all, args.every || paths === undefined)
  console.log(selected.length === 0 ? "No plugins affected" : `Plugins: ${selected.join(", ")}`)
  const report = (result: Result) => {
    console.log(summaryLine(result))
    return result
  }
  const results = await Promise.all(selected.map((name) => checkPlugin(name).then(report)))
  results.push(report(await lintRepoStep()))
  for (const result of results.filter((r) => !r.ok)) console.log(`\n--- ${result.name} (${result.step}) ---\n${result.output?.trimEnd()}`)
  console.log(`Total ${((performance.now() - started) / 1000).toFixed(1)}s`)
  process.exit(results.every((r) => r.ok) ? 0 : 1)
}
