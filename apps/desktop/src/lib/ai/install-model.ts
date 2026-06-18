import {
  createAnthropicProvider,
  createModelExtractor,
  installExtractionPipeline,
  setModelProvider,
} from '@local-brain/core'

/**
 * Wire the BYOK model boundary for the desktop (Plan 06).
 *
 * The provider key lives in the OS keychain (Plan 08 wires that read path). For
 * local development and demos, a `VITE_ANTHROPIC_API_KEY` build-time env var is
 * honored as an escape hatch — nothing is persisted, and when no key is present
 * the whole AI surface degrades cleanly (Ask shows "not configured", and the
 * model-backed extractor is a safe no-op).
 *
 * It also installs the model-backed extractor onto the ingest queue, so newly
 * captured documents/interactions are extracted when a provider is available.
 */
export function installModel(): void {
  const key = import.meta.env.VITE_ANTHROPIC_API_KEY
  if (typeof key === 'string' && key.trim().length > 0) {
    setModelProvider(createAnthropicProvider({ apiKey: key.trim() }))
  }
  // Register the extractor seam regardless; it no-ops until a provider exists.
  installExtractionPipeline(createModelExtractor())
}
