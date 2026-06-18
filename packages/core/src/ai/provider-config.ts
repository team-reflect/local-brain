import type { AiProviderConfig } from '../domains/settings/model'

/**
 * Pure transforms over configured AI providers. The API keys are intentionally
 * absent: entries live in settings, secrets live in the OS keychain.
 */

export interface AiProvidersState {
  providers: AiProviderConfig[]
  defaultProviderId: string | null
}

export const KEY_HINT_LENGTH = 5

export function apiKeyHint(key: string): string {
  return key.length >= KEY_HINT_LENGTH * 2 ? key.slice(-KEY_HINT_LENGTH) : ''
}

export function aiKeySecretName(configId: string): string {
  return `ai-api-key:${configId}`
}

export function withAiProviderAdded(
  state: AiProvidersState,
  entry: AiProviderConfig,
  makeDefault: boolean,
): AiProvidersState {
  return {
    providers: [...state.providers, entry],
    defaultProviderId:
      makeDefault || state.providers.length === 0 ? entry.id : state.defaultProviderId,
  }
}

export function withAiProviderRemoved(state: AiProvidersState, id: string): AiProvidersState {
  const providers = state.providers.filter((provider) => provider.id !== id)
  return {
    providers,
    defaultProviderId:
      state.defaultProviderId === id ? (providers[0]?.id ?? null) : state.defaultProviderId,
  }
}

export function defaultAiProvider(state: AiProvidersState): AiProviderConfig | null {
  return (
    state.providers.find((provider) => provider.id === state.defaultProviderId) ??
    state.providers[0] ??
    null
  )
}
