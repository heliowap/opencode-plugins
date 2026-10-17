import { Rpc } from "@opencode/schema/rpc"

const goal = { anyOf: [{ type: "object" }, { type: "null" }] } as const

const goalOutput = {
  type: "object",
  properties: { goal },
  required: ["goal"],
  additionalProperties: false,
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
    edit: {
      input: {
        type: "object",
        properties: { sessionID: { type: "string" }, objective: { type: "string", minLength: 1 } },
        required: ["sessionID", "objective"],
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
