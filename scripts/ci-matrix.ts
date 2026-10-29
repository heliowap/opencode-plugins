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

const PLUGIN_RUNTIME_DIRS = new Set(["src", "host", "templates", "test", "scripts"])
const GOAL_HOST_INPUTS = new Set([
  ...PLUGIN_RUNTIME_DIRS,
  "package.json",
  "bun.lock",
  "bunfig.toml",
  "tsconfig.json",
  "stryker.config.json",
])

type PluginPath = { plugin: string; top: string; kind: "runtime" | "doc" }

function classifyPluginPath(path: string): PluginPath | undefined {
  const match = path.match(/^plugins\/([^/]+)\/(([^/]+)(?:\/.*)?)$/)
  if (!match) return undefined
  const [, plugin = "", rest = "", top = ""] = match
  const doc = top === "docs" || (rest.endsWith(".md") && !PLUGIN_RUNTIME_DIRS.has(top))
  return { plugin, top, kind: doc ? "doc" : "runtime" }
}

export function selectPlugins(paths: string[], all: string[]): string[] {
  if (paths.some(isWorkflow)) return all
  const hit = new Set(paths.map((path) => classifyPluginPath(path)).flatMap((hit) => (hit?.kind === "runtime" ? [hit.plugin] : [])))
  return all.filter((name) => hit.has(name))
}

export const goalRuntime = (paths: string[]): boolean =>
  paths.some((path) => {
    const hit = classifyPluginPath(path)
    return isWorkflow(path) || (hit?.plugin === "goal" && hit.kind === "runtime" && GOAL_HOST_INPUTS.has(hit.top))
  })

export const goalMutation = (paths: string[]): boolean =>
  paths.some((path) => {
    const hit = classifyPluginPath(path)
    return hit?.plugin === "goal" && hit.kind === "runtime" && hit.top === "src"
  })

const ROOT_FILES = new Set(["install.ts", "package.json", "bun.lock", "tsconfig.json"])

export const rootChanged = (paths: string[]): boolean =>
  paths.some((path) => ROOT_FILES.has(path) || path.startsWith("scripts/") || path.startsWith("test/") || path.startsWith(".github/"))

export type PackageJson = { scripts: Record<string, string> }

export function parsePackageJson(text: string): PackageJson | undefined {
  const data: unknown = JSON.parse(text)
  if (typeof data !== "object" || data === null || Array.isArray(data)) return undefined
  const scripts = "scripts" in data ? data.scripts : {}
  if (typeof scripts !== "object" || scripts === null || Array.isArray(scripts)) return undefined
  const entries = Object.entries(scripts)
  if (!entries.every(([, value]) => typeof value === "string")) return undefined
  return { scripts: Object.fromEntries(entries) }
}

async function row(name: string): Promise<Row> {
  const pkg = parsePackageJson(await Bun.file(join(root, "plugins", name, "package.json")).text())
  return {
    name,
    runner: "ubuntu-latest",
    bun: "1.4.3",
    opencode: "",
    test: pkg?.scripts.test ? "bun run test" : "",
    ...OVERRIDES[name],
  }
}

if (import.meta.main) {
  const all = (await listPlugins()).map((plugin) => plugin.name)
  const every = process.argv.includes("--all")
  const withMutation = process.argv.includes("--with-mutation")
  const paths = every ? [] : (await Bun.stdin.text()).split("\n").map((line) => line.trim()).filter(Boolean)
  const selected = every ? all : selectPlugins(paths, all)
  const include = await Promise.all(selected.map(row))
  process.stdout.write(
    [
      `matrix=${JSON.stringify({ include })}`,
      `plugins=${JSON.stringify(selected)}`,
      `goal_runtime=${every || goalRuntime(paths)}`,
      `goal_mutation=${withMutation || goalMutation(paths)}`,
      "",
    ].join("\n"),
  )
}
