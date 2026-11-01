export type Session = {
  readonly parentID?: string
  readonly location?: { readonly directory: string }
}

// Every location's plugin instance receives the server-wide event stream, so a session reports
// only in its own location, and only as a root session: a child session's turn is its parent's work.
export function shouldReport(session: Session, location: { readonly directory: string }): boolean {
  return !session.parentID && session.location?.directory === location.directory
}

export function header(sessionID: string, since: string, exit: number | string | undefined, now: Date): string {
  return `# ${now.toISOString()} session=${sessionID} since=${since} exit=${exit} (remote state from local refs, no fetch)\n`
}
