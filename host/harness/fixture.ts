export interface ChatMessage {
  readonly role: string
  readonly content?: unknown
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
  | { readonly status: number; readonly error: string }

export type Script = (call: Call) => Reply

export const text = (message: ChatMessage) =>
  typeof message.content === "string"
    ? message.content
    : Array.isArray(message.content)
      ? message.content.map((part: { text?: string }) => part.text ?? "").join("")
      : ""

export const isTitleRequest = (request: ChatRequest) => !request.tools?.length

export const toolResults = (request: ChatRequest) => request.messages.filter((message) => message.role === "tool").map(text)

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
      const n = calls.length
      const body =
        "tool" in reply
          ? chunk(n, { role: "assistant", tool_calls: [{ index: 0, id: `call-${n}`, type: "function", function: { name: reply.tool, arguments: JSON.stringify(reply.args) } }] }, null) +
            chunk(n, {}, "tool_calls")
          : chunk(n, { role: "assistant", content: reply.text }, null) + chunk(n, {}, "stop")
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
