import type { TraceRecord } from "./trace.ts"

const CUT = 120

const cut = (text: unknown) => {
  const value = String(text)
  return value.length > CUT ? `${value.slice(0, CUT - 1)}…` : value
}

const time = (record: TraceRecord) => new Date(record.at).toISOString()

const parse = (lines: readonly string[]) =>
  lines.flatMap((line) => {
    try {
      return [JSON.parse(line) as TraceRecord]
    } catch {
      return []
    }
  })

const describe = (record: TraceRecord) => {
  switch (record.kind) {
    case "transition": {
      const detail =
        record.objective !== undefined ? ` objective: ${cut(record.objective)}` : record.note !== undefined ? ` note: ${cut(record.note)}` : ""
      return `${record.event}: ${record.from} -> ${record.to} [${record.effect}]${detail}`
    }
    case "command":
      return `/goal ${record.text} -> ${record.result}${record.message === undefined ? "" : `: ${record.message}`}`
    case "tool_error":
      return `${record.tool} failed: ${record.message}`
    default:
      return `${record.where}: ${record.cause}`
  }
}

const sessionRow = (sessionID: string, records: readonly TraceRecord[]) => {
  const status = records.filter((record) => record.kind === "transition").at(-1)?.to ?? "unknown"
  const toolErrors = records.filter((record) => record.kind === "tool_error").length
  const refused = records.filter((record) => record.result === "Invalid").length
  return `${sessionID}  ${status}  ${records.length} records  ${toolErrors} tool errors  ${refused} refused commands  last ${time(records.at(-1)!)}`
}

export const summarize = (lines: readonly string[], sessionID?: string) => {
  const records = parse(lines)
  if (sessionID !== undefined) {
    const own = records.filter((record) => record.sessionID === sessionID)
    return own.length ? own.map((record) => `${time(record)}  ${describe(record)}`).join("\n") : `No records for ${sessionID}.`
  }
  if (!records.length) return "The goal log is empty."
  const sessions = new Map<string, TraceRecord[]>()
  const loose: TraceRecord[] = []
  for (const record of records) {
    if (typeof record.sessionID === "string") sessions.set(record.sessionID, [...(sessions.get(record.sessionID) ?? []), record])
    else loose.push(record)
  }
  const rows = [...sessions].map(([id, own]) => sessionRow(id, own))
  if (loose.length) rows.push(`${loose.length} errors outside sessions, last ${time(loose.at(-1)!)}: ${describe(loose.at(-1)!)}`)
  return rows.join("\n")
}
