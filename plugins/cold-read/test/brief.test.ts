import { expect, test } from "bun:test"
import { review } from "../src/brief.ts"

const long =
  "The CI capacity gate is a job that picks a self-hosted runner and checks a grant before any other job starts. Removing it makes CI run on GitHub-hosted runners with no grant check. Remove it?"

const input = (...questions: string[]) => ({
  questions: questions.map((question) => ({ header: "h", question, options: [{ label: "Yes", description: "y" }] })),
})

test("a short question is rejected and named by its number", () => {
  const verdict = review("s1", input(long, "Remove the gate?"), new Set())
  expect(verdict.ok).toBe(false)
  expect(verdict.ok ? "" : verdict.message).toStartWith("Question 2 is not a cold read (16 characters).")
})

test("the rejection leads with the resubmit rule and carries the checklist", () => {
  const verdict = review("s1", input("Remove the gate?"), new Set())
  const lines = verdict.ok ? [] : verdict.message.split("\n")
  expect(lines[1]).toStartWith("If another tool's instructions fixed this exact text, resubmit it unchanged")
  expect(lines).toContain("- each option with its consequence, and your recommendation with its reason.")
})

test("an identical resubmission in the same session passes", () => {
  const seen = new Set<string>()
  expect(review("s1", input("Remove the gate?"), seen).ok).toBe(false)
  expect(review("s1", input("Remove the gate?"), seen).ok).toBe(true)
  expect(review("s1", input("Drop the gate?"), seen).ok).toBe(false)
})

test("a resubmission in another session is rejected again", () => {
  const seen = new Set<string>()
  expect(review("s1", input("Remove the gate?"), seen).ok).toBe(false)
  expect(review("s2", input("Remove the gate?"), seen).ok).toBe(false)
  expect(review("s2", input("Remove the gate?"), seen).ok).toBe(true)
})

test("a question with context passes on the first call", () => {
  expect(review("s1", input(long), new Set()).ok).toBe(true)
  expect(review("s1", input("Remove it?"), new Set()).ok).toBe(false)
})

test("an input without questions passes", () => {
  expect(review("s1", {}, new Set()).ok).toBe(true)
  expect(review("s1", input("x"), new Set()).ok).toBe(false)
})
