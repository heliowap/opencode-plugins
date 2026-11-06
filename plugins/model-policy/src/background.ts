import type { SessionContext } from "@opencode/plugin/promise/session"

type Tools = SessionContext["tools"]
type Schema = Tools[string]["input"]

interface Session {
  readonly parentID?: string | null
}

// A background call returns at once and tells the model to end its response. In a child session
// that response is the final report, so the parent gets it while the work is still running.
const BACKGROUND_TOOLS: ReadonlySet<string> = new Set(["shell", "subagent"])

const isChild = (session: Session) => Boolean(session.parentID)

const withoutBackground = (schema: Schema): Schema => {
  if (typeof schema.properties !== "object" || schema.properties === null) return schema
  const { background: _, ...properties } = schema.properties as Record<string, unknown>
  return { ...schema, properties }
}

export const toolsFor = (session: Session, tools: Tools): Tools => {
  if (!isChild(session)) return tools
  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => [name, BACKGROUND_TOOLS.has(name) ? { ...tool, input: withoutBackground(tool.input) } : tool]),
  )
}

export const requestsBackground = (tool: string, input: unknown): input is { readonly background: true } =>
  BACKGROUND_TOOLS.has(tool) && typeof input === "object" && input !== null && (input as { background?: unknown }).background === true

export const inputFor = <Input extends { readonly background?: unknown }>(session: Session, input: Input): Input | Omit<Input, "background"> => {
  if (!isChild(session)) return input
  const { background: _, ...foreground } = input
  return foreground
}
