import type { ModelCompletion, ModelProvider, ModelRequest } from '../provider'

export interface GoogleOptions {
  apiKey: string
  model: string
  fetchImpl?: typeof fetch
  baseUrl?: string
}

const DEFAULT_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

interface GoogleResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[]
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
}

function googleRole(role: ModelRequest['messages'][number]['role']): 'user' | 'model' {
  return role === 'assistant' ? 'model' : 'user'
}

export function buildGoogleBody(request: ModelRequest): Record<string, unknown> {
  return {
    systemInstruction: { parts: [{ text: request.system }] },
    contents: request.messages.map((message) => ({
      role: googleRole(message.role),
      parts: [{ text: message.content }],
    })),
    generationConfig: {
      maxOutputTokens: request.maxTokens ?? 1024,
      temperature: request.temperature ?? 0,
    },
  }
}

export function readGoogleText(body: GoogleResponse): string {
  return (body.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? '')
    .join('')
}

export function createGoogleProvider(options: GoogleOptions): ModelProvider {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const baseUrl = options.baseUrl ?? DEFAULT_BASE

  return {
    id: 'google',
    label: 'Google Gemini',
    model: options.model,
    isAvailable: () => options.apiKey.trim().length > 0,
    async generate(request: ModelRequest): Promise<ModelCompletion> {
      if (!fetchImpl) throw new Error('no fetch implementation available')
      const response = await fetchImpl(`${baseUrl}/${options.model}:generateContent`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': options.apiKey,
        },
        body: JSON.stringify(buildGoogleBody(request)),
      })
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error(`google request failed (${response.status}): ${detail.slice(0, 200)}`)
      }
      const body = (await response.json()) as GoogleResponse
      const usage: ModelCompletion['usage'] = {}
      if (typeof body.usageMetadata?.promptTokenCount === 'number') {
        usage.inputTokens = body.usageMetadata.promptTokenCount
      }
      if (typeof body.usageMetadata?.candidatesTokenCount === 'number') {
        usage.outputTokens = body.usageMetadata.candidatesTokenCount
      }
      return { text: readGoogleText(body), model: options.model, usage }
    },
  }
}
