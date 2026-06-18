import {
  AI_PROVIDERS,
  aiKeySecretName,
  apiKeyHint,
  createConfiguredProvider,
  createModelExtractor,
  defaultAiProvider,
  getModelSettings,
  installExtractionPipeline,
  keychainGet,
  keychainSet,
  setAiProvidersState,
  setModelProvider,
  type AiProviderConfig,
  type AiProviderId,
} from '@local-brain/core'

/**
 * Wire the BYOK model boundary for the desktop (Plans 06 + 08).
 *
 * The default provider is read from settings and its key from the OS keychain.
 * Local development can still use provider-specific VITE_* API key env vars as
 * no-persist escape hatches. With no configured provider/key, Ask degrades
 * cleanly and the extractor no-ops.
 *
 * The model-backed extractor is registered regardless; it is a safe no-op until
 * a provider exists. Call after the Tauri bridge is installed.
 */
/**
 * Resolve the active provider with one precedence shared by startup and live
 * refresh: provider-specific env vars win, then the configured keychain secret.
 */
function envKeyFor(provider: AiProviderId): string | undefined {
  const keys: Record<AiProviderId, string | undefined> = {
    openai: import.meta.env['VITE_OPENAI_API_KEY'],
    anthropic: import.meta.env['VITE_ANTHROPIC_API_KEY'],
    google: import.meta.env['VITE_GOOGLE_API_KEY'],
  }
  const key = keys[provider]?.trim()
  return key ? key : undefined
}

function envOnlyConfig(): { config: AiProviderConfig; key: string } | null {
  for (const provider of AI_PROVIDERS) {
    const key = envKeyFor(provider.id)
    if (key) {
      return {
        key,
        config: {
          id: `env:${provider.id}`,
          provider: provider.id,
          model: provider.models[0].id,
          keyHint: '',
        },
      }
    }
  }
  return null
}

async function legacyAnthropicConfig(): Promise<{ config: AiProviderConfig; key: string } | null> {
  let key: string | null
  try {
    key = await keychainGet('anthropic')
  } catch {
    return null
  }
  if (!key) return null

  const provider = AI_PROVIDERS.find((candidate) => candidate.id === 'anthropic')!
  const config: AiProviderConfig = {
    id: 'legacy:anthropic',
    provider: 'anthropic',
    model: provider.models[0].id,
    keyHint: apiKeyHint(key),
  }

  try {
    await keychainSet(aiKeySecretName(config.id), key)
    await setAiProvidersState([config], config.id)
  } catch {
    // Even if migration cannot persist, keep the legacy key working this session.
  }

  return { config, key }
}

async function resolveProvider(): Promise<{ config: AiProviderConfig; key: string } | null> {
  const settings = await getModelSettings()
  const config = defaultAiProvider({
    providers: settings.providers,
    defaultProviderId: settings.defaultProviderId,
  })
  if (!config) return envOnlyConfig() ?? (await legacyAnthropicConfig())

  const envKey = envKeyFor(config.provider)
  if (envKey) return { config, key: envKey }

  try {
    const key = await keychainGet(aiKeySecretName(config.id))
    return key ? { config, key } : null
  } catch {
    return null
  }
}

function applyProvider(resolved: { config: AiProviderConfig; key: string } | null): void {
  setModelProvider(
    resolved ? createConfiguredProvider(resolved.config, resolved.key.trim(), globalThis.fetch) : null,
  )
}

export async function installModel(): Promise<void> {
  installExtractionPipeline(createModelExtractor())
  applyProvider(await resolveProvider())
}

/** Re-read the key (same precedence as startup) and (de)register the provider live. */
export async function refreshModelProvider(): Promise<void> {
  applyProvider(await resolveProvider())
}
