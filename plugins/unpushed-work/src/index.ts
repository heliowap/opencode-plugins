import { execFile } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { Plugin } from "@opencode/plugin"
import { header, shouldReport } from "./report.ts"
import { SCRIPT } from "./script.ts"

const home = homedir()
const stateDir = join(process.env.XDG_STATE_HOME ?? join(home, ".local/state"), "opencode-unpushed-work")
const reportFile = join(stateDir, "last-report.txt")

export default Plugin.define({
  id: "local.unpushed-work",
  setup(ctx) {
    const controller = new AbortController()
    // The whole turn is one promise so a synchronous throw inside it rejects per event and is
    // noted, instead of escaping the loop and ending the stream.
    const turn = async (sessionID: string) => {
      const session = await ctx.session.get({ sessionID })
      if (!shouldReport(session, ctx.location)) return
      await report(session.id, new Date(session.time.created).toISOString())
    }
    void (async () => {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        if (event.type !== "session.execution.succeeded") continue
        await turn(event.data.sessionID).catch(failed)
      }
    })().catch((error: unknown) => {
      if (!controller.signal.aborted) return write(`# event stream failed: ${error}\n`).catch(() => {})
    })
    return () => controller.abort()
  },
})

function report(sessionID: string, since: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(SCRIPT, ["--since", since], { timeout: 120_000 }, (error, stdout, stderr) => {
      const exit = error ? (error.code ?? error.signal) : 0
      write(header(sessionID, since, exit, new Date()) + stdout + stderr).then(resolve, reject)
    })
  })
}

const failed = (error: unknown): Promise<void> =>
  write(`# ${new Date().toISOString()} unpushed-work plugin failed: ${error}\n`).catch(() => {})

async function write(text: string) {
  await mkdir(stateDir, { recursive: true })
  await writeFile(reportFile, text)
}
