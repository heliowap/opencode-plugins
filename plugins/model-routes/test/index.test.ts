import { expect, test } from "bun:test"
import plugin from "../src/index"

type Model = { providerID: string; id: string; family?: string }
type ToolEvent = { tool: string; input: unknown }

const setupPlugin = async (catalog: Model[] = []) => {
  let models = [...catalog]
  const editor = {
    list: () => models,
    remove: (providerID: string, id: string) => {
      models = models.filter((model) => !(model.providerID === providerID && model.id === id))
    },
  }
  const hooks = new Map<string, (event: ToolEvent) => Promise<void> | void>()
  const ctx = {
    model: { transform: async (fn: (e: typeof editor) => void) => fn(editor) },
    tool: { hook: async (name: string, fn: (event: ToolEvent) => Promise<void> | void) => void hooks.set(name, fn) },
  }
  await plugin.setup(ctx as never)
  return {
    catalog: () => models.map((model) => `${model.providerID}/${model.id}`),
    beforeTool: async (event: ToolEvent) => hooks.get("execute.before")?.(event),
  }
}

test("Anthropic API keeps only Sonnet 5.5 and Haiku 5.5 among Claude models", async () => {
  const routes = await setupPlugin([
    { providerID: "anthropic", id: "claude-sonnet-5-5", family: "claude-sonnet" },
    { providerID: "anthropic", id: "claude-haiku-5-5", family: "claude-haiku" },
    { providerID: "anthropic", id: "claude-opus-5-5", family: "claude-opus" },
    { providerID: "openrouter", id: "anthropic/claude-sonnet-5-5", family: "claude-sonnet" },
    { providerID: "cli_proxy", id: "cpa-claude-opus-5-5", family: "claude-opus" },
  ])

  expect(routes.catalog()).toEqual([
    "anthropic/claude-sonnet-5-5",
    "anthropic/claude-haiku-5-5",
    "cli_proxy/cpa-claude-opus-5-5",
  ])
})

test("agents cannot dispatch a subagent on an Anthropic API model", async () => {
  const routes = await setupPlugin()

  await expect(
    routes.beforeTool({ tool: "subagent", input: { agent: "general", model: "anthropic/claude-sonnet-5-5#high" } }),
  ).rejects.toThrow("anthropic/claude-sonnet-5-5#high")
})

test("the block ignores surrounding whitespace and letter case in the model reference", async () => {
  const routes = await setupPlugin()

  await expect(
    routes.beforeTool({ tool: "subagent", input: { agent: "general", model: " Anthropic/claude-haiku-5-5" } }),
  ).rejects.toThrow("is user-only")
})

test("agents can dispatch subagents on other providers or without a model", async () => {
  const routes = await setupPlugin()

  await expect(
    routes.beforeTool({ tool: "subagent", input: { agent: "general", model: "cli_proxy/cpa-claude-opus-5-5#low" } }),
  ).resolves.toBeUndefined()
  await expect(routes.beforeTool({ tool: "subagent", input: { agent: "general" } })).resolves.toBeUndefined()
})
