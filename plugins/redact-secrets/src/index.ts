import { Plugin } from "@opencode/plugin"
import { randomBytes } from "node:crypto"
import { createMasker, isEnvSecretName, isPlainObject, MIN_SECRET_LENGTH } from "./redact.ts"

// Masks credentials in tool results before the model sees them or the session stores them.
export default Plugin.define({
  id: "redact-secrets",
  async setup(ctx) {
    const secrets = Object.entries(process.env)
      .filter(([name, value]) => isEnvSecretName(name) && (value?.length ?? 0) >= MIN_SECRET_LENGTH)
      .map(([, value]) => value as string)
    const masker = createMasker({ secrets, key: randomBytes(32) })

    await ctx.tool.hook("execute.after", (event) => {
      if (event.status === "completed") event.result = masker.redact(event.result) as typeof event.result
      else if (isPlainObject(event.error)) event.error = masker.redact(event.error) as typeof event.error
    })
  },
})
