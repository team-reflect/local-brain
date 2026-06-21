import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModel } from 'ai'
import {
  aiKeySecretName,
  defaultAiProvider,
  getModelSettings,
  keychainGet,
  type AiProviderConfig,
} from '@local-brain/core'

export function languageModelFor(config: AiProviderConfig, apiKey: string): LanguageModel {
  switch (config.provider) {
    case 'openai':
      return createOpenAI({ apiKey })(config.model)
    case 'anthropic':
      return createAnthropic({
        apiKey,
        headers: { 'anthropic-dangerous-direct-browser-access': 'true' },
      })(config.model)
    case 'google':
      return createGoogleGenerativeAI({ apiKey })(config.model)
  }
  const unreachable: never = config.provider
  return unreachable
}

export async function resolveLanguageModel(): Promise<{ model: LanguageModel; label: string }> {
  const settings = await getModelSettings()
  const config = defaultAiProvider({
    providers: settings.providers,
    defaultProviderId: settings.defaultProviderId,
  })
  if (!config) throw new Error('No AI provider is configured. Add one in Settings.')

  const apiKey = await keychainGet(aiKeySecretName(config.id))
  if (!apiKey) throw new Error('The selected AI provider has no usable key. Add one in Settings.')

  return {
    model: languageModelFor(config, apiKey),
    label: `${config.provider}/${config.model}`,
  }
}
