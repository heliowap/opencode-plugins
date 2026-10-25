import type { Facts } from "./facts.ts"

const GUARD =
  "No files were changed: this check only ran git fetch --prune and read-only git commands. Do not pull, rebase or merge unless the task asks for it."

const commits = (count: number) => `${count} ${count === 1 ? "commit" : "commits"}`

const head = (facts: Facts) =>
  facts.branch ? `Base check: branch ${facts.branch} at ${facts.head}.` : `Base check: detached HEAD at ${facts.head}.`

const base = (facts: Facts) => {
  if (!facts.base) return 'Base: no base ref resolved; set this plugin\'s "base" option.'
  if (facts.base.behind === 0) return `Base: current with ${facts.base.ref}.`
  return `Base: ${commits(facts.base.behind)} behind ${facts.base.ref}.`
}

// A detached HEAD has no upstream to be in sync with, so it gets no line at all.
const upstream = (facts: Facts) => {
  if (!facts.branch) return undefined
  if (!facts.upstream) return `Upstream: ${facts.branch} tracks nothing.`
  const { ref, behind, ahead } = facts.upstream
  if (behind === 0 && ahead === 0) return `Upstream: in sync with ${ref}.`
  if (ahead === 0) return `Upstream: ${commits(behind)} behind ${ref}.`
  if (behind === 0) return `Upstream: ${commits(ahead)} ahead of ${ref}.`
  return `Upstream: ${commits(behind)} behind and ${ahead} ahead of ${ref}.`
}

const worktree = (facts: Facts) =>
  facts.dirty === 0
    ? "Worktree: clean."
    : `Worktree: ${facts.dirty} uncommitted ${facts.dirty === 1 ? "change" : "changes"}, so a rebase here would need a stash.`

export const describe = (facts: Facts) =>
  facts.repository
    ? [
        head(facts),
        base(facts),
        upstream(facts),
        worktree(facts),
        facts.fetch === "failed"
          ? "Fetch: git fetch --prune failed, so these counts come from local refs and may be stale."
          : undefined,
        GUARD,
      ]
        .filter((candidate) => candidate !== undefined)
        .join("\n")
    : undefined
