import { join } from "node:path"
import { listPlugins } from "../install.ts"

type Row = { name: string; runner: string; bun: string; opencode: string; test: string }

export const OVERRIDES: Record<string, Partial<Omit<Row, "name">>> = {
  goal: { bun: "1.4.0", test: "bun test --coverage" },
  "cliproxy-quota": { bun: "1.4.0", test: "bun test && bun script/check-tests.ts" },
  "protect-agents-md": { runner: "macos-latest", opencode: "2.0.32" },
}

const root = join(import.meta.dir, "..")

export function selectPlugins(paths: string[], all: string[]): string[] {
  if (paths.some((path) => path.startsWith(".github/workflows/") || path === "scripts/ci-matrix.ts")) return all
  const hit = new Set(paths.map((path) => path.match(/^plugins\/([^/]+)\//)?.[1]).filter((name) => name !== undefined))
  return all.filter((name) => hit.has(name))
}

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
  const selected = process.argv.includes("--all")
    ? all
    : selectPlugins((await Bun.stdin.text()).split("\n").map((line) => line.trim()).filter(Boolean), all)
  const include = await Promise.all(selected.map(row))
  process.stdout.write(`matrix=${JSON.stringify({ include })}\nplugins=${JSON.stringify(selected)}\n`)
}
