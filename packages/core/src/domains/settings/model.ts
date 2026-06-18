import { MODEL_ENABLED_KEY } from '../../ai/boundary'
import { getSetting } from './getters'
import { setSetting } from './setters'

/**
 * Typed model-boundary configuration stored in the `settings` table. This is the
 * non-secret config (kill-switch, selected provider/model); the provider *key*
 * lives only in the OS keychain (see `ipc/storage.ts`).
 */

export const MODEL_PROVIDER_KEY = 'model.provider'
export const MODEL_MODEL_KEY = 'model.model'

export interface ModelSettings {
  /** External-calls kill switch. */
  enabled: boolean
  /** Selected provider id (e.g. `anthropic`), or null for the default. */
  provider: string | null
  /** Selected model id, or null for the provider default. */
  model: string | null
}

export async function getModelSettings(): Promise<ModelSettings> {
  const [enabled, provider, model] = await Promise.all([
    getSetting<boolean>(MODEL_ENABLED_KEY, true),
    getSetting<string | null>(MODEL_PROVIDER_KEY, null),
    getSetting<string | null>(MODEL_MODEL_KEY, null),
  ])
  return { enabled, provider, model }
}

export function setModelEnabled(enabled: boolean): Promise<void> {
  return setSetting(MODEL_ENABLED_KEY, enabled)
}

export function setModelProviderSetting(provider: string | null): Promise<void> {
  return setSetting(MODEL_PROVIDER_KEY, provider)
}

export function setModelModelSetting(model: string | null): Promise<void> {
  return setSetting(MODEL_MODEL_KEY, model)
}
