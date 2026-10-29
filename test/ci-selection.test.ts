import { describe, expect, test } from "bun:test"
import { goalMutation, goalRuntime, parsePackageJson, rootChanged, selectPlugins } from "../scripts/ci-matrix.ts"

const all = ["base-check", "goal", "tps-meter"]

describe("selectPlugins docs rules", () => {
  test("markdown under a plugin selects nothing, a sibling source file does", () => {
    const docs = ["plugins/goal/README.md", "plugins/goal/CODING_STANDARDS.md", "plugins/goal/docs/a/b.md"]
    expect(selectPlugins(docs, all)).toEqual([])
    expect(selectPlugins([...docs, "plugins/tps-meter/src/a.ts"], all)).toEqual(["tps-meter"])
  })

  test("anything under plugins/<n>/docs/ is a doc, even non-markdown", () => {
    expect(selectPlugins(["plugins/goal/docs/diagram.png"], all)).toEqual([])
    expect(selectPlugins(["plugins/goal/diagram.png"], all)).toEqual(["goal"])
  })

  test("root markdown and docs/ select nothing, root code selects no plugin either", () => {
    const docs = ["README.md", "AGENTS.md", "CODING_STANDARDS.md", "docs/x.md", "docs/img.png"]
    expect(selectPlugins(docs, all)).toEqual([])
    expect(selectPlugins([...docs, "plugins/goal/package.json"], all)).toEqual(["goal"])
  })

  test("a source change next to a doc change still selects the plugin", () => {
    expect(selectPlugins(["plugins/goal/README.md", "plugins/goal/src/a.ts", "plugins/tps-meter/README.md"], all)).toEqual(["goal"])
  })

  test.each(["templates", "src", "host", "test", "scripts"])("markdown under %s/ is runtime, not a doc", (dir) => {
    expect(selectPlugins([`plugins/goal/${dir}/NOTES.md`], all)).toEqual(["goal"])
  })

  test("workflow and ci-matrix changes still select every plugin", () => {
    expect(selectPlugins([".github/workflows/ci.yml"], all)).toEqual(all)
    expect(selectPlugins(["scripts/ci-matrix.ts"], all)).toEqual(all)
    expect(selectPlugins(["scripts/check.ts"], all)).toEqual([])
  })
})

describe("goalRuntime", () => {
  const runtimeSibling = "plugins/goal/src/a.ts"

  test.each([
    "plugins/goal/src/a.ts",
    "plugins/goal/src/NOTES.md",
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
  ])("%s does not trigger, a runtime sibling does", (path) => {
    expect(goalRuntime([path])).toBe(false)
    expect(goalRuntime([path, runtimeSibling])).toBe(true)
  })

  test("workflow changes keep exercising the goal host suites", () => {
    expect(goalRuntime([".github/workflows/ci.yml"])).toBe(true)
  })
})

describe("goalMutation", () => {
  test.each(["plugins/goal/src/a.ts", "plugins/goal/src/NOTES.md"])("%s triggers", (path) => {
    expect(goalMutation([path])).toBe(true)
  })

  test.each([
    "plugins/goal/test/a.test.ts",
    "plugins/goal/host/a.test.ts",
    "plugins/goal/package.json",
    "plugins/goal/README.md",
    "plugins/tps-meter/src/a.ts",
    ".github/workflows/ci.yml",
  ])("%s does not trigger, a src sibling does", (path) => {
    expect(goalMutation([path])).toBe(false)
    expect(goalMutation([path, "plugins/goal/src/a.ts"])).toBe(true)
  })
})

describe("rootChanged", () => {
  test.each([
    "install.ts",
    "scripts/check.ts",
    "scripts/lint-repo.ts",
    "test/check.test.ts",
    "package.json",
    "bun.lock",
    "tsconfig.json",
    ".github/workflows/ci.yml",
  ])("%s triggers the root checks", (path) => {
    expect(rootChanged([path])).toBe(true)
  })

  test.each(["README.md", "AGENTS.md", "docs/a.md", "plugins/goal/src/a.ts", "plugins/goal/package.json", "evidence/a.txt"])(
    "%s does not, a root code sibling does",
    (path) => {
      expect(rootChanged([path])).toBe(false)
      expect(rootChanged([path, "install.ts"])).toBe(true)
    },
  )
})

describe("parsePackageJson", () => {
  test("reads the scripts", () => {
    expect(parsePackageJson('{"name":"a","scripts":{"test":"bun test","typecheck":"tsgo"}}')).toEqual({
      scripts: { test: "bun test", typecheck: "tsgo" },
    })
  })

  test("a missing scripts field is an empty record", () => {
    expect(parsePackageJson('{"name":"a"}')).toEqual({ scripts: {} })
  })

  test.each(['[]', 'null', '"x"', '{"scripts":[]}', '{"scripts":{"test":1}}', '{"scripts":null}'])("%s has the wrong shape", (text) => {
    expect(parsePackageJson(text)).toBeUndefined()
    expect(parsePackageJson('{"scripts":{"test":"x"}}')).toEqual({ scripts: { test: "x" } })
  })
})
