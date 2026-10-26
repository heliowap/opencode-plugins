export type Command = readonly string[]

export interface Plan {
  readonly mutate: readonly string[]
  readonly indexGraph: readonly string[]
  readonly tuiGraph: readonly string[]
  readonly exists: (file: string) => boolean
}

const TYPECHECK: Command = ["bun", "run", "typecheck"]
const UNIT: Command = ["bun", "test", "--coverage"]
const FULL_HOST: Command = ["bun", "test", "./host"]
const MUTATION: Command = ["bun", "run", "mutation"]
const hostFile = (file: string): Command => ["bun", "test", `./${file}`]

const hostTestFile = /^host\/[^/]+\.test\.ts$/
const unitTestFile = /^test\/(.+)\.test\.ts$/
const TUI_HOST_TEST = "host/tui.test.ts"
const DEPENDENCY_FILES = ["package.json", "bun.lock"]
const typecheckFile = (file: string) => /\.tsx?$/.test(file) || file === "tsconfig.json" || DEPENDENCY_FILES.includes(file)
const unitFile = (file: string) =>
  /^(src|test|templates|scripts)\//.test(file) || file === "bunfig.toml" || DEPENDENCY_FILES.includes(file)

const sourceOf = (file: string) => {
  const match = unitTestFile.exec(file)
  return match ? `src/${match[1]}.ts` : file
}

// Templates are read by host/package.test.ts, so a template change runs the full host suite.
export function selectCommands(changedFiles: readonly string[], plan: Plan): Command[] {
  const anyChanged = (predicate: (file: string) => boolean) => changedFiles.some(predicate)
  const indexGraph = new Set(plan.indexGraph)
  const tuiGraph = new Set(plan.tuiGraph)

  const fullHost = anyChanged(
    (file) =>
      DEPENDENCY_FILES.includes(file) ||
      indexGraph.has(file) ||
      file.startsWith("templates/") ||
      (file.startsWith("host/") && !file.startsWith("host/live/") && !hostTestFile.test(file)),
  )

  const hostFiles = new Set(changedFiles.filter((file) => hostTestFile.test(file)))
  if (anyChanged((file) => tuiGraph.has(file))) hostFiles.add(TUI_HOST_TEST)
  const singleHostFiles = [...hostFiles].filter(plan.exists).sort()

  const mutatedChanged = anyChanged((file) => file === "stryker.config.json" || plan.mutate.includes(sourceOf(file)))

  const commands: Command[] = []
  if (anyChanged(typecheckFile)) commands.push(TYPECHECK)
  if (anyChanged(unitFile)) commands.push(UNIT)
  if (fullHost) commands.push(FULL_HOST)
  else for (const file of singleHostFiles) commands.push(hostFile(file))
  if (mutatedChanged) commands.push(MUTATION)
  return commands
}

// Files reachable from `entry` through relative imports. Only src/ files are followed,
// so the host graph never contains test or harness code.
export function importClosure(entry: string, importsOf: (file: string) => readonly string[]): string[] {
  const seen = new Set([entry])
  const queue = [entry]
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    for (const target of importsOf(file)) {
      if (!target.startsWith("src/") || seen.has(target)) continue
      seen.add(target)
      queue.push(target)
    }
  }
  return [...seen].sort()
}
