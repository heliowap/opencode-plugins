import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs"
import { dirname, join } from "node:path"

export const LOG_LIMIT = 200 * 1024 * 1024

export const logPath = (env: Readonly<Record<string, string | undefined>>, home: string) =>
  join(env.XDG_DATA_HOME ?? join(home, ".local", "share"), "opencode", "log", "goal.jsonl")

const size = (path: string) => {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

// The current file and one rotated file each hold up to half the limit, so rotating deletes the oldest half.
export const appendCapped = (path: string, line: string, limit: number) => {
  const entry = `${line}\n`
  const bytes = Buffer.byteLength(entry)
  const half = Math.floor(limit / 2)
  if (bytes > half) return
  mkdirSync(dirname(path), { recursive: true })
  if (size(path) + bytes > half) renameSync(path, path.replace(/\.jsonl$/, ".1.jsonl"))
  appendFileSync(path, entry)
}
