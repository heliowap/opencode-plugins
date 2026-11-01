import { isSecretFieldKey, MIN_SECRET_LENGTH } from "./redact.ts"

export const isDotenvFile = (name: string): boolean =>
  name === ".env" || (name.startsWith(".env.") && name !== ".env.example")

const ENTRY = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/
const QUOTED = /^(["'])(.*)\1\s*$/

// Reads KEY=value lines: optional "export", optional single or double quotes,
// and a trailing comment only when whitespace precedes the "#".
export const parseDotenv = (text: string): [string, string][] =>
  text.split("\n").flatMap((line) => {
    const match = ENTRY.exec(line)
    const name = match?.[1]
    if (!match || name === undefined) return []
    const trimmed = (match[2] ?? "").trim()
    const uncommented = trimmed.replace(/\s+#.*$/, "").trimEnd()
    const value = QUOTED.exec(trimmed)?.[2] ?? QUOTED.exec(uncommented)?.[2] ?? uncommented
    return [[name, value] as [string, string]]
  })

// Secret values follow the same name and length filters as environment secrets,
// with the name filter matching anywhere in the key.
export const dotenvSecrets = (text: string): string[] =>
  parseDotenv(text)
    .filter(([name, value]) => isSecretFieldKey(name) && value.length >= MIN_SECRET_LENGTH)
    .map(([, value]) => value)
