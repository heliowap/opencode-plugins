import { isPlainObject } from "./redact.ts"

// Tools whose inputs may carry placeholders back to disk. apply_patch and bash
// are the model-facing names; the host also routes them as patch and shell.
export const EDIT_TOOLS: ReadonlySet<string> = new Set(["edit", "write", "patch", "apply_patch"])
export const SHELL_TOOLS: ReadonlySet<string> = new Set(["shell", "bash"])

// A placeholder the masker can resolve ([REDACTED:<8 hex>]) and any mask-shaped
// token, including the bare [REDACTED] written by older runs or typed by hand.
const KNOWN_ID = /\[REDACTED:([0-9a-f]{8})\]/g
const ANY_ID = /\[REDACTED:[^\s\]]+\]/
const MASK_TOKEN = /\[REDACTED(?::[^\s\]]+)?\]/g

const restoreRejection = (token: string): string =>
  `Edit input contains the placeholder "${token}", which cannot be resolved. Re-read the lines you want to change and write the edit again without the placeholder.`

export const shellRejection = (token: string): string =>
  `Shell commands cannot contain the placeholder "${token}"; it is never substituted. Re-read the file and run the command without it.`

const strings = (value: unknown): string[] => {
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.flatMap(strings)
  if (isPlainObject(value)) return Object.values(value).flatMap(strings)
  return []
}

// The first [REDACTED:<id>] token anywhere in the input. The bare [REDACTED]
// is not a placeholder, so audit commands like `grep -F '[REDACTED]'` still run.
export const findPlaceholder = (input: unknown): string | undefined => {
  for (const text of strings(input)) {
    const token = ANY_ID.exec(text)
    if (token) return token[0]
  }
  return undefined
}

// Fields whose strings may carry a placeholder back into file content: the
// content-bearing fields of the edit, write and patch inputs. A mask token
// under any other key is rejected, never restored — the key's role is unknown,
// so resolving it could land the secret in a file location the tool writes to.
const CONTENT_FIELDS: ReadonlySet<string> = new Set([
  "content",
  "body",
  "text",
  "oldString",
  "newString",
  "patchText",
  "patch",
  "diff",
])

// The file named by a patch header line. The host parser trims each header
// line before reading it, so an indented header still names the file the patch
// writes; matching on the trimmed line also rejects the few indented shapes
// the host would refuse, which is the safe side.
const PATCH_HEADER = /^\*\*\*\s*(?:Add|Update|Delete)\s+File:\s*(.+?)\s*$|^\*\*\*\s*Move\s+to:\s*(.+?)\s*$/
const DIFF_HEADER = /^[-+]{3}\s+(?:[ab]\/)?(\S.*?)\s*$/
const headerPath = (line: string): string | undefined => {
  const header = line.trim()
  const file = header.match(PATCH_HEADER)
  if (file) return file[1] ?? file[2]
  return header.match(DIFF_HEADER)?.[1]
}

const PATH_FIELDS: ReadonlySet<string> = new Set(["path", "filePath"])

// The files an edit input will write: the path/filePath field, or the files a
// patch names in its "*** ... File:", "Move to:" and "---/+++" headers.
export const targetPaths = (tool: string, input: unknown): string[] => {
  if (!isPlainObject(input)) return []
  const paths = [...PATH_FIELDS].flatMap((field) => (typeof input[field] === "string" ? [input[field] as string] : []))
  if (tool !== "patch" && tool !== "apply_patch") return paths
  for (const text of strings(input)) {
    for (const line of text.split("\n")) {
      const path = headerPath(line)
      if (path !== undefined) paths.push(path)
    }
  }
  return paths.filter((path) => path.length > 0)
}

export type Restored = { readonly ok: true; readonly input: unknown } | { readonly ok: false; readonly message: string }

// The first mask token outside a content-bearing field, or undefined. Strings
// in an array inherit the role of the field holding the array; object entries
// are judged by their own key.
const strayToken = (key: string | undefined, value: unknown): string | undefined => {
  if (typeof value === "string")
    return key !== undefined && !CONTENT_FIELDS.has(key) ? value.match(MASK_TOKEN)?.[0] : undefined
  if (Array.isArray(value)) return value.map((item) => strayToken(key, item)).find(Boolean)
  if (isPlainObject(value)) return Object.entries(value).map(([name, item]) => strayToken(name, item)).find(Boolean)
  return undefined
}

// Resolves every known [REDACTED:<id>] in the input back to its value. A mask
// token in a file location — one of the target paths — or under any key that
// is not content-bearing is never resolved: it stands for a masked path such
// as a credential file, and resolving it would write to that path. It is
// rejected outright instead. Any mask token left over elsewhere (unknown id,
// or the bare [REDACTED]) is rejected with a re-read message unless the
// target file already contains that exact text.
export const restoreInput = (
  paths: readonly string[],
  input: unknown,
  lookup: (id: string) => string | undefined,
  fileContains: (text: string) => boolean,
): Restored => {
  const restore = (value: unknown): unknown => {
    if (typeof value === "string") return value.replace(KNOWN_ID, (token, id: string) => lookup(id) ?? token)
    if (Array.isArray(value)) return value.map(restore)
    if (isPlainObject(value))
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, restore(item)]))
    return value
  }
  for (const path of paths) {
    const token = path.match(MASK_TOKEN)?.[0]
    if (token !== undefined) return { ok: false, message: restoreRejection(token) }
  }
  const stray = strayToken(undefined, input)
  if (stray !== undefined) return { ok: false, message: restoreRejection(stray) }
  const next = restore(input)
  for (const text of strings(next)) {
    for (const match of text.matchAll(MASK_TOKEN)) {
      const token = match[0]
      if (!fileContains(token)) return { ok: false, message: restoreRejection(token) }
    }
  }
  return { ok: true, input: next }
}
