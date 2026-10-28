import { expect, test } from "bun:test"
import { describe } from "../src/describe.ts"
import type { Base, Facts } from "../src/facts.ts"

const BEHIND: Base = { state: "behind", ref: "origin/dev", behind: 37, defaulted: false }

const facts = (overrides: Partial<Facts> = {}): Facts => ({
  head: "f8b803bb3",
  branch: "dev",
  dirty: 0,
  fetch: "ok",
  base: BEHIND,
  upstream: { ref: "origin/dev", behind: 0, ahead: 0 },
  ...overrides,
})

const GUARD =
  "No files were changed: this check only ran git fetch --prune and read-only git commands. Do not pull, rebase or merge on your own initiative."

const line = (facts: Facts, prefix: string) =>
  describe(facts)
    .split("\n")
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
  expect(line(facts({ base: { ...BEHIND, behind: 0 } }), "Base:")).toBe("Base: current with origin/dev.")
})

test("counts a single commit in the singular", () => {
  expect(line(facts({ base: { ...BEHIND, behind: 1 } }), "Base:")).toBe("Base: 1 commit behind origin/dev.")
})

test("says so when the base ref was defaulted instead of configured", () => {
  expect(line(facts({ base: { ...BEHIND, ref: "origin/main", defaulted: true } }), "Base:")).toBe(
    'Base: 37 commits behind origin/main (the remote\'s default branch; set this plugin\'s "base" option to compare against another).',
  )
})

test("asks for the base option when no base ref resolves", () => {
  expect(line(facts({ base: { state: "missing" } }), "Base:")).toBe(
    'Base: no base ref resolved; set this plugin\'s "base" option.',
  )
})

test("names the configured ref when it is the one that does not resolve", () => {
  expect(line(facts({ base: { state: "unresolved", ref: "origin/dev" } }), "Base:")).toBe(
    'Base: origin/dev does not resolve here; check this plugin\'s "base" option.',
  )
})

test("does not blame the option when the ref exists but the count failed", () => {
  expect(line(facts({ base: { state: "unreadable", ref: "origin/dev" } }), "Base:")).toBe(
    "Base: the distance to origin/dev could not be counted.",
  )
})

test("says a fact was unreadable instead of inventing one", () => {
  expect(line(facts({ head: undefined }), "Base check:")).toBe("Base check: branch dev at an unknown commit.")
  expect(line(facts({ dirty: undefined }), "Worktree:")).toBe("Worktree: could not be read.")
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
