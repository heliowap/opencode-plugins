/**
 * Unit tests cannot see the plugin wiring, so this drives the real thing.
 *
 * It builds a throwaway clone that is one commit behind origin/dev while the clone's own refs still
 * say zero, runs two prompts in one OpenCode session, and checks what OpenCode persisted: the base
 * check appended to the first prompt, saying "1 commit behind origin/dev", and nothing appended to
 * the second. Needs a configured provider and spends one model call per prompt.
 *
 * Usage: bun script/e2e.ts [model]
 */
import { join } from "node:path"
import { workspace } from "../test/harness/repository.ts"

const MODEL = process.argv[2] ?? "cli_proxy/cpa-claude-haiku-5-5"
const PROMPT = "Reply with the single word: ok"
const PLUGIN = new URL("..", import.meta.url).pathname
const PORT = 4387
const SERVER = `http://127.0.0.1:${PORT}`
// `opencode serve` requires a password and takes it from the environment, which also authenticates
// the clients below.
const ENV = { ...process.env, OPENCODE_PASSWORD: crypto.randomUUID() }

// PWD travels in the inherited environment and OpenCode reads it, so it has to agree with cwd.
const at = (cwd: string) => ({ cwd, env: { ...ENV, PWD: cwd } })

interface Message {
  readonly text: string
  readonly time: { readonly created: number }
}

const run = async (command: ReadonlyArray<string>, cwd: string) => {
  const spawned = Bun.spawn([...command], { ...at(cwd), stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr] = await Promise.all([new Response(spawned.stdout).text(), new Response(spawned.stderr).text()])
  if ((await spawned.exited) !== 0) throw new Error(`${command.join(" ")}\n${stderr}`)
  return stdout
}

// A server of its own, so the session, its plugins and its data stay out of the user's own service.
const serve = async (directory: string) => {
  // Inherited, not piped: an unread pipe fills up and stalls the server.
  const spawned = Bun.spawn(["opencode", "serve", "--port", String(PORT)], {
    ...at(directory),
    stdout: "inherit",
    stderr: "inherit",
  })
  for (let attempt = 0; attempt < 60; attempt += 1) {
    // Any answer means it is listening; the password is checked after that, by the clients.
    const reachable = await fetch(`${SERVER}/api/info`).then(
      () => true,
      () => false,
    )
    if (reachable) return spawned
    await Bun.sleep(500)
  }
  spawned.kill()
  throw new Error(`opencode serve did not answer on ${SERVER}`)
}

const prompt = (directory: string, session?: string) =>
  run(
    [
      "opencode",
      "run",
      "--server",
      SERVER,
      "--format",
      "json",
      "--model",
      MODEL,
      ...(session ? ["--session", session] : []),
      PROMPT,
    ],
    directory,
  )

const repo = await workspace()
let server: Bun.Subprocess | undefined
let verdict = 1
try {
  // Only a fetch can reveal this commit, so the report proves the fetch ran.
  await repo.push("published.txt")
  const local = await repo.git("rev-list", "--count", "HEAD..origin/dev")

  // This checkout is loaded where it is, by absolute path: OpenCode resolves a local plugin
  // directory from its root, which is what index.ts at the root of this package is for.
  await Bun.write(
    join(repo.directory, "opencode.jsonc"),
    `${JSON.stringify(
      {
        $schema: "https://opencode.ai/config.json",
        plugins: [{ package: PLUGIN, options: { base: "origin/dev" } }],
      },
      null,
      2,
    )}\n`,
  )

  server = await serve(repo.directory)
  const started = await prompt(repo.directory)
  const session = JSON.parse(started.trim().split("\n").at(-1) ?? "{}").sessionID
  if (typeof session !== "string") throw new Error(`no session id in:\n${started}`)
  await prompt(repo.directory, session)

  const messages = JSON.parse(
    await run(["opencode", "api", "get", `/api/session/${session}/message`, "--server", SERVER], repo.directory),
  )
  // Ordered by the recorded time rather than by the order the API happened to return.
  const prompts: ReadonlyArray<string> = messages.data
    .filter((message: { type: string }) => message.type === "user")
    .sort((one: Message, other: Message) => one.time.created - other.time.created)
    .map((message: Message) => message.text)

  const [first, second] = prompts
  const failures = [
    local === "0" ? undefined : `the clone's own refs already reported ${local} commits behind, so the fetch proves nothing`,
    prompts.length === 2 ? undefined : `expected 2 user messages, got ${prompts.length}`,
    first?.includes("Base: 1 commit behind origin/dev.") ? undefined : "the first prompt is missing the base check",
    second?.includes("Base check:") ? "the second prompt was annotated again" : undefined,
  ].filter((failure) => failure !== undefined)

  prompts.forEach((text, index) => console.log(`--- user message ${index + 1} ---\n${text}\n`))
  failures.forEach((failure) => console.error(`FAIL: ${failure}`))
  if (failures.length === 0) {
    console.log(`PASS: the clone's own refs said ${local} behind, and only the first prompt carries the base check.`)
  }
  verdict = failures.length === 0 ? 0 : 1
} finally {
  server?.kill()
  await repo.remove()
  // The server and the readiness probe both keep handles open, so the exit has to be explicit.
  process.exit(verdict)
}
