import { Rpc } from "@opencode/plugin/rpc"

const RESULT = {
  anyOf: [
    {
      type: "object",
      properties: { ok: { const: true }, accounts: { type: "array", items: { type: "object" } } },
      required: ["ok", "accounts"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: { ok: { const: false }, error: { type: "string" } },
      required: ["ok", "error"],
      additionalProperties: false,
    },
  ],
}

export const QuotaRpc = Rpc.define({
  id: "cliproxy.quota",
  events: {},
  methods: {
    native: {
      input: { type: "object", additionalProperties: false },
      output: { type: "object", additionalProperties: RESULT },
    },
  },
})
