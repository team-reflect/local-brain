import { z } from 'zod'

/** Supported BYOK cloud providers. */
export const aiProviderIdSchema = z.enum(['openai', 'anthropic', 'google'])

export type AiProviderId = z.infer<typeof aiProviderIdSchema>

type NonEmptyArray<T> = [T, ...T[]]

/** One selectable model in a provider's curated list. */
export interface AiModelOption {
  id: string
  label: string
  contextWindow: number
}

/** Static provider catalog used by settings and model resolution. */
export interface AiProviderInfo {
  id: AiProviderId
  label: string
  keyPlaceholder: string
  models: NonEmptyArray<AiModelOption>
}

export const AI_PROVIDERS: NonEmptyArray<AiProviderInfo> = [
  {
    id: 'openai',
    label: 'OpenAI',
    keyPlaceholder: 'sk-...',
    models: [
      { id: 'gpt-5.5', label: 'GPT-5.5', contextWindow: 1_000_000 },
      { id: 'gpt-5.4', label: 'GPT-5.4', contextWindow: 1_000_000 },
      { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini', contextWindow: 400_000 },
      { id: 'gpt-5.4-nano', label: 'GPT-5.4 nano', contextWindow: 400_000 },
    ],
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    keyPlaceholder: 'sk-ant-...',
    models: [
      { id: 'claude-fable-5', label: 'Claude Fable 5', contextWindow: 1_000_000 },
      { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', contextWindow: 1_000_000 },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', contextWindow: 1_000_000 },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', contextWindow: 200_000 },
    ],
  },
  {
    id: 'google',
    label: 'Google Gemini',
    keyPlaceholder: 'AIza...',
    models: [
      { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', contextWindow: 1_000_000 },
      { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', contextWindow: 1_000_000 },
      { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite', contextWindow: 1_000_000 },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', contextWindow: 1_000_000 },
    ],
  },
]

export function aiProvider(id: AiProviderId): AiProviderInfo {
  const provider = AI_PROVIDERS.find((candidate) => candidate.id === id)
  if (!provider) throw new Error(`unknown AI provider: ${id}`)
  return provider
}

export function aiModelLabel(provider: AiProviderId, modelId: string): string {
  return aiProvider(provider).models.find((model) => model.id === modelId)?.label ?? modelId
}

export const DEFAULT_CONTEXT_WINDOW = 128_000

export function modelContextWindow(provider: AiProviderId, modelId: string): number {
  return (
    aiProvider(provider).models.find((model) => model.id === modelId)?.contextWindow ??
    DEFAULT_CONTEXT_WINDOW
  )
}
