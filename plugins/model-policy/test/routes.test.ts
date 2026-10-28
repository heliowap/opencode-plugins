import { expect, test } from "bun:test"
import { isBlockedModel, userOnlyMessage } from "../src/routes.ts"

type Model = { providerID: string; id: string; family?: string }

const surviving = (catalog: Model[]) =>
  catalog.filter((model) => !isBlockedModel(model)).map((model) => `${model.providerID}/${model.id}`)

test("Anthropic API keeps only Sonnet 5.5 and Haiku 5.5 among Claude models", () => {
  expect(
    surviving([
      { providerID: "anthropic", id: "claude-sonnet-5-5", family: "claude-sonnet" },
      { providerID: "anthropic", id: "claude-haiku-5-5", family: "claude-haiku" },
      { providerID: "anthropic", id: "claude-opus-5-5", family: "claude-opus" },
      { providerID: "openrouter", id: "anthropic/claude-sonnet-5-5", family: "claude-sonnet" },
      { providerID: "cli_proxy", id: "cpa-claude-opus-5-5", family: "claude-opus" },
    ]),
  ).toEqual(["anthropic/claude-sonnet-5-5", "anthropic/claude-haiku-5-5", "cli_proxy/cpa-claude-opus-5-5"])
})

test("OpenAI family models stay on the approved providers and go elsewhere", () => {
  expect(
    surviving([
      { providerID: "openai", id: "gpt-6.1-sol", family: "gpt-sol" },
      { providerID: "opencode-go", id: "gpt-6.1-sol", family: "gpt-sol" },
      { providerID: "cli_proxy_openai", id: "gpt-6.1-sol", family: "gpt-sol" },
      { providerID: "azure", id: "gpt-6.1-sol", family: "gpt-sol" },
      { providerID: "openrouter", id: "~openai/gpt-latest" },
      { providerID: "openrouter", id: "mistralai/mistral-large-4-0", family: "mistral-large" },
    ]),
  ).toEqual([
    "openai/gpt-6.1-sol",
    "opencode-go/gpt-6.1-sol",
    "cli_proxy_openai/gpt-6.1-sol",
    "openrouter/mistralai/mistral-large-4-0",
  ])
})

test("agents cannot dispatch a subagent on an Anthropic API model", () => {
  expect(userOnlyMessage({ agent: "general", model: "anthropic/claude-sonnet-5-5#high" })).toContain(
    "anthropic/claude-sonnet-5-5#high is user-only",
  )
})

test("the block ignores surrounding whitespace and letter case in the model reference", () => {
  expect(userOnlyMessage({ agent: "general", model: " Anthropic/claude-haiku-5-5" })).toContain("is user-only")
})

test("agents can dispatch subagents on other providers or without a model", () => {
  expect(userOnlyMessage({ agent: "general", model: "cli_proxy/cpa-claude-opus-5-5#low" })).toBeUndefined()
  expect(userOnlyMessage({ agent: "general" })).toBeUndefined()
  expect(userOnlyMessage(undefined)).toBeUndefined()
  expect(userOnlyMessage({ model: 5 })).toBeUndefined()
})

test("an input without an agent that names an Anthropic API model is still blocked", () => {
  expect(userOnlyMessage({ model: "anthropic/claude-sonnet-5-5" })).toContain("is user-only")
})
