import { execFile } from "node:child_process"

export interface Facts {
  readonly repository: boolean
  readonly head: string
  /** Absent when HEAD is detached. */
  readonly branch?: string
  readonly dirty: number
  readonly fetch: "ok" | "failed"
  /** Absent when no base ref could be resolved. */
  readonly base?: { readonly ref: string; readonly behind: number }
  /** Absent when HEAD is detached or the branch tracks nothing. */
  readonly upstream?: { readonly ref: string; readonly behind: number; readonly ahead: number }
}

const TIMEOUT = 120_000

interface Result {
  readonly ok: boolean
  readonly out: string
}

// Expected failures are part of the diagnosis: a branch with no upstream, a repository with no
// remote, a directory that is not a repository. They are returned, not thrown.
const git = (directory: string, args: ReadonlyArray<string>) =>
  new Promise<Result>((resolve) => {
    execFile("git", [...args], { cwd: directory, timeout: TIMEOUT }, (error, stdout) =>
      resolve({ ok: !error, out: stdout.trim() }),
    )
  })

const baseRef = async (directory: string, configured: string | undefined) => {
  if (configured) return configured
  // Falls back to the remote's own default branch, which may not be the branch you work from.
  const head = await git(directory, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"])
  return head.ok ? head.out : undefined
}

const base = async (directory: string, configured: string | undefined) => {
  const ref = await baseRef(directory, configured)
  if (!ref) return {}
  const behind = await git(directory, ["rev-list", "--count", `HEAD..${ref}`])
  if (!behind.ok) return {}
  return { base: { ref, behind: Number(behind.out) } }
}

const upstream = async (directory: string, branch: string | undefined) => {
  if (!branch) return {}
  const ref = await git(directory, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"])
  if (!ref.ok) return {}
  // `--left-right --count A...B` prints commits only in A (ahead) then commits only in B (behind).
  const divergence = await git(directory, ["rev-list", "--left-right", "--count", `HEAD...${ref.out}`])
  if (!divergence.ok) return {}
  const [ahead, behind] = divergence.out.split(/\s+/).map(Number)
  return { upstream: { ref: ref.out, behind: behind ?? 0, ahead: ahead ?? 0 } }
}

/**
 * Reads how stale `directory` is. Runs `git fetch --prune` and read-only git commands; it never
 * changes the working tree, the index or any ref.
 */
export const inspect = async (directory: string, configuredBase?: string): Promise<Facts> => {
  const repository = await git(directory, ["rev-parse", "--git-dir"])
  if (!repository.ok) return { repository: false, head: "", dirty: 0, fetch: "failed" }

  const fetch = await git(directory, ["fetch", "--prune"])
  const head = await git(directory, ["rev-parse", "--short", "HEAD"])
  const branch = await git(directory, ["symbolic-ref", "--quiet", "--short", "HEAD"])
  const status = await git(directory, ["status", "--porcelain"])

  return {
    repository: true,
    head: head.ok ? head.out : "(no commits)",
    ...(branch.ok ? { branch: branch.out } : {}),
    dirty: status.out === "" ? 0 : status.out.split("\n").length,
    fetch: fetch.ok ? "ok" : "failed",
    ...(await base(directory, configuredBase)),
    ...(await upstream(directory, branch.ok ? branch.out : undefined)),
  }
}
