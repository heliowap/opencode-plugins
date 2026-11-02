type Event = { readonly type: string; readonly data: unknown }

export function activeStepIds(events: readonly Event[], sessionID: string): Set<string> {
  const ids = new Set<string>()
  let active = false
  for (const event of events) {
    const data = event.data as { sessionID: string; goal?: { status: string }; assistantMessageID?: string }
    if (data.sessionID !== sessionID) continue
    if (event.type === "rpc.goal.changed") active = data.goal?.status === "active"
    if (event.type === "session.step.started" && active && data.assistantMessageID) ids.add(data.assistantMessageID)
  }
  return ids
}
