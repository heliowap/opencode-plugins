import { execFile } from "node:child_process"

export type Base =
  | {
      readonly state: "behind"
      readonly ref: string
      readonly behind: number
      /** The ref came from the remote's default branch rather than from configuration. */
      readonly defaulted: boolean
    }
  /** A configured ref that this repository does not have. */
  | { readonly state: "unresolved"; readonly ref: string }
  /** Nothing configured, and the remote offers no default branch. */
  | { readonly state: "missing" }

export interface Upstream {
  readonly ref: string
  readonly behind: number
  readonly ahead: number
}

export interface Facts {
  readonly head: string
  /** Absent when HEAD is detached. */
  readonly branch?: string
  readonly dirty: number
  readonly fetch: "ok" | "failed"
  readonly base: Base
  /** Absent when HEAD is detached or the branch tracks nothing. */
  readonly upstream?: Upstream
}

// The result is appended to a prompt the user is waiting on, so a slow network degrades the report
// instead of the session: a fetch that runs out of time is reported as a failed fetch.
const FETCH_TIMEOUT = 10_000
const READ_TIMEOUT = 5_000
const UNBORN = "(no commits)"

interface Result {
  readonly ok: boolean
  readonly out: string
}

// Expected failures are part of the diagnosis: a branch that tracks nothing, a repository with no
// remote, a directory that is not a repository. They are returned, not thrown.
const git = (directory: string, args: ReadonlyArray<string>, timeout = READ_TIMEOUT) =>
  new Promise<Result>((resolve) => {
    execFile("git", [...args], { cwd: directory, timeout }, (error, stdout) =>
      resolve({ ok: !error, out: stdout.trim() }),
    )
  })

const behind = async (directory: string, ref: string) => {
  const result = await git(directory, ["rev-list", "--count", `HEAD..${ref}`])
  return result.ok ? Number(result.out) : undefined
}

const readBase = async (directory: string, configured: string | undefined): Promise<Base> => {
  if (configured) {
    const count = await behind(directory, configured)
    return count === undefined
      ? { state: "unresolved", ref: configured }
      : { state: "behind", ref: configured, behind: count, defaulted: false }
  }
  const fallback = await git(directory, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"])
  if (!fallback.ok) return { state: "missing" }
  const count = await behind(directory, fallback.out)
  return count === undefined
    ? { state: "missing" }
    : { state: "behind", ref: fallback.out, behind: count, defaulted: true }
}

const readUpstream = async (directory: string, branch: string | undefined) => {
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
 * Reads how stale `directory` is, or returns `undefined` when it is not a git repository. Runs
 * `git fetch --prune` and read-only git commands; it never changes the working tree, the index or
 * any ref.
 */
export const inspect = async (directory: string, configuredBase?: string): Promise<Facts | undefined> => {
  const repository = await git(directory, ["rev-parse", "--git-dir"])
  if (!repository.ok) return undefined

  const fetch = await git(directory, ["fetch", "--prune"], FETCH_TIMEOUT)
  const head = await git(directory, ["rev-parse", "--short", "HEAD"])
  const branch = await git(directory, ["symbolic-ref", "--quiet", "--short", "HEAD"])
  const status = await git(directory, ["status", "--porcelain"])

  return {
    head: head.ok ? head.out : UNBORN,
    ...(branch.ok ? { branch: branch.out } : {}),
    dirty: status.out === "" ? 0 : status.out.split("\n").length,
    fetch: fetch.ok ? "ok" : "failed",
    base: head.ok ? await readBase(directory, configuredBase) : { state: "missing" },
    ...(await readUpstream(directory, branch.ok ? branch.out : undefined)),
  }
}
