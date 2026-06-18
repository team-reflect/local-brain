import type { ModelCompletion, ModelProvider, ModelRequest } from '../provider'

/**
 * A concrete BYOK {@link ModelProvider} for Anthropic's Messages API. It is
 * constructed with an API key and a `fetch` implementation, so it stays testable
 * (inject a fake fetch) and host-agnostic (the desktop passes the platform
 * `fetch`; the CLI passes its own). The key itself comes from the OS keychain
 * (desktop, Plan 08) or an environment variable (CLI, Plan 07) — never from a
 * settings row.
 */

export interface AnthropicOptions {
  apiKey: string
  model?: string
  fetchImpl?: typeof fetch
  baseUrl?: string
  apiVersion?: string
}

const DEFAULT_MODEL = 'claude-sonnet-4-6'
const DEFAULT_BASE = 'https://api.anthropic.com/v1/messages'
const DEFAULT_VERSION = '2023-06-01'

interface AnthropicResponse {
  content?: { type: string; text?: string }[]
  model?: string
  usage?: { input_tokens?: number; output_tokens?: number }
}

/** Shape an Anthropic Messages request body from our provider-neutral request. */
export function buildAnthropicBody(request: ModelRequest, model: string): Record<string, unknown> {
  return {
    model,
    max_tokens: request.maxTokens ?? 1024,
    temperature: request.temperature ?? 0,
    system: request.system,
    messages: request.messages.map((message) => ({ role: message.role, content: message.content })),
  }
}

/** Extract the concatenated text from an Anthropic response body. */
export function readAnthropicText(body: AnthropicResponse): string {
  return (body.content ?? [])
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')
}

export function createAnthropicProvider(options: AnthropicOptions): ModelProvider {
  const model = options.model ?? DEFAULT_MODEL
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const baseUrl = options.baseUrl ?? DEFAULT_BASE
  const apiVersion = options.apiVersion ?? DEFAULT_VERSION

  return {
    id: 'anthropic',
    label: 'Anthropic',
    model,
    isAvailable: () => options.apiKey.trim().length > 0,
    async generate(request: ModelRequest): Promise<ModelCompletion> {
      if (!fetchImpl) throw new Error('no fetch implementation available')
      const response = await fetchImpl(baseUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': options.apiKey,
          'anthropic-version': apiVersion,
        },
        body: JSON.stringify(buildAnthropicBody(request, model)),
      })
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error(`anthropic request failed (${response.status}): ${detail.slice(0, 200)}`)
      }
      const body = (await response.json()) as AnthropicResponse
      const usage: ModelCompletion['usage'] = {}
      if (typeof body.usage?.input_tokens === 'number') usage.inputTokens = body.usage.input_tokens
      if (typeof body.usage?.output_tokens === 'number') usage.outputTokens = body.usage.output_tokens
      return {
        text: readAnthropicText(body),
        model: body.model ?? model,
        usage,
      }
    },
  }
}
