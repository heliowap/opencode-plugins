import type { TraceRecord } from "./trace.ts"

const CUT = 120

const cut = (text: string) => (text.length > CUT ? `${text.slice(0, CUT - 1)}…` : text)

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
  switch (record._tag) {
    case "Transition": {
      const detail =
        record.objective !== undefined ? ` objective: ${cut(record.objective)}` : record.note !== undefined ? ` note: ${cut(record.note)}` : ""
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

const sessionRow = (sessionID: string, records: readonly TraceRecord[]) => {
  const transitions = records.flatMap((record) => (record._tag === "Transition" ? [record] : []))
  const status = transitions.at(-1)?.to ?? "unknown"
  const toolErrors = count(records, (record) => record._tag === "ToolError")
  const errors = count(records, (record) => record._tag === "Error")
  const commands = records.flatMap((record) => (record._tag === "Command" ? [record] : []))
  const refused = count(commands, (command) => command.result === "Invalid")
  return `${sessionID}  ${status}  ${records.length} records  ${commands.length} commands (${refused} refused)  ${toolErrors} tool errors  ${errors} errors  last ${time(records.at(-1)!)}`
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
