import { createHmac } from "node:crypto"

export const MIN_SECRET_LENGTH = 12

// Process-environment names whose values are collected as known secrets at startup.
const ENV_NAME = /(API_?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)/i
export const isEnvSecretName = (name: string): boolean => ENV_NAME.test(name)

// A key marks a credential when its name contains one of these words anywhere
// (SMTP_PASS, CERT_PASSWORD_ENCRYPTION_KEY), not only as the whole name.
const FIELD_KEY = /(?:KEY|PASS|PWD|SECRET|TOKEN|CRYPT|PRIVATE|CREDENTIAL|AUTH)/i
export const isSecretFieldKey = (name: string): boolean => FIELD_KEY.test(name)

const SYNTAX = /[\s"'`,;{}()[\]]/
const REFERENCE = /^(?:\$|\{env:|process\.env\b)/
// A dotted identifier chain such as secrets.length or os.environ. Segments are
// capped so a dotted credential (a JWT's long base64url parts) still counts as a literal.
const IDENT = "[A-Za-z_$][A-Za-z0-9_$]{0,23}"
const IDENT_CHAIN = new RegExp(`^${IDENT}(?:\\.${IDENT})+$`)

// Field values are masked only when they look like literals. Expressions and
// references (calls, brackets, env lookups, dotted identifiers) are not credentials.
export const isLiteralValue = (value: string): boolean =>
  value.length >= 8 && !SYNTAX.test(value) && !REFERENCE.test(value) && !IDENT_CHAIN.test(value)

// A "key"[:=] "value" candidate. The key is a whole identifier (the left prefix is a
// non-word character or the start), so a match never begins inside a longer name.
const SECRET_FIELD = /(^|[^\w$])(["']?)([\w$]+)\2(\s*[:=]\s*)(["']?)((?:Bearer\s+)?[^\s"'`,;}]{8,})/gi

// scheme://user:password@ — the password part of a URL's userinfo.
const URL_CREDENTIAL = /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^\s'"`/:?#@[\]]+):([^\s'"`@/?#[\]]+)@/g

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype

export interface Masker {
  readonly redactText: (text: string) => string
  readonly redact: (value: unknown) => unknown
  readonly lookup: (id: string) => string | undefined
}

// Each value is masked as [REDACTED:<id>] where id is the first 8 hex characters of
// the value's HMAC under the plugin's key, so the same value always gets the same id.
export const createMasker = (options: { readonly secrets: readonly string[]; readonly key: string | Uint8Array }): Masker => {
  const secrets = options.secrets.filter((value) => value.length >= MIN_SECRET_LENGTH).sort((a, b) => b.length - a.length)
  const known = secrets.length > 0 ? new RegExp(secrets.map(escapeRegExp).join("|"), "g") : undefined
  const values = new Map<string, string>()
  const placeholder = (value: string) => {
    const id = createHmac("sha256", options.key).update(value).digest("hex").slice(0, 8)
    if (!values.has(id)) values.set(id, value)
    return `[REDACTED:${id}]`
  }

  const redactText = (text: string) =>
    (known ? text.replace(known, placeholder) : text)
      .replace(
        SECRET_FIELD,
        (match, lead: string, quote: string, key: string, separator: string, valueQuote: string, value: string) => {
          if (!isSecretFieldKey(key)) return match
          const bearer = value.match(/^Bearer\s+/i)?.[0] ?? ""
          const secret = value.slice(bearer.length)
          if (!isLiteralValue(secret)) return match
          return `${lead}${quote}${key}${quote}${separator}${valueQuote}${bearer}${placeholder(secret)}`
        },
      )
      .replace(URL_CREDENTIAL, (match, scheme: string, user: string, password: string) =>
        isLiteralValue(password) ? `${scheme}${user}:${placeholder(password)}@` : match,
      )

  const redact = (value: unknown): unknown => {
    if (typeof value === "string") return redactText(value)
    if (Array.isArray(value)) return value.map(redact)
    if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item)]))
    return value
  }

  return { redactText, redact, lookup: (id) => values.get(id) }
}
