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

export interface LanguageModelSelection {
  configId: string
  modelId: string
}

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

function configuredProvider(
  settings: Awaited<ReturnType<typeof getModelSettings>>,
  selection: LanguageModelSelection | null | undefined,
): AiProviderConfig | null {
  if (!selection) {
    return defaultAiProvider({
      providers: settings.providers,
      defaultProviderId: settings.defaultProviderId,
    })
  }

  const selected = settings.providers.find((provider) => provider.id === selection.configId)
  if (!selected) {
    return defaultAiProvider({
      providers: settings.providers,
      defaultProviderId: settings.defaultProviderId,
    })
  }

  return { ...selected, model: selection.modelId }
}

export async function resolveLanguageModel(
  selection?: LanguageModelSelection | null,
): Promise<{ model: LanguageModel; label: string }> {
  const settings = await getModelSettings()
  const config = configuredProvider(settings, selection)
  if (!config) throw new Error('No AI provider is configured. Add one in Settings.')

  const apiKey = await keychainGet(aiKeySecretName(config.id))
  if (!apiKey) throw new Error('The selected AI provider has no usable key. Add one in Settings.')

  return {
    model: languageModelFor(config, apiKey),
    label: `${config.provider}/${config.model}`,
  }
}
