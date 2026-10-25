import { expect, test } from "bun:test"
import { describe } from "../src/describe.ts"
import type { Facts } from "../src/facts.ts"

const facts = (overrides: Partial<Facts> = {}): Facts => ({
  repository: true,
  head: "f8b803bb3",
  branch: "dev",
  dirty: 0,
  fetch: "ok",
  base: { ref: "origin/dev", behind: 37 },
  upstream: { ref: "origin/dev", behind: 0, ahead: 0 },
  ...overrides,
})

const GUARD =
  "No files were changed: this check only ran git fetch --prune and read-only git commands. Do not pull, rebase or merge unless the task asks for it."

const line = (facts: Facts, prefix: string) =>
  describe(facts)
    ?.split("\n")
    .find((candidate) => candidate.startsWith(prefix))

test("reports head, stale base, in-sync upstream and a clean worktree", () => {
  expect(describe(facts())).toBe(
    [
      "Base check: branch dev at f8b803bb3.",
      "Base: 37 commits behind origin/dev.",
      "Upstream: in sync with origin/dev.",
      "Worktree: clean.",
      GUARD,
    ].join("\n"),
  )
})

test("names a detached HEAD instead of a branch, and drops the upstream line", () => {
  const detached = facts({ branch: undefined, upstream: undefined })

  expect(line(detached, "Base check:")).toBe("Base check: detached HEAD at f8b803bb3.")
  expect(line(detached, "Upstream:")).toBeUndefined()
})

test("says the base is current rather than counting zero commits", () => {
  expect(line(facts({ base: { ref: "origin/dev", behind: 0 } }), "Base:")).toBe("Base: current with origin/dev.")
})

test("counts a single commit in the singular", () => {
  expect(line(facts({ base: { ref: "origin/dev", behind: 1 } }), "Base:")).toBe("Base: 1 commit behind origin/dev.")
})

test("asks for the base option when no base ref resolves", () => {
  expect(line(facts({ base: undefined }), "Base:")).toBe(
    'Base: no base ref resolved; set this plugin\'s "base" option.',
  )
})

test("reports how the branch diverged from its upstream", () => {
  const upstream = (behind: number, ahead: number) =>
    line(facts({ upstream: { ref: "origin/dev", behind, ahead } }), "Upstream:")

  expect(upstream(2, 0)).toBe("Upstream: 2 commits behind origin/dev.")
  expect(upstream(0, 3)).toBe("Upstream: 3 commits ahead of origin/dev.")
  expect(upstream(2, 3)).toBe("Upstream: 2 commits behind and 3 ahead of origin/dev.")
})

test("reports a branch that tracks nothing", () => {
  expect(line(facts({ branch: "fix/2311", upstream: undefined }), "Upstream:")).toBe(
    "Upstream: fix/2311 tracks nothing.",
  )
})

test("counts uncommitted changes and warns that a rebase would need a stash", () => {
  expect(line(facts({ dirty: 4 }), "Worktree:")).toBe(
    "Worktree: 4 uncommitted changes, so a rebase here would need a stash.",
  )
  expect(line(facts({ dirty: 1 }), "Worktree:")).toBe(
    "Worktree: 1 uncommitted change, so a rebase here would need a stash.",
  )
})

test("warns that counts are stale when the fetch failed, and stays silent when it worked", () => {
  expect(line(facts({ fetch: "failed" }), "Fetch:")).toBe(
    "Fetch: git fetch --prune failed, so these counts come from local refs and may be stale.",
  )
  expect(line(facts(), "Fetch:")).toBeUndefined()
})

test("reports nothing outside a repository", () => {
  expect(describe(facts({ repository: false }))).toBeUndefined()
})
