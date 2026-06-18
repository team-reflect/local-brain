import type { AiProviderConfig } from '../../domains/settings/model'
import type { ModelProvider } from '../provider'
import { createAnthropicProvider } from './anthropic'
import { createGoogleProvider } from './google'
import { createOpenAiProvider } from './openai'

export function createConfiguredProvider(
  config: AiProviderConfig,
  apiKey: string,
  fetchImpl?: typeof fetch,
): ModelProvider {
  const fetchOption = fetchImpl ? { fetchImpl } : {}
  switch (config.provider) {
    case 'openai':
      return createOpenAiProvider({ apiKey, model: config.model, ...fetchOption })
    case 'anthropic':
      return createAnthropicProvider({ apiKey, model: config.model, ...fetchOption })
    case 'google':
      return createGoogleProvider({ apiKey, model: config.model, ...fetchOption })
  }
}
