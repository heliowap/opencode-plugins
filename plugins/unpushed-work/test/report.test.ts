import { describe, expect, test } from "bun:test"
import { header, shouldReport } from "../src/report.ts"

describe("shouldReport", () => {
  const here = { directory: "/repo" }

  test("reports a root session in this plugin's location", () => {
    expect(shouldReport({ location: { directory: "/repo" } }, here)).toBe(true)
  })

  test("skips a child session but reports a root session in the same location", () => {
    expect(shouldReport({ parentID: "ses_parent", location: { directory: "/repo" } }, here)).toBe(false)
    expect(shouldReport({ location: { directory: "/repo" } }, here)).toBe(true)
  })

  test("skips a session hosted by another location but reports this location's", () => {
    expect(shouldReport({ location: { directory: "/other" } }, here)).toBe(false)
    expect(shouldReport({ location: { directory: "/other" } }, { directory: "/other" })).toBe(true)
  })

  test("skips a session with no location but reports one that has this one", () => {
    expect(shouldReport({}, here)).toBe(false)
    expect(shouldReport({ location: { directory: "/repo" } }, here)).toBe(true)
  })
})

describe("header", () => {
  test("records the scan time, session, since timestamp and exit code", () => {
    expect(header("ses_abc", "2026-10-16T00:47:19.517Z", 1, new Date("2026-10-16T00:47:29.100Z"))).toBe(
      "# 2026-10-16T00:47:29.100Z session=ses_abc since=2026-10-16T00:47:19.517Z exit=1 (remote state from local refs, no fetch)\n",
    )
  })

  test("records a signal when the checker was killed instead of exiting", () => {
    expect(header("ses_def", "2026-10-17T12:00:00.000Z", "SIGTERM", new Date("2026-10-17T12:02:03.456Z"))).toBe(
      "# 2026-10-17T12:02:03.456Z session=ses_def since=2026-10-17T12:00:00.000Z exit=SIGTERM (remote state from local refs, no fetch)\n",
    )
  })
})
