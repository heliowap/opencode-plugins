import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createMasker } from "../src/redact.ts"
import { findPlaceholder, restoreInput, targetPaths } from "../src/restore.ts"

const KEY = "redact-secrets test key"
const SECRET = "super-secret-value-123"
const PLACEHOLDER = "[REDACTED:5da9a1cb]"

const dir = mkdtempSync(join(tmpdir(), "redact-restore-"))
const file = join(dir, "note.txt")
const ORIGINAL = "first line\nSECRET_TOKEN=super-secret-value-123\nthird line\n"
writeFileSync(file, ORIGINAL)

const masker = createMasker({ secrets: [SECRET], key: KEY })
const read = (path: string) => {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return undefined
  }
}
// The file-contains check the adapter builds from the input's target paths.
const contains = (tool: string, input: unknown) => (text: string) =>
  targetPaths(tool, input).some((path) => read(resolve(dir, path))?.includes(text) ?? false)

test("an edit copying a masked line as context is restored, and the file keeps the secret", () => {
  const masked = masker.redactText(readFileSync(file, "utf8"))
  expect(masked).toBe(`first line\nSECRET_TOKEN=${PLACEHOLDER}\nthird line\n`)
  const input = {
    path: file,
    oldString: `SECRET_TOKEN=${PLACEHOLDER}\nthird line`,
    newString: `SECRET_TOKEN=${PLACEHOLDER}\nchanged line`,
  }
  const result = restoreInput(input, masker.lookup, contains("edit", input))
  expect(result).toEqual({
    ok: true,
    input: {
      path: file,
      oldString: "SECRET_TOKEN=super-secret-value-123\nthird line",
      newString: "SECRET_TOKEN=super-secret-value-123\nchanged line",
    },
  })
  if (!result.ok) return
  const applied = result.input as typeof input
  writeFileSync(file, readFileSync(file, "utf8").replace(applied.oldString, applied.newString))
  expect(readFileSync(file, "utf8")).toBe("first line\nSECRET_TOKEN=super-secret-value-123\nchanged line\n")
})

test("a write whose content has [REDACTED] for a file that lacks it is rejected", () => {
  const target = join(dir, "new.txt")
  const input = { path: target, content: "API_KEY=[REDACTED]\n" }
  const result = restoreInput(input, masker.lookup, contains("write", input))
  expect(result).toEqual({
    ok: false,
    message:
      'Edit input contains the placeholder "[REDACTED]", which cannot be resolved. Re-read the lines you want to change and write the edit again without the placeholder.',
  })
})

test("a placeholder with an unknown id is rejected the same way", () => {
  const input = { path: file, oldString: "SECRET_TOKEN=[REDACTED:deadbeef]", newString: "x" }
  const result = restoreInput(input, masker.lookup, contains("edit", input))
  expect(result).toEqual({
    ok: false,
    message:
      'Edit input contains the placeholder "[REDACTED:deadbeef]", which cannot be resolved. Re-read the lines you want to change and write the edit again without the placeholder.',
  })
})

test("a placeholder that the target file already contains is left as a literal", () => {
  const legacy = join(dir, "legacy.txt")
  writeFileSync(legacy, "API_KEY=[REDACTED] and [REDACTED:deadbeef]\n")
  const input = { path: legacy, content: "kept: [REDACTED] and [REDACTED:deadbeef]\n" }
  const result = restoreInput(input, masker.lookup, contains("write", input))
  expect(result).toEqual({ ok: true, input: { path: legacy, content: "kept: [REDACTED] and [REDACTED:deadbeef]\n" } })
})

test("patch paths come from the patch headers", () => {
  const input = {
    patchText:
      "*** Begin Patch\n*** Update File: note.txt\n*** Move to: renamed.txt\n*** Add File: extra.md\n*** Delete File: old.ts\n*** End Patch\n",
  }
  expect(targetPaths("patch", input)).toEqual(["note.txt", "renamed.txt", "extra.md", "old.ts"])
})

test("a patch input has known placeholders restored in the patch text", () => {
  const input = {
    patchText: `*** Begin Patch\n*** Update File: note.txt\n@@\n-SECRET_TOKEN=${PLACEHOLDER}\n+SECRET_TOKEN=${PLACEHOLDER} suffix\n*** End Patch\n`,
  }
  const result = restoreInput(input, masker.lookup, contains("patch", input))
  expect(result).toEqual({
    ok: true,
    input: {
      patchText: `*** Begin Patch\n*** Update File: note.txt\n@@\n-SECRET_TOKEN=${SECRET}\n+SECRET_TOKEN=${SECRET} suffix\n*** End Patch\n`,
    },
  })
})

test("the same value always gets the same id within a masker", () => {
  expect(masker.redactText(`a ${SECRET}`)).toBe(`a ${PLACEHOLDER}`)
  expect(masker.redactText(`b ${SECRET} c ${SECRET}`)).toBe(`b ${PLACEHOLDER} c ${PLACEHOLDER}`)
})

test("shell input finds an id placeholder but not the bare mask", () => {
  expect(findPlaceholder({ command: `echo ${PLACEHOLDER} > /tmp/x` })).toBe(PLACEHOLDER)
  expect(findPlaceholder({ command: "grep -F '[REDACTED]' notes.md" })).toBeUndefined()
})
