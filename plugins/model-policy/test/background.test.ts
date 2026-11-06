import { expect, test } from "bun:test"
import { inputFor, requestsBackground, toolsFor } from "../src/background.ts"

const CHILD = { parentID: "ses_parent" }
const TOP = {}

const schema = (properties: Record<string, unknown>) => ({ type: "object", properties, required: ["command"], additionalProperties: false })

const TOOLS = {
  shell: { description: "Run a command", input: schema({ command: { type: "string" }, background: { type: "boolean" } }) },
  subagent: { description: "Spawn an agent", input: schema({ agent: { type: "string" }, background: { type: "boolean" } }) },
  webfetch: { description: "Fetch a URL", input: schema({ url: { type: "string" }, background: { type: "boolean" } }) },
}

test("a child session sees shell and subagent without the background option", () => {
  expect(toolsFor(CHILD, TOOLS)).toEqual({
    shell: { description: "Run a command", input: schema({ command: { type: "string" } }) },
    subagent: { description: "Spawn an agent", input: schema({ agent: { type: "string" } }) },
    webfetch: { description: "Fetch a URL", input: schema({ url: { type: "string" }, background: { type: "boolean" } }) },
  })
})

test("a top-level session keeps the background option on every tool", () => {
  expect(toolsFor(TOP, TOOLS)).toEqual({
    shell: { description: "Run a command", input: schema({ command: { type: "string" }, background: { type: "boolean" } }) },
    subagent: { description: "Spawn an agent", input: schema({ agent: { type: "string" }, background: { type: "boolean" } }) },
    webfetch: { description: "Fetch a URL", input: schema({ url: { type: "string" }, background: { type: "boolean" } }) },
  })
})

test("only a shell or subagent call with background true requests the background", () => {
  expect(requestsBackground("shell", { command: "bun test", background: true })).toBe(true)
  expect(requestsBackground("subagent", { agent: "general", background: true })).toBe(true)
  expect(requestsBackground("shell", { command: "bun test", background: false })).toBe(false)
  expect(requestsBackground("subagent", { agent: "general" })).toBe(false)
  expect(requestsBackground("webfetch", { url: "https://example.com", background: true })).toBe(false)
  expect(requestsBackground("shell", "bun test")).toBe(false)
})

test("a background call from a child session runs in the foreground with its other arguments intact", () => {
  expect(inputFor(CHILD, { command: "bun test", workdir: "/repo", background: true })).toEqual({
    command: "bun test",
    workdir: "/repo",
  })
})

test("a background call from a top-level session stays in the background", () => {
  expect(inputFor(TOP, { command: "bun test", background: true })).toEqual({ command: "bun test", background: true })
})

test("a session whose parentID is null counts as top-level", () => {
  expect(inputFor({ parentID: null }, { command: "bun test", background: true })).toEqual({ command: "bun test", background: true })
  expect(inputFor(CHILD, { command: "bun test", background: true })).toEqual({ command: "bun test" })
})
