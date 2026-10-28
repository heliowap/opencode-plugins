import { Database } from "bun:sqlite"
import { statSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import type { Goal } from "../../src/goal.ts"
import { startFixture, type Fixture, type Script } from "./fixture.ts"

const REPO = resolve(import.meta.dir, "../..")
const PASSWORD = "host-canary"

export interface HostOptions {
  readonly script?: Script
  readonly pluginSpec?: string
  readonly model?: { readonly providerID: string; readonly id: string; readonly variant?: string }
  readonly providers?: Record<string, unknown>
  readonly allowAll?: boolean
  readonly noHostRetry?: boolean
  readonly pluginOptions?: Record<string, unknown>
  readonly env?: Record<string, string>
}

export interface Session {
  readonly id: string
}

export type Message = { readonly type: string; readonly text?: string; readonly outcome?: string } & Record<string, unknown>

class PluginInstallError extends Error {}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))

const freePort = () => {
  const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() })
  const port = probe.port!
  probe.stop(true)
  return port
}

export class Host {
  private constructor(
    readonly root: string,
    readonly project: string,
    readonly fixture: Fixture,
    readonly model: NonNullable<HostOptions["model"]>,
    readonly base: string,
    readonly env: Record<string, string>,
    private process: ReturnType<typeof Bun.spawn>,
    private readonly logs: string[],
    private logOffset: number,
  ) {}

  static async start(options: HostOptions): Promise<Host> {
    try {
      return await Host.launch(options)
    } catch (error) {
      // OpenCode reports a plugin install failure only in its own log, and installs fail transiently, so tolerate one relaunch.
      if (!(error instanceof PluginInstallError)) throw error
      return Host.launch(options)
    }
  }

  private static logSize(env: Record<string, string>) {
    try {
      return statSync(join(env.XDG_DATA_HOME!, "opencode", "log", "opencode.log")).size
    } catch {
      return 0
    }
  }

  private static async launch(options: HostOptions): Promise<Host> {
    const root = await mkdtemp(join(tmpdir(), "goal-host-"))
    const project = join(root, "project")
    const config = join(root, "config", "opencode")
    for (const dir of [project, config, ...["home", "data", "cache", "state"].map((d) => join(root, d))]) {
      await mkdir(dir, { recursive: true })
    }
    const fixture = startFixture(options.script ?? (() => ({ status: 500, error: "no fixture script in a live run" })))
    const model = options.model ?? { providerID: "fixture", id: "test" }
    await writeFile(
      join(config, "opencode.jsonc"),
      JSON.stringify({
        model: `${model.providerID}/${model.id}`,
        providers: {
          fixture: {
            name: "Fixture",
            package: "@opencode/ai/providers/openai-compatible",
            settings: { baseURL: fixture.url, apiKey: "fixture" },
            models: { test: { name: "Fixture model" } },
          },
          ...options.providers,
        },
        plugins: [
          {
            package: options.pluginSpec ?? `file://${join(REPO, "src")}`,
            options: { continuationDelayMs: 0, ...options.pluginOptions },
          },
        ],
        ...(options.allowAll && { permissions: [{ action: "*", resource: "*", effect: "allow" }] }),
      }),
    )
    if (options.noHostRetry) {
      await mkdir(join(config, "plugins"), { recursive: true })
      await symlink(join(REPO, "host", "harness", "no-host-retry"), join(config, "plugins", "no-host-retry"))
    }
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      HOME: join(root, "home"),
      XDG_CONFIG_HOME: join(root, "config"),
      XDG_DATA_HOME: join(root, "data"),
      XDG_CACHE_HOME: join(root, "cache"),
      XDG_STATE_HOME: join(root, "state"),
      OPENCODE_SERVER_PASSWORD: PASSWORD,
      OPENCODE_DISABLE_AUTOUPDATE: "1",
      OPENCODE_DISABLE_MODELS_FETCH: "1",
      ...options.env,
    }
    delete env.BUN_BE_BUN
    const port = freePort()
    const logs: string[] = []
    const logOffset = Host.logSize(env)
    const host = new Host(
      root,
      project,
      fixture,
      model,
      `http://127.0.0.1:${port}`,
      env,
      Host.spawn(env, project, port, logs),
      logs,
      logOffset,
    )
    try {
      await host.ready()
    } catch (error) {
      await host.stop()
      throw error
    }
    return host
  }

  private static spawn(env: Record<string, string>, project: string, port: number, logs: string[]) {
    const child = Bun.spawn([process.env.OPENCODE_BIN ?? "opencode", "serve", "--hostname", "127.0.0.1", "--port", String(port)], {
      cwd: project,
      env,
      stdout: "pipe",
      stderr: "pipe",
    })
    for (const stream of [child.stdout, child.stderr]) {
      void (async () => {
        for await (const chunk of stream) logs.push(new TextDecoder().decode(chunk))
      })()
    }
    return child
  }

  private async ready() {
    for (let attempt = 0; attempt < 300; attempt++) {
      if (this.process.exitCode !== null) throw new Error(`opencode serve exited:\n${this.logs.join("")}`)
      try {
        const response = await this.request("GET", "/api/info")
        if (response.ok) break
      } catch {}
      await sleep(100)
    }
    for (let attempt = 0; attempt < 1_800; attempt++) {
      if (this.process.exitCode !== null) throw new Error(`opencode serve exited:\n${this.logs.join("")}`)
      const log = (await readFile(join(this.env.XDG_DATA_HOME!, "opencode", "log", "opencode.log")).catch(() => null)) ?? Buffer.alloc(0)
      const logs = this.logs.join("") + log.subarray(this.logOffset).toString("utf8")
      if (logs.includes("failed to load plugin")) throw new PluginInstallError(`opencode serve failed to load a plugin:\n${logs}`)
      const commands = (await this.json("GET", `/api/command?location[directory]=${encodeURIComponent(this.project)}`)) as {
        data?: { name: string }[]
      }
      if (commands.data?.some((command) => command.name === "goal")) return
      await sleep(100)
    }
    throw new Error(`the goal plugin never registered /goal:\n${this.logs.join("")}`)
  }

  private request(method: string, path: string, body?: unknown) {
    return fetch(this.base + path, {
      method,
      headers: {
        authorization: `Basic ${btoa(`opencode:${PASSWORD}`)}`,
        "x-opencode-directory": this.project,
        ...(body !== undefined && { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      timeout: false,
    } as RequestInit)
  }

  async json(method: string, path: string, body?: unknown): Promise<unknown> {
    const response = await this.request(method, path, body)
    const text = await response.text()
    if (!response.ok) throw new Error(`${method} ${path} -> ${response.status}: ${text}`)
    return text ? JSON.parse(text) : undefined
  }

  async session(agent = "build"): Promise<Session> {
    const created = (await this.json("POST", "/api/session", {
      agent,
      model: this.model,
      location: { directory: this.project },
    })) as { id?: string; data?: { id: string } }
    return { id: created.id ?? created.data!.id }
  }

  async rpc(method: string, input: unknown): Promise<unknown> {
    const query = `location[directory]=${encodeURIComponent(this.project)}`
    const result = (await this.json("POST", `/api/rpc/goal/${method}?${query}`, { input })) as { output?: unknown }
    return result.output
  }

  events(filter: (type: string) => boolean): { readonly seen: { type: string; data: unknown }[]; stop(): void } {
    const seen: { type: string; data: unknown }[] = []
    const controller = new AbortController()
    void (async () => {
      const response = await fetch(this.base + "/api/event", {
        headers: { authorization: `Basic ${btoa(`opencode:${PASSWORD}`)}`, accept: "text/event-stream" },
        signal: controller.signal,
        timeout: false,
      } as RequestInit)
      let buffer = ""
      for await (const chunk of response.body!) {
        buffer += new TextDecoder().decode(chunk)
        let end: number
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, end)
          buffer = buffer.slice(end + 2)
          const line = frame.split("\n").find((item) => item.startsWith("data:"))
          if (!line) continue
          const event = JSON.parse(line.slice(5)) as { type: string; data: unknown }
          if (filter(event.type)) seen.push(event)
        }
      }
    })().catch(() => {})
    return { seen, stop: () => controller.abort() }
  }

  goal(session: Session, text: string) {
    return this.json("POST", `/api/session/${session.id}/command`, { name: "goal", text })
  }

  prompt(session: Session, text: string) {
    return this.json("POST", `/api/session/${session.id}/prompt`, { text })
  }

  interrupt(session: Session) {
    return this.json("POST", `/api/session/${session.id}/interrupt`)
  }

  remove(session: Session) {
    return this.json("DELETE", `/api/session/${session.id}`)
  }

  async messages(session: Session): Promise<Message[]> {
    const page = (await this.json("GET", `/api/session/${session.id}/message?limit=200&order=asc`)) as { data: Message[] }
    return page.data
  }

  async inbox(session: Session): Promise<string[]> {
    const page = (await this.json("GET", `/api/session/${session.id}/inbox`)) as { data: { payload: { text?: string } }[] }
    return page.data.map((item) => item.payload.text ?? "")
  }

  async settle(session: Session, quietMs = 1_500, timeoutMs = 60_000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      await this.json("POST", `/api/experimental/session/${session.id}/wait`)
      const seen = this.fixture.requests.length
      await sleep(quietMs)
      if (this.fixture.requests.length === seen) return
    }
    throw new Error(`session ${session.id} did not settle within ${timeoutMs} ms`)
  }

  async settleLive(session: Session, quietMs = 4_000, timeoutMs = 600_000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      await this.json("POST", `/api/experimental/session/${session.id}/wait`)
      const seen = (await this.messages(session)).length
      await sleep(quietMs)
      const messages = await this.messages(session)
      if (messages.length === seen && messages.at(-1)?.type === "idle") return
    }
    throw new Error(`session ${session.id} did not settle within ${timeoutMs} ms`)
  }

  until = async (check: () => boolean | Promise<boolean>, timeoutMs = 30_000) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (await check()) return
      await sleep(100)
    }
    throw new Error("condition not reached in time")
  }

  stored(session: Session): Goal | undefined {
    const db = new Database(join(this.root, "data", "opencode", "opencode.db"), { readonly: true })
    try {
      const row = db.query("select value from kv where key like ?").get(`plugin:%:goal/${session.id}`) as { value: string } | null
      return row ? (JSON.parse(row.value) as Goal) : undefined
    } finally {
      db.close()
    }
  }

  async restart() {
    this.process.kill()
    await this.process.exited
    const port = Number(new URL(this.base).port)
    this.logOffset = Host.logSize(this.env)
    this.process = Host.spawn(this.env, this.project, port, this.logs)
    await this.ready()
  }

  log = () => this.logs.join("")

  async stop() {
    this.process.kill()
    await this.process.exited
    this.fixture.stop()
    if (!process.env.GOAL_HOST_KEEP) await rm(this.root, { recursive: true, force: true })
  }
}
