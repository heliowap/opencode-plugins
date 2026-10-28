import { execFile } from "node:child_process"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Keeps the fixtures independent of the machine's git configuration and identity.
const ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_AUTHOR_NAME: "Base Check",
  GIT_AUTHOR_EMAIL: "base-check@example.com",
  GIT_COMMITTER_NAME: "Base Check",
  GIT_COMMITTER_EMAIL: "base-check@example.com",
}

const run = (directory: string, args: ReadonlyArray<string>) =>
  new Promise<string>((resolve, reject) => {
    execFile("git", [...args], { cwd: directory, env: ENV }, (error, stdout, stderr) =>
      error ? reject(new Error(`git ${args.join(" ")} in ${directory}: ${stderr}`)) : resolve(stdout.trim()),
    )
  })

export interface Workspace {
  /** The clone under test. */
  readonly directory: string
  /** Runs git inside the clone under test. */
  readonly git: (...args: string[]) => Promise<string>
  /** Adds a commit to the clone under test without pushing it. */
  readonly commit: (name: string) => Promise<void>
  /** Adds a commit to origin/dev through a separate clone. */
  readonly push: (name: string) => Promise<void>
  /** Leaves an untracked file in the clone under test. */
  readonly litter: (name: string) => Promise<void>
  /** Creates a sibling directory that is not a git repository. */
  readonly scratch: (name: string) => Promise<string>
  /** Creates a sibling repository that has no commits yet. */
  readonly unborn: () => Promise<string>
  readonly remove: () => Promise<void>
}

const write = (directory: string, name: string) => Bun.write(join(directory, name), `${name}\n`)

/**
 * Builds a bare origin whose default branch is `dev`, a seed clone that publishes commits to it,
 * and the clone under test tracking origin/dev.
 */
export const workspace = async (): Promise<Workspace> => {
  const root = await mkdtemp(join(tmpdir(), "base-check-"))
  const origin = join(root, "origin.git")
  const seed = join(root, "seed")
  const directory = join(root, "work")

  await run(root, ["init", "--bare", "--initial-branch=dev", origin])
  await run(root, ["clone", origin, seed])
  await write(seed, "seed.txt")
  await run(seed, ["add", "."])
  await run(seed, ["commit", "--message", "seed"])
  await run(seed, ["push", "--set-upstream", "origin", "dev"])
  await run(origin, ["symbolic-ref", "HEAD", "refs/heads/dev"])
  await run(root, ["clone", origin, directory])

  return {
    directory,
    git: (...args) => run(directory, args),
    commit: async (name) => {
      await write(directory, name)
      await run(directory, ["add", "."])
      await run(directory, ["commit", "--message", name])
    },
    push: async (name) => {
      await write(seed, name)
      await run(seed, ["add", "."])
      await run(seed, ["commit", "--message", name])
      await run(seed, ["push", "origin", "dev"])
    },
    litter: async (name) => {
      await write(directory, name)
    },
    scratch: async (name) => {
      const path = join(root, name)
      await mkdir(path)
      return path
    },
    unborn: async () => {
      const path = join(root, "unborn")
      await run(root, ["init", "--initial-branch=dev", path])
      return path
    },
    remove: () => rm(root, { recursive: true, force: true }),
  }
}
