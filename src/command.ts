export type GoalCommand =
  | { readonly _tag: "Status" }
  | { readonly _tag: "Pause" }
  | { readonly _tag: "Resume" }
  | { readonly _tag: "Clear" }
  | { readonly _tag: "Edit"; readonly objective: string }
  | { readonly _tag: "EditPrompt" }
  | { readonly _tag: "Set"; readonly objective: string; readonly tokenBudget: number | null; readonly verify: string | null }
  | { readonly _tag: "Invalid"; readonly message: string }

const keywords = {
  "": "Status",
  status: "Status",
  pause: "Pause",
  resume: "Resume",
  clear: "Clear",
  edit: "EditPrompt",
} as const

const multipliers: Record<string, number> = { "": 1, k: 1_000, m: 1_000_000 }

export const parseTokens = (text: string): number | undefined => {
  const match = /^(\d+(?:\.\d+)?)([km]?)$/i.exec(text)
  if (!match) return undefined
  const tokens = Math.round(Number(match[1]) * multipliers[match[2]!.toLowerCase()]!)
  return tokens > 0 ? tokens : undefined
}

export const parseCommand = (text: string): GoalCommand => {
  const trimmed = text.trim()
  const keyword = keywords[trimmed.toLowerCase() as keyof typeof keywords]
  if (keyword) return { _tag: keyword }

  const edit = /^edit\s+/i.exec(trimmed)
  if (edit) return { _tag: "Edit", objective: trimmed.slice(edit[0].length) }

  let rest = trimmed
  let tokenBudget: number | null = null
  let verify: string | null = null
  for (;;) {
    const tokens = /^--tokens(?:=|\s+)(\S+)\s*/i.exec(rest)
    if (tokens) {
      if (tokenBudget !== null) return { _tag: "Invalid", message: "--tokens can be given only once." }
      const parsed = parseTokens(tokens[1]!)
      if (parsed === undefined) {
        return { _tag: "Invalid", message: `--tokens needs a positive number such as 50000, 250K or 1.5M, got "${tokens[1]}".` }
      }
      tokenBudget = parsed
      rest = rest.slice(tokens[0].length)
      continue
    }
    if (!/^--verify(?=[=\s]|$)/i.test(rest)) break
    if (verify !== null) return { _tag: "Invalid", message: "--verify can be given only once." }
    const command = /^--verify(?:=|\s+)(?:"([^"]+)"|'([^']+)'|([^\s"']+))\s*/i.exec(rest)
    if (!command) return { _tag: "Invalid", message: '--verify needs a command such as --verify "bun test".' }
    verify = command[1] ?? command[2] ?? command[3]!
    rest = rest.slice(command[0].length)
  }
  return rest ? { _tag: "Set", objective: rest, tokenBudget, verify } : { _tag: "Invalid", message: "Write the objective after the options." }
}
