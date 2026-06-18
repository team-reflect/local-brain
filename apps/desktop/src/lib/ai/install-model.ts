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
/**
 * Resolve the active provider key with one precedence shared by startup and live
 * refresh: the `VITE_ANTHROPIC_API_KEY` dev escape hatch wins, then the OS
 * keychain. If the keychain (or Tauri bridge) is unavailable we still fall back
 * to the env override rather than dropping it, so the two entry points always
 * register the same provider for the same inputs.
 */
async function resolveProviderKey(): Promise<string | undefined> {
  const envKey = import.meta.env.VITE_ANTHROPIC_API_KEY
  if (envKey && envKey.trim().length > 0) return envKey
  try {
    return (await keychainGet('anthropic')) ?? undefined
  } catch {
    // The keychain (or Tauri bridge) may be unavailable in dev/browser; degrade.
    return envKey
  }
}

/** (De)register the Anthropic provider from a resolved key. */
function applyProviderKey(key: string | undefined): void {
  setModelProvider(key && key.trim() ? createAnthropicProvider({ apiKey: key.trim() }) : null)
}

export async function installModel(): Promise<void> {
  installExtractionPipeline(createModelExtractor())
  applyProviderKey(await resolveProviderKey())
}

/** Re-read the key (same precedence as startup) and (de)register the provider live. */
export async function refreshModelProvider(): Promise<void> {
  applyProviderKey(await resolveProviderKey())
}
