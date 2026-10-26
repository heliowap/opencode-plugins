export const DEFAULT_STALL_MS = 600_000

export const stallDelay = (option: unknown): number =>
  typeof option === "number" && option > 0 && option < Infinity ? option : DEFAULT_STALL_MS

export const tickInterval = (stallMs: number) => Math.min(60_000, Math.max(50, Math.floor(stallMs / 4)))

export interface Child {
  readonly parentID: string
  readonly running: boolean
  readonly lastActivity: number
  readonly openCalls: ReadonlySet<string>
}

export type Children = ReadonlyMap<string, Child>

export type WatchEvent =
  | { readonly _tag: "Created"; readonly sessionID: string; readonly parentID: string }
  | { readonly _tag: "Started"; readonly sessionID: string }
  | { readonly _tag: "Activity"; readonly sessionID: string }
  | { readonly _tag: "ToolCalled"; readonly sessionID: string; readonly callID: string }
  | { readonly _tag: "ToolSettled"; readonly sessionID: string; readonly callID: string }
  | { readonly _tag: "Ended"; readonly sessionID: string }
  | { readonly _tag: "Deleted"; readonly sessionID: string }
  | { readonly _tag: "Tick" }

export interface Stall {
  readonly sessionID: string
  readonly parentID: string
  readonly idleMs: number
}

export const watch = (children: Children, event: WatchEvent, now: number, stallMs: number): {
  readonly children: Children
  readonly stalls: readonly Stall[]
} => {
  const next = new Map(children)
  const stalls: Stall[] = []
  if (event._tag === "Tick") {
    for (const [sessionID, child] of children) {
      const idleMs = now - child.lastActivity
      if (child.running && child.openCalls.size === 0 && idleMs >= stallMs) {
        stalls.push({ sessionID, parentID: child.parentID, idleMs })
        next.set(sessionID, { ...child, running: false })
      }
    }
    return { children: next, stalls }
  }
  if (event._tag === "Created") {
    next.set(event.sessionID, { parentID: event.parentID, running: false, lastActivity: now, openCalls: new Set() })
    return { children: next, stalls }
  }
  const child = children.get(event.sessionID)
  if (!child) return { children, stalls }
  switch (event._tag) {
    case "Started":
      next.set(event.sessionID, { ...child, running: true, lastActivity: now, openCalls: new Set() })
      break
    case "Activity":
      next.set(event.sessionID, { ...child, lastActivity: now })
      break
    case "ToolCalled":
      next.set(event.sessionID, { ...child, lastActivity: now, openCalls: new Set([...child.openCalls, event.callID]) })
      break
    case "ToolSettled": {
      const openCalls = new Set(child.openCalls)
      openCalls.delete(event.callID)
      next.set(event.sessionID, { ...child, lastActivity: now, openCalls })
      break
    }
    case "Ended":
      next.set(event.sessionID, { ...child, running: false, openCalls: new Set() })
      break
    case "Deleted":
      next.delete(event.sessionID)
      break
  }
  return { children: next, stalls }
}

export const watchEventOf = (event: { readonly type: string; readonly data?: unknown }, directory: string): WatchEvent | undefined => {
  const data = event.data as {
    sessionID?: unknown
    parentID?: unknown
    location?: { directory?: unknown } | null
    id?: unknown
  } | null | undefined
  if (typeof data?.sessionID !== "string") return undefined
  const sessionID = data.sessionID
  switch (event.type) {
    case "session.created":
      return typeof data.parentID === "string" && data.location?.directory === directory
        ? { _tag: "Created", sessionID, parentID: data.parentID }
        : undefined
    case "session.execution.started":
      return { _tag: "Started", sessionID }
    case "session.execution.succeeded":
    case "session.execution.failed":
    case "session.execution.interrupted":
      return { _tag: "Ended", sessionID }
    case "session.tool.called":
      return typeof data.id === "string" ? { _tag: "ToolCalled", sessionID, callID: data.id } : undefined
    case "session.tool.success":
    case "session.tool.failed":
      return typeof data.id === "string" ? { _tag: "ToolSettled", sessionID, callID: data.id } : undefined
    case "session.deleted":
      return { _tag: "Deleted", sessionID }
    default:
      return { _tag: "Activity", sessionID }
  }
}
