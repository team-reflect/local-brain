import {
  createAnthropicProvider,
  createModelExtractor,
  installExtractionPipeline,
  keychainGet,
  setModelProvider,
} from '@local-brain/core'

/**
 * Wire the BYOK model boundary for the desktop (Plans 06 + 08).
 *
 * The provider key is read from the OS keychain (`keychain_get`, Plan 08). For
 * local development a `VITE_ANTHROPIC_API_KEY` build-time env var takes
 * precedence as a no-persist escape hatch. With no key, the whole AI surface
 * degrades cleanly (Ask shows "not configured"; the extractor no-ops).
 *
 * The model-backed extractor is registered regardless; it is a safe no-op until
 * a provider exists. Call after the Tauri bridge is installed.
 */
export async function installModel(): Promise<void> {
  installExtractionPipeline(createModelExtractor())

  let key: string | undefined = import.meta.env.VITE_ANTHROPIC_API_KEY
  if (!key) {
    try {
      key = (await keychainGet('anthropic')) ?? undefined
    } catch {
      // The keychain (or Tauri bridge) may be unavailable in dev/browser; degrade.
    }
  }
  if (key && key.trim().length > 0) {
    setModelProvider(createAnthropicProvider({ apiKey: key.trim() }))
  }
}

/** Re-read the key from the keychain and (de)register the provider live. */
export async function refreshModelProvider(): Promise<void> {
  try {
    const key = (await keychainGet('anthropic')) ?? import.meta.env.VITE_ANTHROPIC_API_KEY
    setModelProvider(key && key.trim() ? createAnthropicProvider({ apiKey: key.trim() }) : null)
  } catch {
    setModelProvider(null)
  }
}
