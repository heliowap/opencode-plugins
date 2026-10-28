export interface ChatMessage {
  readonly role: string
  readonly content?: unknown
  readonly tool_call_id?: string
  readonly tool_calls?: ReadonlyArray<{ readonly id: string; readonly function: { readonly name: string; readonly arguments: string } }>
}

export interface ChatRequest {
  readonly model: string
  readonly messages: ReadonlyArray<ChatMessage>
  readonly tools?: ReadonlyArray<{ readonly function: { readonly name: string } }>
  readonly [key: string]: unknown
}

export interface Call {
  readonly provider: string
  readonly request: ChatRequest
}

export type Reply =
  | { readonly text: string; readonly delayMs?: number }
  | { readonly tool: string; readonly args: Record<string, unknown> }
  | { readonly tools: ReadonlyArray<{ readonly tool: string; readonly args: Record<string, unknown> }> }
  | { readonly status: number; readonly error: string; readonly delayMs?: number }
  | { readonly malformed: true }

export type Script = (call: Call) => Reply

export const text = (message: ChatMessage) =>
  typeof message.content === "string"
    ? message.content
    : Array.isArray(message.content)
      ? message.content.map((part: { text?: string }) => part.text ?? "").join("")
      : ""

export const isTitleRequest = (request: ChatRequest) => !request.tools?.length

export const toolResults = (request: ChatRequest) => request.messages.filter((message) => message.role === "tool").map(text)

export const FAILED = "Subagent failed"

/**
 * A parent turn that dispatches `first`, then dispatches again every subagent call whose
 * result reports a failure, the way a parent recovers from a provider failure.
 */
export const redispatching =
  (first: ReadonlyArray<Record<string, unknown>>, maxRounds = 3) =>
  (request: ChatRequest): Reply => {
    const rounds = request.messages.filter((message) => message.role === "assistant" && message.tool_calls?.length)
    const last = rounds.at(-1)
    if (!last) return { tools: first.map((args) => ({ tool: "subagent", args })) }
    const failed = last.tool_calls!.filter((call) => {
      const result = request.messages.find((message) => message.role === "tool" && message.tool_call_id === call.id)
      return result !== undefined && text(result).includes(FAILED)
    })
    if (failed.length === 0 || rounds.length >= maxRounds) return { text: "parent done" }
    return { tools: failed.map((call) => ({ tool: "subagent", args: JSON.parse(call.function.arguments) })) }
  }

const chunk = (id: number, delta: object, finish: string | null) =>
  `data: ${JSON.stringify({
    id: `fixture-${id}`,
    object: "chat.completion.chunk",
    created: 1,
    model: "fixture",
    choices: [{ index: 0, delta, finish_reason: finish }],
    ...(finish && { usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } }),
  })}\n\n`

export interface Fixture {
  readonly baseURL: (provider: string) => string
  readonly calls: Call[]
  readonly agentCalls: (provider?: string) => Call[]
  script: Script
  readonly stop: () => void
}

export const startFixture = (script: Script): Fixture => {
  const calls: Call[] = []
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const match = new URL(req.url).pathname.match(/^\/([^/]+)\/v1\/chat\/completions$/)
      if (!match) return new Response("not found", { status: 404 })
      const call = { provider: match[1]!, request: (await req.json()) as ChatRequest }
      calls.push(call)
      const reply: Reply = isTitleRequest(call.request) ? { text: "Fixture title" } : fixture.script(call)
      if ("delayMs" in reply && reply.delayMs) await Bun.sleep(reply.delayMs)
      if ("status" in reply) return Response.json({ error: { message: reply.error, type: "fixture_error" } }, { status: reply.status })
      if ("malformed" in reply) return new Response("data: {not json\n\n", { headers: { "content-type": "text/event-stream" } })
      const n = calls.length
      const toolCalls = "tool" in reply ? [reply] : "tools" in reply ? reply.tools : undefined
      const body = toolCalls
        ? chunk(
            n,
            {
              role: "assistant",
              tool_calls: toolCalls.map((call, index) => ({
                index,
                id: `call-${n}-${index}`,
                type: "function",
                function: { name: call.tool, arguments: JSON.stringify(call.args) },
              })),
            },
            null,
          ) + chunk(n, {}, "tool_calls")
        : chunk(n, { role: "assistant", content: (reply as { text: string }).text }, null) + chunk(n, {}, "stop")
      return new Response(body + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } })
    },
  })
  const fixture: Fixture = {
    baseURL: (provider) => `http://127.0.0.1:${server.port}/${provider}/v1`,
    calls,
    agentCalls: (provider) => calls.filter((call) => !isTitleRequest(call.request) && (!provider || call.provider === provider)),
    script,
    stop: () => server.stop(true),
  }
  return fixture
}
