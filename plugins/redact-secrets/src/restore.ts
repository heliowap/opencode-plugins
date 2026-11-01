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

export const restoreRejection = (token: string): string =>
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

const PATH_FIELDS = ["path", "filePath"] as const
const PATCH_FILE = /^\*\*\*\s*(?:Add|Update|Delete)\s+File:\s*(.+?)\s*$|^\*\*\*\s*Move\s+to:\s*(.+?)\s*$/gm
const DIFF_FILE = /^[-+]{3}\s+(?:[ab]\/)?(\S.*?)\s*$/gm

// The files an edit input will write: the path/filePath field, or the files a
// patch names in its "*** ... File:" and "---/+++" headers.
export const targetPaths = (tool: string, input: unknown): string[] => {
  if (!isPlainObject(input)) return []
  const paths = PATH_FIELDS.flatMap((field) => (typeof input[field] === "string" ? [input[field] as string] : []))
  if (tool !== "patch" && tool !== "apply_patch") return paths
  for (const text of strings(input)) {
    for (const match of text.matchAll(PATCH_FILE)) paths.push(match[1] ?? match[2] ?? "")
    for (const match of text.matchAll(DIFF_FILE)) paths.push(match[1] ?? "")
  }
  return paths.filter((path) => path.length > 0)
}

export type Restored = { readonly ok: true; readonly input: unknown } | { readonly ok: false; readonly message: string }

// Resolves every known [REDACTED:<id>] in the input back to its value. A mask
// token that is left over (unknown id, or the bare [REDACTED]) is rejected with
// a re-read message unless the target file already contains that exact text.
export const restoreInput = (
  input: unknown,
  lookup: (id: string) => string | undefined,
  fileContains: (text: string) => boolean,
): Restored => {
  const restore = (value: unknown): unknown => {
    if (typeof value === "string") return value.replace(KNOWN_ID, (token, id: string) => lookup(id) ?? token)
    if (Array.isArray(value)) return value.map(restore)
    if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, restore(item)]))
    return value
  }
  const next = restore(input)
  for (const text of strings(next)) {
    for (const match of text.matchAll(MASK_TOKEN)) {
      const token = match[0]
      if (!fileContains(token)) return { ok: false, message: restoreRejection(token) }
    }
  }
  return { ok: true, input: next }
}
