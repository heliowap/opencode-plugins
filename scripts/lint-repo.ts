#!/usr/bin/env bun
import { join } from "node:path"
import { specFor } from "../install.ts"
import { parsePackageJson } from "./ci-matrix.ts"

export type Finding = { path: string; line: number; rule: string; message: string }
type Options = { staged: boolean }
type Read = (path: string) => string | undefined

const OLD_SPEC = "github:heliowap/opencode-" + "v2-"
const MASK = "[RED" + "ACTED]"
const MASK_ALLOWED_PATHS = ["plugins/redact-secrets/", "evidence/"]
const MASK_DESCRIPTION = /\bmask\b/i
const PLUGIN_FILES = ["bun.lock", "tsconfig.json", "README.md"]

export const formatFinding = (finding: Finding) => `${finding.path}:${finding.line} ${finding.rule} ${finding.message}`

async function git(root: string, args: string[], input?: string): Promise<Uint8Array> {
  const proc = Bun.spawn(["git", ...args], { cwd: root, stdin: input === undefined ? "ignore" : new Blob([input]), stdout: "pipe", stderr: "pipe" })
  const [out, err] = await Promise.all([new Response(proc.stdout).bytes(), new Response(proc.stderr).text()])
  if ((await proc.exited) !== 0) throw new Error(`git ${args.join(" ")} failed in ${root}: ${err}`)
  return out
}

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
const textOrUndefined = (text: string) => (text.includes("\0") ? undefined : text)

async function stagedContents(root: string, files: string[]): Promise<Map<string, string | undefined>> {
  const out = await git(root, ["cat-file", "--batch"], files.map((file) => `:${file}\n`).join(""))
  const contents = new Map<string, string | undefined>()
  let offset = 0
  for (const file of files) {
    const headerEnd = out.indexOf(10, offset)
    const [, type, size] = decode(out.subarray(offset, headerEnd)).split(" ")
    const length = Number(size)
    const start = headerEnd + 1
    contents.set(file, type === "blob" ? textOrUndefined(decode(out.subarray(start, start + length))) : undefined)
    offset = start + length + 1
  }
  return contents
}

async function workingContents(root: string, files: string[]): Promise<Map<string, string | undefined>> {
  const entries = await Promise.all(
    files.map(async (file): Promise<[string, string | undefined]> => {
      const handle = Bun.file(join(root, file))
      return [file, (await handle.exists()) ? textOrUndefined(await handle.text()) : undefined]
    }),
  )
  return new Map(entries)
}

function scanLines(path: string, text: string, check: (line: string) => Omit<Finding, "path" | "line"> | undefined): Finding[] {
  const found: Finding[] = []
  text.split("\n").forEach((line, index) => {
    const hit = check(line)
    if (hit) found.push({ path, line: index + 1, ...hit })
  })
  return found
}

function pluginShape(files: string[], read: Read): Finding[] {
  const tracked = new Set(files)
  const names = [...new Set(files.flatMap((file) => file.match(/^plugins\/([^/]+)\//)?.[1] ?? []))]
  const rootReadme = read("README.md") ?? ""
  const found: Finding[] = []
  const add = (path: string, message: string) => found.push({ path, line: 1, rule: "plugin-shape", message })
  for (const name of names) {
    const dir = `plugins/${name}`
    const pkgText = read(`${dir}/package.json`)
    if (!tracked.has(`${dir}/package.json`) || pkgText === undefined) add(`${dir}/package.json`, "missing package.json")
    else {
      const pkg = parsePackageJson(pkgText)
      if (pkg === undefined) add(`${dir}/package.json`, "invalid package.json shape")
      else if (!pkg.scripts.typecheck) add(`${dir}/package.json`, 'missing "typecheck" script')
    }
    for (const file of PLUGIN_FILES) if (!tracked.has(`${dir}/${file}`)) add(`${dir}/${file}`, `missing ${file}`)
    if (!rootReadme.includes(`\`${name}\``)) add("README.md", `${dir} is not listed in the root README.md`)
  }
  return found
}

function scanFile(path: string, text: string): Finding[] {
  const out: Finding[] = []
  out.push(
    ...scanLines(path, text, (line) =>
      line.includes(OLD_SPEC) && !line.startsWith("Formerly")
        ? { rule: "old-spec", message: `old install spec; use ${specFor("<name>")}` }
        : undefined,
    ),
  )
  const maskAllowed = MASK_ALLOWED_PATHS.some((prefix) => path.startsWith(prefix))
  if (!maskAllowed) {
    out.push(
      ...scanLines(path, text, (line) =>
        line.includes(MASK) && !(path.endsWith(".md") && MASK_DESCRIPTION.test(line))
          ? { rule: "redacted-literal", message: "literal mask text; restore the original value" }
          : undefined,
      ),
    )
  }
  if (/^plugins\/[^/]+\/package\.json$/.test(path)) {
    out.push(
      ...scanLines(path, text, (line) =>
        line.includes('"workspace:') ? { rule: "workspace-dep", message: "workspace: protocol; each plugin must install alone" } : undefined,
      ),
    )
  }
  return out
}

export async function lintRepo(root: string, options: Options = { staged: false }): Promise<Finding[]> {
  const files = decode(await git(root, ["ls-files", "-z"])).split("\0").filter(Boolean)
  const contents = await (options.staged ? stagedContents(root, files) : workingContents(root, files))
  const read: Read = (path) => contents.get(path)
  const scanned = files.flatMap((file) => scanFile(file, read(file) ?? ""))
  return [...pluginShape(files, read), ...scanned]
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const findings = await lintRepo(args.find((arg) => !arg.startsWith("--")) ?? join(import.meta.dir, ".."), { staged: args.includes("--staged") })
  for (const finding of findings) console.log(formatFinding(finding))
  process.exit(findings.length === 0 ? 0 : 1)
}
