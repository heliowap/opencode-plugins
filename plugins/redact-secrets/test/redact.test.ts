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

// The leaked shapes from issue #10: wider key names, a key that is not the last
// segment, and a credential inside a URL's userinfo.
test.each([
  ["SMTP_PASS=synthetic-smtp-value-123", "SMTP_PASS=[REDACTED:cab746b5]"],
  ["APP_CRYPT_KEY=synthetic-crypt-value-123", "APP_CRYPT_KEY=[REDACTED:159296b8]"],
  ["CERT_PASSWORD_ENCRYPTION_KEY=synthetic-enc-value-123", "CERT_PASSWORD_ENCRYPTION_KEY=[REDACTED:9bc8f169]"],
  ["DB_PASSWORD=synthetic-db-value-789", "DB_PASSWORD=[REDACTED:45a918e4]"],
])("masks the wider field %j", (line, masked) => {
  expect(masker.redactText(line)).toBe(masked)
})

test("masks the password in a URL's userinfo and keeps user and host", () => {
  expect(masker.redactText(`DATABASE_URL="mysql://root:synthetic-db-pass@127.0.0.1:3306/app"`)).toBe(
    `DATABASE_URL="mysql://root:[REDACTED:7d38f5fc]@127.0.0.1:3306/app"`,
  )
})

test.each(["PORT=3000", "NODE_ENV=production"])("leaves the non-secret key %j unchanged", (line) => {
  expect(masker.redactText(line)).toBe(line)
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
