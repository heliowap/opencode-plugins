export const MIN_LENGTH = 150

export const BRIEF = [
  "Write each question as a cold read: answerable by someone who has not followed this session, in one reading. Each question carries:",
  "- the decision and why it blocks now;",
  "- the current state, verified this session, with every term, ID and abbreviation explained in plain words;",
  "- each option with its consequence, and your recommendation with its reason.",
  "Put every open decision in one round. Finding facts is your job; ask the user only for decisions.",
].join("\n")

export type Verdict = { readonly ok: true } | { readonly ok: false; readonly message: string }

type QuestionInput = { readonly questions?: ReadonlyArray<{ readonly question?: unknown }> }

// A rejected input passes when resubmitted unchanged, so fixed-text questions other tools
// require (such as protect-agents-md's approval question) still reach the user.
export const review = (sessionID: string, input: unknown, seen: Set<string>): Verdict => {
  const questions = (input as QuestionInput | undefined)?.questions ?? []
  const lengths = questions.map((entry) => (typeof entry.question === "string" ? entry.question.length : MIN_LENGTH))
  const short = lengths.findIndex((length) => length < MIN_LENGTH)
  if (short < 0) return { ok: true }
  const key = `${sessionID}\n${JSON.stringify(input)}`
  if (seen.has(key)) return { ok: true }
  seen.add(key)
  return {
    ok: false,
    message: [
      `Question ${short + 1} is not a cold read (${lengths[short]} characters).`,
      "If another tool's instructions fixed this exact text, resubmit it unchanged: an identical resubmission passes. Otherwise rewrite the questions before asking again.",
      BRIEF,
    ].join("\n"),
  }
}
