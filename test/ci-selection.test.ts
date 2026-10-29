import { describe, expect, test } from "bun:test"
import { goalMutation, goalRuntime, selectPlugins } from "../scripts/ci-matrix.ts"

const all = ["base-check", "goal", "tps-meter"]

describe("selectPlugins docs rules", () => {
  test("markdown under a plugin selects nothing", () => {
    expect(selectPlugins(["plugins/goal/README.md", "plugins/goal/CODING_STANDARDS.md", "plugins/goal/docs/a/b.md"], all)).toEqual([])
  })

  test("anything under plugins/<n>/docs/ is a doc, even non-markdown", () => {
    expect(selectPlugins(["plugins/goal/docs/diagram.png"], all)).toEqual([])
  })

  test("root markdown and docs/ select nothing", () => {
    expect(selectPlugins(["README.md", "AGENTS.md", "CODING_STANDARDS.md", "docs/x.md", "docs/img.png"], all)).toEqual([])
  })

  test("a source change next to a doc change still selects the plugin", () => {
    expect(selectPlugins(["plugins/goal/README.md", "plugins/goal/src/a.ts", "plugins/tps-meter/README.md"], all)).toEqual(["goal"])
  })

  test("markdown under templates/ is runtime, not a doc", () => {
    expect(selectPlugins(["plugins/goal/templates/continuation.md"], all)).toEqual(["goal"])
  })

  test("workflow and ci-matrix changes still select everything", () => {
    expect(selectPlugins([".github/workflows/ci.yml"], all)).toEqual(all)
    expect(selectPlugins(["scripts/ci-matrix.ts"], all)).toEqual(all)
  })
})

describe("goalRuntime", () => {
  test.each([
    "plugins/goal/src/a.ts",
    "plugins/goal/host/lifecycle.test.ts",
    "plugins/goal/templates/continuation.md",
    "plugins/goal/test/a.test.ts",
    "plugins/goal/scripts/report.ts",
    "plugins/goal/package.json",
    "plugins/goal/bun.lock",
    "plugins/goal/bunfig.toml",
    "plugins/goal/tsconfig.json",
    "plugins/goal/stryker.config.json",
  ])("%s triggers", (path) => {
    expect(goalRuntime([path])).toBe(true)
  })

  test.each([
    "plugins/goal/README.md",
    "plugins/goal/CODING_STANDARDS.md",
    "plugins/goal/AGENTS.md",
    "plugins/goal/docs/a.md",
    "plugins/goal/LICENSE",
    "plugins/goal/NOTICE",
    "plugins/tps-meter/src/a.ts",
    "README.md",
  ])("%s does not trigger", (path) => {
    expect(goalRuntime([path])).toBe(false)
  })

  test("workflow changes keep exercising the goal host suites", () => {
    expect(goalRuntime([".github/workflows/ci.yml"])).toBe(true)
  })

  test("one runtime path among docs triggers", () => {
    expect(goalRuntime(["plugins/goal/README.md", "plugins/goal/src/a.ts"])).toBe(true)
  })

  test("a markdown file inside src/ does not hide a runtime change", () => {
    expect(goalRuntime(["plugins/goal/src/NOTES.md"])).toBe(true)
  })
})

describe("goalMutation", () => {
  test("src changes trigger", () => {
    expect(goalMutation(["plugins/goal/src/a.ts"])).toBe(true)
  })

  test.each([
    "plugins/goal/test/a.test.ts",
    "plugins/goal/host/a.test.ts",
    "plugins/goal/package.json",
    "plugins/goal/README.md",
    "plugins/tps-meter/src/a.ts",
  ])("%s does not trigger", (path) => {
    expect(goalMutation([path])).toBe(false)
  })
})
