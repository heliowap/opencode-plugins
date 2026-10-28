#!/usr/bin/env bun
import { readdir } from "node:fs/promises"
import { join } from "node:path"
import { createInterface } from "node:readline"

export type Plugin = { name: string; description: string }

export const specFor = (name: string) => `github:heliowap/opencode-plugins#main::path:plugins/${name}`

export async function listPlugins(root = import.meta.dir): Promise<Plugin[]> {
  const entries = await readdir(join(root, "plugins"), { withFileTypes: true })
  const found: Plugin[] = []
  for (const entry of entries) {
    const file = Bun.file(join(root, "plugins", entry.name, "package.json"))
    if (!entry.isDirectory() || !(await file.exists())) continue
    const pkg = await file.json()
    found.push({ name: entry.name, description: pkg.description ?? "" })
  }
  return found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

async function interactiveSelection(plugins: Plugin[]): Promise<string[]> {
  plugins.forEach((plugin, index) => console.log(`${index + 1}) ${plugin.name}  ${plugin.description}`))
  const rl = createInterface({ input: process.stdin })
  const lines = rl[Symbol.asyncIterator]()
  const ask = async (question: string) => {
    process.stdout.write(question)
    return ((await lines.next()).value ?? "").trim()
  }
  const answer = await ask("Select plugins (e.g. '1 3' or 'all'): ")
  const picked =
    answer === "all"
      ? plugins.map((plugin) => plugin.name)
      : answer.split(/\s+/).filter(Boolean).map((token) => plugins[Number(token) - 1]?.name)
  if (picked.length === 0 || picked.some((name) => name === undefined)) {
    rl.close()
    console.error(`Invalid selection: ${answer}`)
    process.exit(2)
  }
  const names = picked as string[]
  console.log(`Will install: ${names.join(", ")}`)
  const confirm = (await ask("Proceed? [y/N] ")).toLowerCase()
  rl.close()
  return confirm === "y" || confirm === "yes" ? names : []
}

async function main(argv: string[]) {
  const plugins = await listPlugins()
  const valid = plugins.map((plugin) => plugin.name)
  const dryRun = argv.includes("--dry-run")
  const all = argv.includes("--all")
  const requested = argv.filter((arg) => !arg.startsWith("--"))
  const unknownFlags = argv.filter((arg) => arg.startsWith("--") && arg !== "--dry-run" && arg !== "--all")
  const unknown = [...unknownFlags, ...requested.filter((name) => !valid.includes(name))]
  if (unknown.length > 0) {
    console.error(`Unknown: ${unknown.join(", ")}`)
    console.error(`Valid plugins: ${valid.join(", ")}`)
    process.exit(2)
  }

  let selected: string[]
  if (all) selected = valid
  else if (requested.length > 0) selected = requested
  else if (process.stdin.isTTY || process.env.OPENCODE_PLUGINS_INTERACTIVE) selected = await interactiveSelection(plugins)
  else {
    console.error("Usage: install.ts [--dry-run] (--all | <name>...)")
    console.error(`Valid plugins: ${valid.join(", ")}`)
    process.exit(2)
  }

  if (selected.length === 0) {
    console.log("Nothing to install.")
    return
  }

  if (dryRun) {
    for (const name of selected) console.log(`opencode plugin add '${specFor(name)}'`)
    return
  }

  const ok: string[] = []
  const failed: string[] = []
  for (const name of selected) {
    const proc = Bun.spawn(["opencode", "plugin", "add", specFor(name)], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    })
    const code = await proc.exited
    if (code === 0) ok.push(name)
    else failed.push(name)
  }
  console.log(`installed: ${ok.join(", ") || "-"}`)
  console.log(`failed: ${failed.join(", ") || "-"}`)
  if (failed.length > 0) process.exit(1)
}

if (import.meta.main) await main(process.argv.slice(2))
