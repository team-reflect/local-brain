import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { wrapLanguageModel, type LanguageModel } from 'ai'
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

/** Creates a provider model with request settings supported by the selected model. */
export function languageModelFor(
  config: AiProviderConfig,
  apiKey: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): LanguageModel {
  switch (config.provider) {
    case 'openai': {
      const model = createOpenAI({ apiKey, fetch: fetchImpl })(config.model)
      if (config.model !== 'gpt-6-astra') return model

      // This SDK predates Astra. Mark it as reasoning and reserve room for thinking
      // as well as visible output, including short title and briefing requests.
      return wrapLanguageModel({
        model,
        middleware: {
          specificationVersion: 'v3',
          transformParams: async ({ params }) => {
            const settings = {
              ...params,
              maxOutputTokens: Math.max(params.maxOutputTokens ?? 0, 25_000),
              providerOptions: {
                ...params.providerOptions,
                openai: { ...params.providerOptions?.['openai'], forceReasoning: true },
              },
            }
            delete settings.temperature
            delete settings.topP
            return settings
          },
        },
      })
    }
    case 'anthropic':
      return createAnthropic({
        apiKey,
        fetch: fetchImpl,
        headers: { 'anthropic-dangerous-direct-browser-access': 'true' },
      })(config.model)
    case 'google':
      return createGoogleGenerativeAI({ apiKey, fetch: fetchImpl })(config.model)
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
