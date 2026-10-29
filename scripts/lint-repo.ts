#!/usr/bin/env bun
import { join } from "node:path"

export type Finding = { path: string; line: number; rule: string; message: string }

const OLD_SPEC = "github:heliowap/opencode-" + "v2-"
const MASK = "[RED" + "ACTED]"
const MASK_ALLOWED_PATHS = ["plugins/redact-secrets/", "evidence/"]
const MASK_DESCRIPTION = /\bmask\b/i

export const formatFinding = (finding: Finding) => `${finding.path}:${finding.line} ${finding.rule} ${finding.message}`

async function trackedFiles(root: string): Promise<string[]> {
  const proc = Bun.spawn(["git", "ls-files", "-z"], { cwd: root, stdout: "pipe", stderr: "pipe" })
  const out = await new Response(proc.stdout).text()
  if ((await proc.exited) !== 0) throw new Error(`git ls-files failed in ${root}: ${await new Response(proc.stderr).text()}`)
  return out.split("\0").filter(Boolean)
}

async function readText(root: string, path: string): Promise<string | undefined> {
  const file = Bun.file(join(root, path))
  if (!(await file.exists())) return undefined
  const text = await file.text()
  return text.includes("\0") ? undefined : text
}

function scanLines(path: string, text: string, check: (line: string) => Omit<Finding, "path" | "line"> | undefined): Finding[] {
  const found: Finding[] = []
  text.split("\n").forEach((line, index) => {
    const hit = check(line)
    if (hit) found.push({ path, line: index + 1, ...hit })
  })
  return found
}

async function pluginShape(root: string, files: string[]): Promise<Finding[]> {
  const tracked = new Set(files)
  const names = [...new Set(files.map((file) => file.match(/^plugins\/([^/]+)\//)?.[1]).filter((name) => name !== undefined))]
  const rootReadme = (await readText(root, "README.md")) ?? ""
  const found: Finding[] = []
  const add = (path: string, message: string) => found.push({ path, line: 1, rule: "plugin-shape", message })
  for (const name of names) {
    const dir = `plugins/${name}`
    if (!tracked.has(`${dir}/package.json`)) add(`${dir}/package.json`, "missing package.json")
    else {
      const pkg = JSON.parse((await readText(root, `${dir}/package.json`)) ?? "{}")
      if (!pkg.scripts?.typecheck) add(`${dir}/package.json`, 'missing "typecheck" script')
    }
    if (!tracked.has(`${dir}/bun.lock`)) add(`${dir}/bun.lock`, "missing bun.lock")
    if (!tracked.has(`${dir}/README.md`)) add(`${dir}/README.md`, "missing README.md")
    if (!rootReadme.includes(`\`${name}\``)) add("README.md", `${dir} is not listed in the root README.md`)
  }
  return found
}

export async function lintRepo(root: string): Promise<Finding[]> {
  const files = await trackedFiles(root)
  const found = await pluginShape(root, files)
  const perFile = await Promise.all(
    files.map(async (path) => {
      const text = await readText(root, path)
      if (text === undefined) return []
      const out: Finding[] = []
      if (text.includes(OLD_SPEC)) {
        out.push(
          ...scanLines(path, text, (line) =>
            line.includes(OLD_SPEC) && !line.startsWith("Formerly")
              ? { rule: "old-spec", message: "old install spec; use github:heliowap/opencode-plugins#main::path:plugins/<name>" }
              : undefined,
          ),
        )
      }
      if (text.includes(MASK) && !MASK_ALLOWED_PATHS.some((prefix) => path.startsWith(prefix))) {
        out.push(
          ...scanLines(path, text, (line) =>
            line.includes(MASK) && !MASK_DESCRIPTION.test(line)
              ? { rule: "redacted-literal", message: "literal mask text; restore the original value" }
              : undefined,
          ),
        )
      }
      if (/^plugins\/[^/]+\/package\.json$/.test(path)) {
        out.push(
          ...scanLines(path, text, (line) =>
            line.includes('"workspace:')
              ? { rule: "workspace-dep", message: "workspace: protocol; each plugin must install alone" }
              : undefined,
          ),
        )
      }
      return out
    }),
  )
  return [...found, ...perFile.flat()]
}

if (import.meta.main) {
  const findings = await lintRepo(process.argv[2] ?? join(import.meta.dir, ".."))
  for (const finding of findings) console.log(formatFinding(finding))
  process.exit(findings.length === 0 ? 0 : 1)
}
