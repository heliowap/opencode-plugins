export interface ChatMessage {
  readonly role: string
  readonly content?: unknown
  readonly tool_calls?: ReadonlyArray<{ readonly function: { readonly name: string; readonly arguments: string } }>
}

export interface ChatRequest {
  readonly messages: ReadonlyArray<ChatMessage>
  readonly tools?: ReadonlyArray<{ readonly function: { readonly name: string } }>
}

interface Timing {
  readonly delayMs?: number
}

export type Reply = Timing &
  (
    | { readonly text: string; readonly usage?: Usage }
    | { readonly tool: string; readonly args: Record<string, unknown>; readonly usage?: Usage }
    | { readonly empty: true; readonly usage?: Usage }
    | { readonly status: number; readonly error: string }
  )

export interface Usage {
  readonly input: number
  readonly output: number
}

export type Script = (request: ChatRequest) => Reply

export const CONTINUATION = "Continue working toward the active session goal."
export const BUDGET_LIMIT = "The active session goal has reached its token budget."
export const OBJECTIVE_UPDATED = "The active session goal objective was edited by the user."

const DEFAULT_USAGE: Usage = { input: 100, output: 20 }

export const text = (message: ChatMessage) =>
  typeof message.content === "string"
    ? message.content
    : Array.isArray(message.content)
      ? message.content.map((part: { text?: string }) => part.text ?? "").join("")
      : ""

export const isTitleRequest = (request: ChatRequest) => !request.tools?.length

export const afterToolResult = (request: ChatRequest) => request.messages.at(-1)?.role === "tool"

export const count = (request: ChatRequest, marker: string) =>
  request.messages.filter((message) => message.role !== "assistant" && text(message).includes(marker)).length

export const mentions = (request: ChatRequest, marker: string) => count(request, marker) > 0

export const toolResults = (request: ChatRequest) => request.messages.filter((message) => message.role === "tool").map(text)

export const toolNames = (request: ChatRequest) => request.tools?.map((tool) => tool.function.name) ?? []

const chunk = (id: number, delta: object, finish: string | null, usage?: Usage) =>
  `data: ${JSON.stringify({
    id: `fixture-${id}`,
    object: "chat.completion.chunk",
    created: 1,
    model: "fixture",
    choices: [{ index: 0, delta, finish_reason: finish }],
    ...(usage && { usage: { prompt_tokens: usage.input, completion_tokens: usage.output, total_tokens: usage.input + usage.output } }),
  })}\n\n`

export interface Fixture {
  readonly url: string
  readonly requests: ChatRequest[]
  readonly agentRequests: () => ChatRequest[]
  script: Script
  readonly stop: () => void
}

export const startFixture = (script: Script): Fixture => {
  const requests: ChatRequest[] = []
  const fixture: Fixture = {
    url: "",
    requests,
    agentRequests: () => requests.filter((request) => !isTitleRequest(request)),
    script,
    stop: () => server.stop(true),
  }
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      if (!new URL(req.url).pathname.endsWith("/chat/completions")) return new Response("not found", { status: 404 })
      const request = (await req.json()) as ChatRequest
      requests.push(request)
      const reply: Reply = isTitleRequest(request) ? { text: "Fixture title" } : fixture.script(request)
      if (reply.delayMs) await Bun.sleep(reply.delayMs)
      if ("status" in reply) return Response.json({ error: { message: reply.error, type: "invalid_request_error" } }, { status: reply.status })
      const usage = reply.usage ?? DEFAULT_USAGE
      const n = requests.length
      const body =
        "tool" in reply
          ? chunk(n, { role: "assistant", tool_calls: [{ index: 0, id: `call-${n}`, type: "function", function: { name: reply.tool, arguments: JSON.stringify(reply.args) } }] }, null) +
            chunk(n, {}, "tool_calls", usage)
          : chunk(n, { role: "assistant", content: "empty" in reply ? "" : reply.text }, null) + chunk(n, {}, "stop", usage)
      return new Response(body + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } })
    },
  })
  return Object.assign(fixture, { url: `http://127.0.0.1:${server.port}/v1` })
}
