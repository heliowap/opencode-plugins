import { execFile } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { Plugin } from "@opencode/plugin"
import { SCRIPT } from "./script"

const home = homedir()
const stateDir = join(process.env.XDG_STATE_HOME ?? join(home, ".local/state"), "opencode-unpushed-work")
const reportFile = join(stateDir, "last-report.txt")

export default Plugin.define({
  id: "local.unpushed-work",
  setup(ctx) {
    const controller = new AbortController()
    let running = false
    void (async () => {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        if (event.type !== "session.execution.succeeded" || running) continue
        running = true
        try {
          const session = await ctx.session.get({ sessionID: event.data.sessionID })
          // Every location's instance receives every event; only the session's own location reports.
          if (session.parentID || session.location?.directory !== ctx.location.directory) continue
          await report(session.id, new Date(session.time.created).toISOString())
        } catch (error) {
          await write(`# ${new Date().toISOString()} unpushed-work plugin failed: ${error}\n`)
        } finally {
          running = false
        }
      }
    })().catch(async (error) => {
      if (!controller.signal.aborted) await write(`# event stream failed: ${error}\n`)
    })
    return () => controller.abort()
  },
})

function report(sessionID: string, since: string) {
  return new Promise<void>((resolve, reject) => {
    execFile(SCRIPT, ["--since", since], { timeout: 120_000 }, (error, stdout, stderr) => {
      const exit = error ? (error.code ?? error.signal) : 0
      const header = `# ${new Date().toISOString()} session=${sessionID} since=${since} exit=${exit} (remote state from local refs, no fetch)\n`
      write(header + stdout + stderr).then(resolve, reject)
    })
  })
}

async function write(text: string) {
  await mkdir(stateDir, { recursive: true })
  await writeFile(reportFile, text)
}
