import { expect, test } from "bun:test"
import plugin from "../src/index.ts"

// Runs setup against a recording host; see src/index.ts for why no transform is allowed.
test("setup registers the execute.before hook and no tool transform", async () => {
  const calls: string[] = []
  const ctx = {
    tool: {
      transform: () => {
        calls.push("transform")
        return Promise.resolve({ dispose: async () => {} })
      },
      hook: (name: string) => {
        calls.push(`hook ${name}`)
        return Promise.resolve({ dispose: async () => {} })
      },
    },
  }
  await plugin.setup(ctx as never)
  expect(calls).toEqual(["hook execute.before"])
})
