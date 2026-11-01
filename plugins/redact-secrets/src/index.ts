import { Plugin } from "@opencode/plugin"
import { Error as ToolError } from "@opencode/plugin/promise/tool"
import { randomBytes } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { dotenvSecrets, isDotenvFile } from "./dotenv.ts"
import { createMasker, isEnvSecretName, MIN_SECRET_LENGTH } from "./redact.ts"
import { EDIT_TOOLS, findPlaceholder, restoreInput, SHELL_TOOLS, shellRejection, targetPaths } from "./restore.ts"

// Values from .env and .env.* in the session directory are known secrets too.
const dotenvValues = (directory: string): string[] => {
  try {
    return readdirSync(directory)
      .filter(isDotenvFile)
      .flatMap((name) => {
        try {
          return dotenvSecrets(readFileSync(join(directory, name), "utf8"))
        } catch {
          return []
        }
      })
  } catch {
    return []
  }
}

// Masks credentials in tool results before the model sees them or the session stores them.
export default Plugin.define({
  id: "redact-secrets",
  async setup(ctx) {
    const secrets = Object.entries(process.env)
      .filter(([name, value]) => isEnvSecretName(name) && (value?.length ?? 0) >= MIN_SECRET_LENGTH)
      .map(([, value]) => value as string)
      .concat(dotenvValues(ctx.location.directory))
    const masker = createMasker({ secrets, key: randomBytes(32) })
    const fileText = (path: string) => {
      try {
        return readFileSync(resolve(ctx.location.directory, path), "utf8")
      } catch {
        return undefined
      }
    }

    // The model only ever sees masked text. Edit inputs get known placeholders
    // restored so files keep their real secrets; placeholders that cannot be
    // resolved (or any placeholder in a shell command) are rejected instead.
    await ctx.tool.hook("execute.before", (event) => {
      if (SHELL_TOOLS.has(event.tool)) {
        const token = findPlaceholder(event.input)
        if (token !== undefined) throw new ToolError({ message: shellRejection(token) })
        return
      }
      if (!EDIT_TOOLS.has(event.tool)) return
      const paths = targetPaths(event.tool, event.input)
      const fileContains = (text: string) => paths.some((path) => fileText(path)?.includes(text) ?? false)
      const restored = restoreInput(paths, event.input, masker.lookup, fileContains)
      if (!restored.ok) throw new ToolError({ message: restored.message })
      event.input = restored.input
    })

    await ctx.tool.hook("execute.after", (event) => {
      if (event.status === "completed") event.result = masker.redact(event.result) as typeof event.result
      else event.error = masker.redact(event.error) as typeof event.error
    })
  },
})
