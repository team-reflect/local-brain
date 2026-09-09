import type { ModelCompletion, ModelProvider, ModelRequest } from '../provider'

export interface OpenAiOptions {
  apiKey: string
  model: string
  fetchImpl?: typeof fetch
  baseUrl?: string
}

const DEFAULT_BASE = 'https://api.openai.com/v1/chat/completions'

interface OpenAiResponse {
  choices?: { message?: { content?: string } }[]
  model?: string
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

/** Build a Chat Completions request with model-compatible sampling and token limits. */
export function buildOpenAiBody(request: ModelRequest, model: string): Record<string, unknown> {
  const maxTokens = request.maxTokens ?? 1024
  return {
    model,
    messages: [
      { role: 'system', content: request.system },
      ...request.messages.map((message) => ({ role: message.role, content: message.content })),
    ],
    ...(model === 'gpt-6-astra'
      ? {
          // OpenAI recommends an initial 25k allowance for reasoning plus visible output.
          max_completion_tokens: Math.max(maxTokens, 25_000),
        }
      : { max_tokens: maxTokens, temperature: request.temperature ?? 0 }),
  }
}

export function createOpenAiProvider(options: OpenAiOptions): ModelProvider {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const baseUrl = options.baseUrl ?? DEFAULT_BASE

  return {
    id: 'openai',
    label: 'OpenAI',
    model: options.model,
    isAvailable: () => options.apiKey.trim().length > 0,
    async generate(request: ModelRequest): Promise<ModelCompletion> {
      if (!fetchImpl) throw new Error('no fetch implementation available')
      const response = await fetchImpl(baseUrl, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(buildOpenAiBody(request, options.model)),
      })
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error(`openai request failed (${response.status}): ${detail.slice(0, 200)}`)
      }
      const body = (await response.json()) as OpenAiResponse
      const usage: ModelCompletion['usage'] = {}
      if (typeof body.usage?.prompt_tokens === 'number') usage.inputTokens = body.usage.prompt_tokens
      if (typeof body.usage?.completion_tokens === 'number') {
        usage.outputTokens = body.usage.completion_tokens
      }
      return {
        text: body.choices?.[0]?.message?.content ?? '',
        model: body.model ?? options.model,
        usage,
      }
    },
  }
}
