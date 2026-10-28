import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { logPath, rotatedPath } from "../src/log.ts"
import { summarize } from "../src/report.ts"

const current = logPath(process.env, homedir())
const lines = [rotatedPath(current), current]
  .filter((path) => existsSync(path))
  .flatMap((path) => readFileSync(path, "utf8").split("\n").filter(Boolean))

console.log(summarize(lines, process.argv[2]))
