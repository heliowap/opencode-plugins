import type { TraceRecord } from "./trace.ts"

const LIMIT = 120

const truncate = (text: string) => (text.length > LIMIT ? `${text.slice(0, LIMIT - 1)}…` : text)

const time = (record: TraceRecord) => new Date(record.at).toISOString()

const TAGS = new Set(["Transition", "Command", "ToolError", "Error"])

// The log is plain JSON on disk: keep only lines that carry a known tag and a timestamp. A line that
// is not an object throws here, and parse drops it.
const isRecord = (value: unknown): value is TraceRecord => {
  const record = value as { readonly _tag?: unknown; readonly at?: unknown }
  return typeof record.at === "number" && TAGS.has(record._tag as string)
}

const parse = (lines: readonly string[]) =>
  lines.flatMap((line) => {
    try {
      const value: unknown = JSON.parse(line)
      return isRecord(value) ? [value] : []
    } catch {
      return []
    }
  })

const describe = (record: TraceRecord) => {
  switch (record._tag) {
    case "Transition": {
      const detail =
        record.objective !== undefined
          ? ` objective: ${truncate(record.objective)}`
          : record.note !== undefined
            ? ` note: ${truncate(record.note)}`
            : record.effect === "Refuse"
              ? ` ${record.text}`
              : ""
      return `${record.event}: ${record.from} -> ${record.to} [${record.effect}]${detail}`
    }
    case "Command":
      return `/goal ${record.text} -> ${record.result}${record.message === undefined ? "" : `: ${record.message}`}`
    case "ToolError":
      return `${record.tool} failed: ${record.message}`
    case "Error":
      return `${record.where} failed: ${record.cause}`
  }
}

const count = <T>(items: readonly T[], match: (item: T) => boolean) => items.filter(match).length

// Only commands carry a result, and only transitions an effect.
const isRefusal = (record: TraceRecord) => {
  const fields = record as { readonly result?: string; readonly effect?: string }
  return fields.result === "Invalid" || fields.effect === "Refuse"
}

const sessionRow = (sessionID: string, records: readonly TraceRecord[]) => {
  const transitions = records.flatMap((record) => (record._tag === "Transition" ? [record] : []))
  const status = transitions.at(-1)?.to ?? "unknown"
  const commands = count(records, (record) => record._tag === "Command")
  const refused = count(records, isRefusal)
  const toolErrors = count(records, (record) => record._tag === "ToolError")
  const errors = count(records, (record) => record._tag === "Error")
  return `${sessionID}  ${status}  ${records.length} records  ${commands} commands (${refused} refused)  ${toolErrors} tool errors  ${errors} errors  last ${time(records.at(-1)!)}`
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
    if (record.sessionID === undefined) loose.push(record)
    else sessions.set(record.sessionID, [...(sessions.get(record.sessionID) ?? []), record])
  }
  const rows = [...sessions].map(([id, own]) => sessionRow(id, own))
  if (loose.length) rows.push(`${loose.length} errors outside sessions, last ${time(loose.at(-1)!)}: ${describe(loose.at(-1)!)}`)
  return rows.join("\n")
}
