import { join } from "node:path"
import { listPlugins } from "../install.ts"

type Row = { name: string; runner: string; bun: string; opencode: string; test: string }

export const OVERRIDES: Record<string, Partial<Omit<Row, "name">>> = {
  goal: { bun: "1.4.0", test: "bun test --coverage" },
  "cliproxy-quota": { bun: "1.4.0", test: "bun test && bun script/check-tests.ts" },
  "protect-agents-md": { runner: "macos-latest", opencode: "2.0.32" },
}

const root = join(import.meta.dir, "..")

const isWorkflow = (path: string) => path.startsWith(".github/workflows/") || path === "scripts/ci-matrix.ts"

const GOAL_RUNTIME = /^plugins\/goal\/(?:(?:src|host|templates|test|scripts)\/|(?:package\.json|bun\.lock|bunfig\.toml|tsconfig\.json|stryker\.config\.json)$)/

function isDoc(path: string): boolean {
  const inPlugin = path.match(/^plugins\/[^/]+\/(.*)$/)?.[1]
  if (inPlugin === undefined) return path.endsWith(".md") || path.startsWith("docs/")
  return inPlugin.startsWith("docs/") || (inPlugin.endsWith(".md") && !inPlugin.startsWith("templates/"))
}

export function selectPlugins(paths: string[], all: string[]): string[] {
  if (paths.some(isWorkflow)) return all
  const hit = new Set(
    paths
      .filter((path) => !isDoc(path))
      .map((path) => path.match(/^plugins\/([^/]+)\//)?.[1])
      .filter((name) => name !== undefined),
  )
  return all.filter((name) => hit.has(name))
}

export const goalRuntime = (paths: string[]): boolean => paths.some((path) => isWorkflow(path) || GOAL_RUNTIME.test(path))

export const goalMutation = (paths: string[]): boolean => paths.some((path) => path.startsWith("plugins/goal/src/"))

async function row(name: string): Promise<Row> {
  const pkg = await Bun.file(join(root, "plugins", name, "package.json")).json()
  return {
    name,
    runner: "ubuntu-latest",
    bun: "1.4.3",
    opencode: "",
    test: pkg.scripts?.test ? "bun run test" : "",
    ...OVERRIDES[name],
  }
}

if (import.meta.main) {
  const all = (await listPlugins()).map((plugin) => plugin.name)
  const every = process.argv.includes("--all")
  const paths = every ? [] : (await Bun.stdin.text()).split("\n").map((line) => line.trim()).filter(Boolean)
  const selected = every ? all : selectPlugins(paths, all)
  const include = await Promise.all(selected.map(row))
  process.stdout.write(
    [
      `matrix=${JSON.stringify({ include })}`,
      `plugins=${JSON.stringify(selected)}`,
      `goal_runtime=${every || goalRuntime(paths)}`,
      `goal_mutation=${every || goalMutation(paths)}`,
      "",
    ].join("\n"),
  )
}
