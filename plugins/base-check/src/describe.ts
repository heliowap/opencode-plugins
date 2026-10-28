import type { Base, Facts } from "./facts.ts"

const GUARD =
  "No files were changed: this check only ran git fetch --prune and read-only git commands. Do not pull, rebase or merge on your own initiative."
const OPTION = 'this plugin\'s "base" option'

const plural = (count: number, noun: string) => `${count} ${count === 1 ? noun : `${noun}s`}`

const head = (facts: Facts) => {
  const commit = facts.head ?? "an unknown commit"
  return facts.branch ? `Base check: branch ${facts.branch} at ${commit}.` : `Base check: detached HEAD at ${commit}.`
}

// A defaulted ref says so, because the remote's default branch is often not the branch the work
// branches off, and a confident count against the wrong branch is worse than no count.
const base = (base: Base) => {
  if (base.state === "missing") return `Base: no base ref resolved; set ${OPTION}.`
  if (base.state === "unresolved") return `Base: ${base.ref} does not resolve here; check ${OPTION}.`
  if (base.state === "unreadable") return `Base: the distance to ${base.ref} could not be counted.`
  const source = base.defaulted ? ` (the remote's default branch; set ${OPTION} to compare against another)` : ""
  if (base.behind === 0) return `Base: current with ${base.ref}${source}.`
  return `Base: ${plural(base.behind, "commit")} behind ${base.ref}${source}.`
}

// A detached HEAD has no upstream to be in sync with, so it gets no line at all.
const upstream = (facts: Facts) => {
  if (!facts.branch) return undefined
  if (!facts.upstream) return `Upstream: ${facts.branch} tracks nothing.`
  const { ref, behind, ahead } = facts.upstream
  if (behind === 0 && ahead === 0) return `Upstream: in sync with ${ref}.`
  if (ahead === 0) return `Upstream: ${plural(behind, "commit")} behind ${ref}.`
  if (behind === 0) return `Upstream: ${plural(ahead, "commit")} ahead of ${ref}.`
  return `Upstream: ${plural(behind, "commit")} behind and ${ahead} ahead of ${ref}.`
}

const worktree = (facts: Facts) => {
  if (facts.dirty === undefined) return "Worktree: could not be read."
  if (facts.dirty === 0) return "Worktree: clean."
  return `Worktree: ${plural(facts.dirty, "uncommitted change")}, so a rebase here would need a stash.`
}

export const describe = (facts: Facts) =>
  [
    head(facts),
    base(facts.base),
    upstream(facts),
    worktree(facts),
    facts.fetch === "failed"
      ? "Fetch: git fetch --prune failed, so these counts come from local refs and may be stale."
      : undefined,
    GUARD,
  ]
    .filter((candidate) => candidate !== undefined)
    .join("\n")
