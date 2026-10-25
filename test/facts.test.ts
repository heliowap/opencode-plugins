import { afterEach, beforeEach, expect, test } from "bun:test"
import { inspect } from "../src/facts.ts"
import { workspace, type Workspace } from "./harness/repository.ts"

let repo: Workspace

beforeEach(async () => {
  repo = await workspace()
})

afterEach(() => repo.remove())

test("a fresh clone is current with its base and its upstream", async () => {
  const facts = await inspect(repo.directory, "origin/dev")

  expect(facts).toEqual({
    repository: true,
    head: await repo.git("rev-parse", "--short", "HEAD"),
    branch: "dev",
    dirty: 0,
    fetch: "ok",
    base: { ref: "origin/dev", behind: 0 },
    upstream: { ref: "origin/dev", behind: 0, ahead: 0 },
  })
})

test("fetches, so a commit pushed to the base after the clone is counted", async () => {
  await repo.push("published.txt")

  const stale = await repo.git("rev-list", "--count", "HEAD..origin/dev")
  const facts = await inspect(repo.directory, "origin/dev")

  // Proves the fetch ran: the count read from the clone's local refs is still zero.
  expect(stale).toBe("0")
  expect(facts.base).toEqual({ ref: "origin/dev", behind: 1 })
  expect(facts.upstream).toEqual({ ref: "origin/dev", behind: 1, ahead: 0 })
})

test("counts unpushed commits as ahead of the upstream", async () => {
  await repo.commit("local.txt")

  const facts = await inspect(repo.directory, "origin/dev")

  expect(facts.base).toEqual({ ref: "origin/dev", behind: 0 })
  expect(facts.upstream).toEqual({ ref: "origin/dev", behind: 0, ahead: 1 })
})

test("counts both sides of a divergence", async () => {
  await repo.commit("local.txt")
  await repo.push("published.txt")

  const facts = await inspect(repo.directory, "origin/dev")

  expect(facts.upstream).toEqual({ ref: "origin/dev", behind: 1, ahead: 1 })
})

test("counts every entry git status reports", async () => {
  await repo.litter("one.txt")
  await repo.litter("two.txt")

  expect((await inspect(repo.directory, "origin/dev")).dirty).toBe(2)
})

test("leaves branch and upstream absent on a detached HEAD", async () => {
  await repo.git("checkout", "--detach", "HEAD")

  const facts = await inspect(repo.directory, "origin/dev")

  expect(facts.branch).toBeUndefined()
  expect(facts.upstream).toBeUndefined()
  expect(facts.base).toEqual({ ref: "origin/dev", behind: 0 })
})

test("resolves the base from the remote's default branch when none is configured", async () => {
  expect((await inspect(repo.directory)).base).toEqual({ ref: "origin/dev", behind: 0 })
})

test("loses the base and the upstream when the remote is removed", async () => {
  await repo.git("remote", "remove", "origin")

  const facts = await inspect(repo.directory, "origin/dev")

  // `git fetch --prune` exits 0 in a repository with no remotes, so the fetch is not a failure.
  expect(facts.fetch).toBe("ok")
  expect(facts.base).toBeUndefined()
  expect(facts.upstream).toBeUndefined()
  expect(facts.branch).toBe("dev")
})

test("reports a failed fetch but still counts against the local refs", async () => {
  await repo.git("remote", "set-url", "origin", await repo.scratch("gone"))

  const facts = await inspect(repo.directory, "origin/dev")

  expect(facts.fetch).toBe("failed")
  expect(facts.base).toEqual({ ref: "origin/dev", behind: 0 })
})

test("reports a repository that has no commits yet", async () => {
  const facts = await inspect(await repo.unborn())

  expect(facts.repository).toBe(true)
  expect(facts.head).toBe("(no commits)")
})

test("reports that a plain directory is not a repository", async () => {
  expect(await inspect(await repo.scratch("plain"))).toEqual({
    repository: false,
    head: "",
    dirty: 0,
    fetch: "failed",
  })
})
