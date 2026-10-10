import { Plugin } from "@opencode/plugin"

// Masks credentials in tool results before the model sees them or the session stores them.
const SECRET_ENV = /(API_?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)/i
const SECRET_FIELD =
  /("?(?:api_?key|authorization|password|secret|(?:access_?|refresh_?|auth_?|id_?)?token)"?\s*[:=]\s*"?(?:Bearer\s+)?)([^"\s,;}]{8,})/gi
const MASK = "[REDACTED]"
const MIN_SECRET_LENGTH = 12

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype

export default Plugin.define({
  id: "redact-secrets",
  async setup(ctx) {
    const secrets = Object.entries(process.env)
      .filter(([name, value]) => SECRET_ENV.test(name) && (value?.length ?? 0) >= MIN_SECRET_LENGTH)
      .map(([, value]) => value as string)
      .sort((a, b) => b.length - a.length)
    const knownSecret = secrets.length > 0 ? new RegExp(secrets.map(escapeRegExp).join("|"), "g") : undefined

    const redactText = (text: string) =>
      (knownSecret ? text.replace(knownSecret, MASK) : text).replace(SECRET_FIELD, `$1${MASK}`)

    const redact = (value: unknown): unknown => {
      if (typeof value === "string") return redactText(value)
      if (Array.isArray(value)) return value.map(redact)
      if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item)]))
      return value
    }

    await ctx.tool.hook("execute.after", (event) => {
      if (event.status === "completed") event.result = redact(event.result) as typeof event.result
      else if (isPlainObject(event.error)) event.error = redact(event.error) as typeof event.error
    })
  },
})
