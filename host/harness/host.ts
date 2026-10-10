import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { OPUS, startFixture, type Fixture, type Script } from "./fixture.ts"

const REPO = resolve(import.meta.dir, "../..")
const PASSWORD = "fixture-password"
const EFFORTS = ["low", "medium", "high"].map((id) => ({ id, settings: { reasoningEffort: id } }))

export const ROUTE_PROVIDERS = {
  openai: { "gpt-6.1-sol": EFFORTS },
  cli_proxy_openai: { "gpt-6.1-sol": EFFORTS },
  cli_proxy: { "cpa-claude-sonnet-5-5": EFFORTS, "cpa-claude-opus-5-5": EFFORTS },
} as const

export interface HostOptions {
  readonly script: Script
  readonly pluginDir?: string
  readonly omit?: readonly string[]
  readonly extraPlugins?: readonly string[]
  readonly configFiles?: Readonly<Record<string, string>>
  readonly projectFiles?: Readonly<Record<string, string>>
  readonly permissions?: (configDir: string) => ReadonlyArray<{ readonly action: string; readonly resource: string; readonly effect: string }>
}

export interface Session {
  readonly id: string
}

export type Message = { readonly type: string } & Record<string, unknown>

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))

const freePort = () => {
  const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() })
  const port = probe.port!
  probe.stop(true)
  return port
}

const provider = (fixture: Fixture, id: string, models: Record<string, readonly object[]>) => ({
  name: id,
  package: "@opencode/ai/providers/openai-compatible",
  settings: { baseURL: fixture.baseURL(id), apiKey: "fixture" },
  models: Object.fromEntries(
    Object.entries(models).map(([model, variants]) => [model, { name: model, capabilities: { tools: true }, variants }]),
  ),
})

export class Host {
  private constructor(
    readonly root: string,
    readonly project: string,
    readonly fixture: Fixture,
    readonly base: string,
    private readonly process: ReturnType<typeof Bun.spawn>,
    private readonly logs: string[],
  ) {}

  static async start(options: HostOptions): Promise<Host> {
    const root = await mkdtemp(join(tmpdir(), "model-policy-host-"))
    const project = join(root, "project")
    const config = join(root, "config", "opencode")
    for (const dir of [project, join(config, "plugins"), ...["home", "data", "cache", "state"].map((d) => join(root, d))]) {
      await mkdir(dir, { recursive: true })
    }
    const fixture = startFixture(options.script)
    const omitted = (key: string) => options.omit?.includes(key) ?? false
    const routes = Object.entries(ROUTE_PROVIDERS)
      .filter(([id]) => !omitted(id))
      .map(([id, models]) => [id, Object.fromEntries(Object.entries(models).filter(([model]) => !omitted(`${id}/${model}`)))] as const)
    await writeFile(
      join(config, "opencode.jsonc"),
      JSON.stringify({
        model: "fixture/test",
        providers: {
          fixture: provider(fixture, "fixture", { test: [] }),
          ...Object.fromEntries(routes.map(([id, models]) => [id, provider(fixture, id, models)])),
        },
        agents: {
          researcher: { mode: "subagent", description: "Fixture researcher", model: "fixture/test" },
          implementer: { mode: "subagent", description: "Fixture implementer" },
          planner: { mode: "subagent", description: "Fixture planner", model: `${OPUS}#medium` },
        },
        permissions: [{ action: "*", resource: "*", effect: "allow" }, ...(options.permissions?.(config) ?? [])],
      }),
    )
    await symlink(options.pluginDir ?? join(REPO, "src"), join(config, "plugins", "model-policy"))
    for (const plugin of options.extraPlugins ?? []) await symlink(plugin, join(config, "plugins", basename(plugin)))
    for (const [base, files] of [[config, options.configFiles], [project, options.projectFiles]] as const) {
      for (const [path, content] of Object.entries(files ?? {})) {
        await mkdir(dirname(join(base, path)), { recursive: true })
        await writeFile(join(base, path), content)
      }
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
    }
    delete env.BUN_BE_BUN
    const port = freePort()
    const logs: string[] = []
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
    const host = new Host(root, project, fixture, `http://127.0.0.1:${port}`, child, logs)
    await host.ready()
    return host
  }

  private async ready() {
    for (let attempt = 0; attempt < 600; attempt++) {
      if (this.process.exitCode !== null) throw new Error(`opencode serve exited:\n${this.log()}`)
      try {
        const plugins = (await this.json("GET", `/api/plugin?location[directory]=${encodeURIComponent(this.project)}`)) as {
          data?: { id?: string; source: { type: string; path?: string }; state: { status: string; error?: string } }[]
        }
        const ours = plugins.data?.find((plugin) => plugin.source.type === "local" && plugin.source.path?.includes("model-policy"))
        if (ours?.state.status === "failed") throw new Error(`plugin failed: ${ours.state.error}`)
        if (ours?.state.status === "active") return
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("plugin failed")) throw error
      }
      await sleep(100)
    }
    throw new Error(`the model-policy plugin never became active:\n${this.log()}`)
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

  get configDir() {
    return join(this.root, "config", "opencode")
  }

  async session(agent = "build", directory = this.project): Promise<Session> {
    const created = (await this.json("POST", "/api/session", {
      agent,
      model: { providerID: "fixture", id: "test" },
      location: { directory },
    })) as { id?: string; data?: { id: string } }
    return { id: created.id ?? created.data!.id }
  }

  prompt(session: Session, text: string) {
    return this.json("POST", `/api/session/${session.id}/prompt`, { text })
  }

  command(session: Session, name: string, text: string) {
    return this.json("POST", `/api/session/${session.id}/command`, { name, text })
  }

  interrupt(session: Session) {
    return this.json("POST", `/api/session/${session.id}/interrupt`)
  }

  async messages(session: Session): Promise<Message[]> {
    const page = (await this.json("GET", `/api/session/${session.id}/message?limit=200&order=asc`)) as { data: Message[] }
    return page.data
  }

  async children(session: Session): Promise<{ id: string; model?: { providerID: string; id: string; variant?: string } }[]> {
    const page = (await this.json("GET", `/api/session?parentID=${session.id}`)) as {
      data: { id: string; model?: { providerID: string; id: string; variant?: string } }[]
    }
    return page.data
  }

  async settle(session: Session, quietMs = 1_500, timeoutMs = 90_000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      await this.json("POST", `/api/experimental/session/${session.id}/wait`)
      const seen = this.fixture.calls.length
      await sleep(quietMs)
      if (this.fixture.calls.length === seen) return
    }
    throw new Error(`session ${session.id} did not settle within ${timeoutMs} ms`)
  }

  until = async (check: () => boolean | Promise<boolean>, timeoutMs = 60_000) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (await check()) return
      await sleep(100)
    }
    throw new Error("condition not reached in time")
  }

  log = () => this.logs.join("")

  async stop() {
    this.process.kill()
    await this.process.exited
    this.fixture.stop()
    if (!process.env.MODEL_POLICY_HOST_KEEP) await rm(this.root, { recursive: true, force: true })
  }
}
