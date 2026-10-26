import { existsSync, readFileSync } from "node:fs"
import { posix } from "node:path"
import { type Command, importClosure, selectCommands } from "../src/verify-plan.ts"

const USAGE = "usage: bun run verify:changed [--base <ref>] [--dry-run]"

function fail(message: string): never {
  console.error(message)
  process.exit(2)
}

let dryRun = false
let base = "origin/master"
const args = process.argv.slice(2)
for (let i = 0; i < args.length; i++) {
  const arg = args[i]
  const value = args[i + 1]
  if (arg === "--dry-run") dryRun = true
  else if (arg === "--base" && value !== undefined && !value.startsWith("--")) {
    base = value
    i++
  } else if (arg === "--base") fail(USAGE)
  else fail(`unknown argument: ${arg}\n${USAGE}`)
}

function git(gitArgs: string[]): string {
  const result = Bun.spawnSync(["git", ...gitArgs], { stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) fail(`git ${gitArgs.join(" ")} failed: ${result.stderr.toString().trim()}`)
  return result.stdout.toString().trim()
}

const lines = (output: string) => output.split("\n").filter(Boolean)

const changed = [
  ...new Set([
    ...lines(git(["diff", "--name-only", `${base}...HEAD`])),
    ...lines(git(["diff", "--name-only", "HEAD"])),
    ...lines(git(["ls-files", "--others", "--exclude-standard"])),
  ]),
].sort()

function mutateList(): string[] {
  const config: { mutate?: unknown } = JSON.parse(readFileSync("stryker.config.json", "utf8"))
  if (!Array.isArray(config.mutate) || !config.mutate.every((item) => typeof item === "string"))
    fail("stryker.config.json: mutate must be an array of strings")
  return config.mutate
}

function importsOf(file: string): string[] {
  if (!existsSync(file)) return []
  const transpiler = new Bun.Transpiler({ loader: file.endsWith(".tsx") ? "tsx" : "ts" })
  return transpiler
    .scanImports(readFileSync(file, "utf8"))
    .map((entry) => entry.path)
    .filter((specifier) => specifier.startsWith("."))
    .map((specifier) => posix.normalize(posix.join(posix.dirname(file), specifier)))
    .filter((target) => existsSync(target))
}

const commands: Command[] = selectCommands(changed, {
  mutate: mutateList(),
  indexGraph: importClosure("src/index.ts", importsOf),
  tuiGraph: importClosure("src/tui.tsx", importsOf),
  exists: (file) => existsSync(file),
})

console.log("changed files:")
for (const file of changed) console.log(`  ${file}`)
console.log("selected commands:")
if (commands.length === 0) console.log("  none: nothing needs verifying")
for (const command of commands) console.log(`  ${command.join(" ")}`)

if (dryRun || commands.length === 0) process.exit(0)

for (const command of commands) {
  const label = command.join(" ")
  const child = Bun.spawn([...command], { stdio: ["inherit", "inherit", "inherit"] })
  const code = await child.exited
  console.log(`verify: ${label} → exit ${code}`)
  if (code !== 0) process.exit(code)
}

console.log(`verify: HEAD ${git(["rev-parse", "HEAD"])} — all selected commands passed`)
