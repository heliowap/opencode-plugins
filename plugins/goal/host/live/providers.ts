import { homedir } from "node:os"
import { join } from "node:path"

const stripJsonc = (source: string) => {
  let out = ""
  let inString = false
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!
    if (inString) {
      out += char
      if (char === "\\") out += source[++i] ?? ""
      else if (char === '"') inString = false
    } else if (char === '"') {
      inString = true
      out += char
    } else if (char === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i++
      out += "\n"
    } else if (char === "/" && source[i + 1] === "*") {
      i = source.indexOf("*/", i + 2) + 1
    } else out += char
  }
  return out.replace(/,(\s*[}\]])/g, "$1")
}

export const userProviders = async (ids: readonly string[]) => {
  const path = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "opencode", "opencode.jsonc")
  const config = JSON.parse(stripJsonc(await Bun.file(path).text())) as { providers?: Record<string, unknown> }
  return Object.fromEntries(ids.flatMap((id) => (config.providers?.[id] ? [[id, config.providers[id]]] : [])))
}

export const parseModel = (ref: string) => {
  const [model, variant] = ref.split("#") as [string, string | undefined]
  const slash = model.indexOf("/")
  return { providerID: model.slice(0, slash), id: model.slice(slash + 1), ...(variant && { variant }) }
}
