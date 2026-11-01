import { expect, test } from "bun:test"
import { createMasker, isLiteralValue } from "../src/redact.ts"

const KEY = "redact-secrets test key"
const masker = createMasker({ secrets: [], key: KEY })

// Ordinary code lines the old SECRET_FIELD masked, from issue #11. Each has a
// secret-looking key followed by an expression or a reference, not a literal.
test.each([
  "const knownSecret = secrets.length > 0",
  `"apiKey": "{env:CLIPROXY_API_KEY}"`,
  "const password = process.env.DB_PASSWORD",
  "x_api_key: Annotated[str, Header()] = None",
  "const sessionToken = response.headers.get('x')",
])("leaves the code line %j unchanged", (line) => {
  expect(masker.redactText(line)).toBe(line)
})

test.each([
  ["api_key=sk-live-abcdef123456", "api_key=[REDACTED:b506337a]"],
  [`"password": "hunter2hunter2"`, `"password": "[REDACTED:393052ce]"`],
  [
    "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c",
    "Authorization: Bearer [REDACTED:da469e5c]",
  ],
])("masks the literal value in %j", (line, masked) => {
  expect(masker.redactText(line)).toBe(masked)
})

const withSecret = createMasker({ secrets: ["env-secret-abcdef1234"], key: KEY })

test("a known secret value is masked wherever it appears", () => {
  expect(withSecret.redactText("the token env-secret-abcdef1234 was printed")).toBe(
    "the token [REDACTED:e13b71c1] was printed",
  )
})

test("a known secret value is masked under a field key", () => {
  expect(withSecret.redactText("api_key=env-secret-abcdef1234")).toBe("api_key=[REDACTED:e13b71c1]")
})

test.each([
  "sk-live-abcdef123456",
  "hunter2hunter2",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c",
  "AKIAIOSFODNN7EXAMPLE",
])("treats %j as a literal value", (value) => {
  expect(isLiteralValue(value)).toBe(true)
})

test.each([
  "secrets.length",
  "os.environ",
  "this.config.db.password",
  "process.env.DB_PASSWORD",
  "{env:CLIPROXY_API_KEY}",
  "$TOKEN",
  "${{ secrets.TOKEN }}",
  "response.headers.get('x')",
  "Annotated[str",
  "abc123",
])("rejects %j as a literal value", (value) => {
  expect(isLiteralValue(value)).toBe(false)
})
