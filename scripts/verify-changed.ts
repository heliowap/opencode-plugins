import { readFileSync } from "node:fs"
import { type Command, selectCommands } from "../src/verify-plan.ts"

const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run")
const baseFlag = args.indexOf("--base")
const base = baseFlag === -1 ? "origin/master" : args[baseFlag + 1]
if (base === undefined || base.startsWith("--")) {
  console.error("usage: bun run verify:changed [--base <ref>] [--dry-run]")
  process.exit(2)
}

function git(gitArgs: string[]): string {
  const result = Bun.spawnSync(["git", ...gitArgs], { stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) {
    console.error(`git ${gitArgs.join(" ")} failed: ${result.stderr.toString().trim()}`)
    process.exit(2)
  }
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

const mutate: string[] = JSON.parse(readFileSync("stryker.config.json", "utf8")).mutate
const commands: Command[] = selectCommands(changed, mutate)

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
