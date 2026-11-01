import { expect, test } from "bun:test"
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { dotenvSecrets, isDotenvFile, parseDotenv } from "../src/dotenv.ts"
import { createMasker } from "../src/redact.ts"

const KEY = "redact-secrets test key"

const DOTENV = [
  "# a comment",
  `DB_PASSWORD="dotenv-secret-abcdef99"`,
  "export API_TOKEN=plain-token-value-77",
  "APP_SECRET=synthetic-secret-99",
  "PORT=3000",
  "NODE_ENV=production",
  "EMPTY=",
  "SHORT_KEY=abc",
  "TRAILING_SECRET=trail-secret-11   # trailing comment",
  "QUOTED_SECRET='single-secret-55'",
  `QUOTED_COMMENT_SECRET="quoted-comment-66" # trailing comment`,
].join("\n")

test.each([
  [".env", true],
  [".env.local", true],
  [".env.production", true],
  [".env.example", false],
  [".envrc", false],
  ["env", false],
])("isDotenvFile(%j) is %s", (name, expected) => {
  expect(isDotenvFile(name)).toBe(expected)
})

test("parseDotenv strips quotes, export and trailing comments", () => {
  expect(parseDotenv(DOTENV)).toEqual([
    ["DB_PASSWORD", "dotenv-secret-abcdef99"],
    ["API_TOKEN", "plain-token-value-77"],
    ["APP_SECRET", "synthetic-secret-99"],
    ["PORT", "3000"],
    ["NODE_ENV", "production"],
    ["EMPTY", ""],
    ["SHORT_KEY", "abc"],
    ["TRAILING_SECRET", "trail-secret-11"],
    ["QUOTED_SECRET", "single-secret-55"],
    ["QUOTED_COMMENT_SECRET", "quoted-comment-66"],
  ])
})

test("a CRLF dotenv contributes its secret values", () => {
  expect(dotenvSecrets("SECRET_A=value-one-1111\r\nSECRET_B=value-two-2222\r\nPORT=3000\r\n")).toEqual([
    "value-one-1111",
    "value-two-2222",
  ])
})

test("dotenvSecrets keeps only secret-named values of 12+ characters", () => {
  expect(dotenvSecrets(DOTENV)).toEqual([
    "dotenv-secret-abcdef99",
    "plain-token-value-77",
    "synthetic-secret-99",
    "trail-secret-11",
    "single-secret-55",
    "quoted-comment-66",
  ])
})

test("a value from a project .env is masked wherever it appears", () => {
  const dir = mkdtempSync(join(tmpdir(), "redact-env-"))
  writeFileSync(join(dir, ".env"), DOTENV)
  writeFileSync(join(dir, ".env.example"), "DB_PASSWORD=placeholder-example-value")
  const secrets = readdirSync(dir)
    .filter(isDotenvFile)
    .flatMap((name) => dotenvSecrets(readFileSync(join(dir, name), "utf8")))
  const masker = createMasker({ secrets, key: KEY })
  expect(masker.redactText("connecting with dotenv-secret-abcdef99 now")).toBe(
    "connecting with [REDACTED:7d8ff295] now",
  )
  expect(masker.redactText(readFileSync(join(dir, ".env"), "utf8"))).toContain(
    `DB_PASSWORD="[REDACTED:7d8ff295]"`,
  )
})
