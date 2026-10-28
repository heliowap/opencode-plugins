import { describe, expect, test } from "bun:test"
import { classify } from "../src/failure.ts"

describe("provider failures switch to the next route", () => {
  test.each([
    ["provider.rate-limit", true],
    ["provider.quota", true],
    ["provider.auth", false],
    ["provider.no-route", false],
    ["provider.unknown", false],
    ["provider.internal", false],
    ["provider.transport", false],
    ["provider.timeout", false],
    ["provider.unsupported-operation", false],
    ["provider.invalid-output", false],
  ])("%s", (type, skipSameRouteRetries) => {
    expect(classify({ type })).toEqual({ kind: "route", skipSameRouteRetries })
  })
})

describe("task failures stay on the route", () => {
  test.each(["provider.content-filter", "provider.invalid-request", "tool.execution", "permission.rejected", "unknown", ""])(
    "%s",
    (type) => {
      expect(classify({ type })).toEqual({ kind: "task" })
    },
  )
})
