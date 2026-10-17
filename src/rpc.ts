import { Rpc } from "@opencode/schema/rpc"

const goal = { anyOf: [{ type: "object" }, { type: "null" }] } as const

const goalOutput = {
  type: "object",
  properties: { goal },
  required: ["goal"],
  additionalProperties: false,
} as const

const action = {
  anyOf: [
    {
      type: "object",
      properties: { _tag: { enum: ["Pause", "Resume", "Clear", "EditRequested"] } },
      required: ["_tag"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: { _tag: { const: "Edit" }, objective: { type: "string", minLength: 1 } },
      required: ["_tag", "objective"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: { _tag: { const: "Budget" }, tokenBudget: { anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }] } },
      required: ["_tag", "tokenBudget"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: { _tag: { const: "Verify" }, verify: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] } },
      required: ["_tag", "verify"],
      additionalProperties: false,
    },
  ],
} as const

export const GoalRpc = Rpc.define({
  id: "goal",
  methods: {
    get: {
      input: {
        type: "object",
        properties: { sessionID: { type: "string" } },
        required: ["sessionID"],
        additionalProperties: false,
      },
      output: goalOutput,
    },
    apply: {
      input: {
        type: "object",
        properties: { sessionID: { type: "string" }, action },
        required: ["sessionID", "action"],
        additionalProperties: false,
      },
      output: goalOutput,
    },
  },
  events: {
    changed: {
      schema: {
        type: "object",
        properties: { sessionID: { type: "string" }, goal },
        required: ["sessionID", "goal"],
        additionalProperties: false,
      },
    },
    editRequested: {
      schema: {
        type: "object",
        properties: { sessionID: { type: "string" }, objective: { type: "string" } },
        required: ["sessionID", "objective"],
        additionalProperties: false,
      },
    },
  },
})
