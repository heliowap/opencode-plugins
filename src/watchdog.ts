export const DEFAULT_STALL_MS = 600_000
const MAX_TICK_MS = 60_000
const MIN_TICK_MS = 50
const TICKS_PER_STALL = 4

export const stallDelay = (option: unknown): number =>
  typeof option === "number" && option > 0 && option < Infinity ? option : DEFAULT_STALL_MS

export const tickInterval = (stallMs: number) =>
  Math.min(MAX_TICK_MS, Math.max(MIN_TICK_MS, Math.floor(stallMs / TICKS_PER_STALL)))

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
  const untouched = { children, stalls: [] as Stall[] }
  // Events for a session the watchdog does not track change nothing.
  const update = (sessionID: string, change: (child: Child) => Child | undefined) => {
    const child = children.get(sessionID)
    if (!child) return untouched
    const next = new Map(children)
    const changed = change(child)
    if (changed) next.set(sessionID, changed)
    else next.delete(sessionID)
    return { children: next, stalls: [] as Stall[] }
  }
  switch (event._tag) {
    case "Tick": {
      const next = new Map(children)
      const stalls: Stall[] = []
      for (const [sessionID, child] of children) {
        const idleMs = now - child.lastActivity
        if (child.running && child.openCalls.size === 0 && idleMs >= stallMs) {
          stalls.push({ sessionID, parentID: child.parentID, idleMs })
          next.set(sessionID, { ...child, running: false })
        }
      }
      return { children: next, stalls }
    }
    case "Created": {
      const next = new Map(children)
      next.set(event.sessionID, { parentID: event.parentID, running: false, lastActivity: now, openCalls: new Set() })
      return { children: next, stalls: [] }
    }
    case "Started":
      return update(event.sessionID, (child) => ({ ...child, running: true, lastActivity: now, openCalls: new Set() }))
    case "Activity":
      return update(event.sessionID, (child) => ({ ...child, lastActivity: now }))
    case "ToolCalled":
      return update(event.sessionID, (child) => ({ ...child, lastActivity: now, openCalls: new Set([...child.openCalls, event.callID]) }))
    case "ToolSettled":
      return update(event.sessionID, (child) => {
        const openCalls = new Set(child.openCalls)
        openCalls.delete(event.callID)
        return { ...child, lastActivity: now, openCalls }
      })
    case "Ended":
      return update(event.sessionID, (child) => ({ ...child, running: false, openCalls: new Set() }))
    case "Deleted":
      return update(event.sessionID, () => undefined)
    default: {
      // Assigning to never makes a new variant a compile error here; at run time an unknown tag fails loudly.
      const unhandled: never = event
      throw new Error(`goal: unhandled watch event ${JSON.stringify(unhandled)}`)
    }
  }
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
