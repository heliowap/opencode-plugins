import { expect, test } from "bun:test"
import plugin from "../src/index"

type Model = { providerID: string; id: string; family?: string }

const catalogAfterTransform = async (catalog: Model[]) => {
  let models = [...catalog]
  const editor = {
    list: () => models,
    remove: (providerID: string, id: string) => {
      models = models.filter((model) => !(model.providerID === providerID && model.id === id))
    },
  }
  const ctx = { model: { transform: async (fn: (e: typeof editor) => void) => fn(editor) } }
  await plugin.setup(ctx as never)
  return models.map((model) => `${model.providerID}/${model.id}`)
}

test("Anthropic API keeps only Sonnet 5.5 and Haiku 5.5 among Claude models", async () => {
  const remaining = await catalogAfterTransform([
    { providerID: "anthropic", id: "claude-sonnet-5-5", family: "claude-sonnet" },
    { providerID: "anthropic", id: "claude-haiku-5-5", family: "claude-haiku" },
    { providerID: "anthropic", id: "claude-opus-5-5", family: "claude-opus" },
    { providerID: "openrouter", id: "anthropic/claude-sonnet-5-5", family: "claude-sonnet" },
    { providerID: "cli_proxy", id: "cpa-claude-opus-5-5", family: "claude-opus" },
  ])

  expect(remaining).toEqual([
    "anthropic/claude-sonnet-5-5",
    "anthropic/claude-haiku-5-5",
    "cli_proxy/cpa-claude-opus-5-5",
  ])
})
