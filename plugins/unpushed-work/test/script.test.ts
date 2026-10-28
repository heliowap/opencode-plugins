import { expect, test } from "bun:test"
import { accessSync, constants } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { SCRIPT } from "../src/script"

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..")

test("SCRIPT resolves to bin/unpushed-work inside the package", () => {
  expect(SCRIPT).toBe(join(pkg, "bin", "unpushed-work"))
})

test("SCRIPT is executable", () => {
  expect(() => accessSync(SCRIPT, constants.X_OK)).not.toThrow()
})
