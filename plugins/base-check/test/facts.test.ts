import { afterEach, beforeEach, expect, test } from "bun:test"
import { stat, utimes } from "node:fs/promises"
import { join } from "node:path"
import { inspect } from "../src/facts.ts"
import { workspace, type Workspace } from "./harness/repository.ts"

const EPOCH = 1_577_847_600

let repo: Workspace

beforeEach(async () => {
  repo = await workspace()
})

afterEach(() => repo.remove())

test("a fresh clone is current with its base and its upstream", async () => {
  const facts = await inspect(repo.directory, "origin/dev")

  expect(facts).toEqual({
    head: await repo.git("rev-parse", "--short", "HEAD"),
    branch: "dev",
    dirty: 0,
    fetch: "ok",
    base: { state: "behind", ref: "origin/dev", behind: 0, defaulted: false },
    upstream: { ref: "origin/dev", behind: 0, ahead: 0 },
  })
})

test("fetches, so a commit pushed to the base after the clone is counted", async () => {
  await repo.push("published.txt")

  const stale = await repo.git("rev-list", "--count", "HEAD..origin/dev")
  const facts = await inspect(repo.directory, "origin/dev")

  // Proves the fetch ran: the count read from the clone's local refs is still zero.
  expect(stale).toBe("0")
  expect(facts?.base).toEqual({ state: "behind", ref: "origin/dev", behind: 1, defaulted: false })
  expect(facts?.upstream).toEqual({ ref: "origin/dev", behind: 1, ahead: 0 })
})

test("counts unpushed commits as ahead of the upstream", async () => {
  await repo.commit("local.txt")

  const facts = await inspect(repo.directory, "origin/dev")

  expect(facts?.base).toEqual({ state: "behind", ref: "origin/dev", behind: 0, defaulted: false })
  expect(facts?.upstream).toEqual({ ref: "origin/dev", behind: 0, ahead: 1 })
})

test("counts both sides of a divergence", async () => {
  await repo.commit("local.txt")
  await repo.push("published.txt")

  const facts = await inspect(repo.directory, "origin/dev")

  expect(facts?.upstream).toEqual({ ref: "origin/dev", behind: 1, ahead: 1 })
})

test("counts every entry git status reports", async () => {
  await repo.litter("one.txt")
  await repo.litter("two.txt")

  expect((await inspect(repo.directory, "origin/dev"))?.dirty).toBe(2)
})

test("leaves branch and upstream absent on a detached HEAD", async () => {
  await repo.git("checkout", "--detach", "HEAD")

  const facts = await inspect(repo.directory, "origin/dev")

  expect(facts?.branch).toBeUndefined()
  expect(facts?.upstream).toBeUndefined()
  expect(facts?.base).toEqual({ state: "behind", ref: "origin/dev", behind: 0, defaulted: false })
})

test("marks the base as defaulted when it comes from the remote's default branch", async () => {
  expect((await inspect(repo.directory))?.base).toEqual({
    state: "behind",
    ref: "origin/dev",
    behind: 0,
    defaulted: true,
  })
})

test("reports a configured base ref that this repository does not have", async () => {
  expect((await inspect(repo.directory, "origin/nope"))?.base).toEqual({ state: "unresolved", ref: "origin/nope" })
})

test("loses the base and the upstream when the remote is removed", async () => {
  await repo.git("remote", "remove", "origin")

  const facts = await inspect(repo.directory, "origin/dev")

  // `git fetch --prune` exits 0 in a repository with no remotes, so the fetch is not a failure.
  expect(facts?.fetch).toBe("ok")
  expect(facts?.base).toEqual({ state: "unresolved", ref: "origin/dev" })
  expect(facts?.upstream).toBeUndefined()
  expect(facts?.branch).toBe("dev")
})

test("reports a failed fetch but still counts against the local refs", async () => {
  await repo.git("remote", "set-url", "origin", await repo.scratch("gone"))

  const facts = await inspect(repo.directory, "origin/dev")

  expect(facts?.fetch).toBe("failed")
  expect(facts?.base).toEqual({ state: "behind", ref: "origin/dev", behind: 0, defaulted: false })
})

test("leaves the head absent in a repository that has no commits yet", async () => {
  const facts = await inspect(await repo.unborn())

  expect(facts?.head).toBeUndefined()
  expect(facts?.base).toEqual({ state: "missing" })
})

test("separates a base ref that is absent from one that exists but cannot be counted", async () => {
  // An orphan branch has no commit to count from, while origin/dev is still there.
  await repo.git("checkout", "--orphan", "fresh")

  expect((await inspect(repo.directory, "origin/dev"))?.base).toEqual({ state: "unreadable", ref: "origin/dev" })
  expect((await inspect(repo.directory, "origin/nope"))?.base).toEqual({ state: "unresolved", ref: "origin/nope" })
})

test("reads the status without rewriting the index", async () => {
  const index = join(repo.directory, ".git/index")
  await utimes(index, EPOCH, EPOCH)

  await inspect(repo.directory, "origin/dev")

  expect((await stat(index)).mtimeMs).toBe(EPOCH * 1000)
})

test("reports nothing for a directory that is not a repository", async () => {
  expect(await inspect(await repo.scratch("plain"))).toBeUndefined()
})
