// Maps changed files to the verification commands AGENTS.md requires for them.
// The CLI in scripts/verify-changed.ts runs the result.

export type Command = readonly string[]

const TYPECHECK: Command = ["bun", "run", "typecheck"]
const UNIT: Command = ["bun", "test"]
const FULL_HOST: Command = ["bun", "test", "./host"]
const MUTATION: Command = ["bun", "run", "mutation"]

const hostTestFile = /^host\/[^/]+\.test\.ts$/
const unitTestFile = /^test\/(.+)\.test\.ts$/

// A unit test maps to the source it tests; any other file maps to itself.
const sourceOf = (file: string) => {
  const match = unitTestFile.exec(file)
  return match ? `src/${match[1]}.ts` : file
}

// `mutate` is the list of source files from stryker.config.json.
export function selectCommands(changedFiles: readonly string[], mutate: readonly string[]): Command[] {
  const any = (predicate: (file: string) => boolean) => changedFiles.some(predicate)

  const fullHost = any((file) => file === "src/index.ts" || file.startsWith("host/harness/"))
  const hostFiles = new Set(changedFiles.filter((file) => hostTestFile.test(file)))
  if (any((file) => file === "src/tui.tsx")) hostFiles.add("host/tui.test.ts")

  const mutated = any((file) => mutate.includes(sourceOf(file)))

  const commands: Command[] = []
  if (any((file) => /\.tsx?$/.test(file))) commands.push(TYPECHECK)
  if (any((file) => file.startsWith("src/") || file.startsWith("test/") || file.startsWith("templates/"))) commands.push(UNIT)
  if (fullHost) commands.push(FULL_HOST)
  else for (const file of [...hostFiles].sort()) commands.push(["bun", "test", `./${file}`])
  if (mutated) commands.push(MUTATION)
  return commands
}
