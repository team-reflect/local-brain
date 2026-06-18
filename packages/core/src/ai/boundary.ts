import { getSetting } from '../domains/settings/getters'
import { getModelProvider } from './provider'

/**
 * The checked model boundary. Before any external-model call, callers consult
 * {@link getModelStatus} so the UI and CLI can show exactly why Ask can or
 * cannot run, and so a disabled boundary is a hard gate rather than a hope.
 *
 * Two independent conditions must both hold:
 *  - a provider is registered and reports itself available (a key is present);
 *  - external model calls are enabled in settings (the user kill-switch).
 */

export const MODEL_ENABLED_KEY = 'model.enabledExternal'

export interface ModelStatus {
  /** Settings kill-switch: are external model calls allowed at all? */
  enabled: boolean
  providerId: string | null
  model: string | null
  /** A provider is registered and reports a usable credential. */
  configured: boolean
  /** Both gates pass — Ask/extraction can call the model. */
  canRun: boolean
  /** Human-readable explanation, primarily when `canRun` is false. */
  reason: string
}

export async function getModelStatus(): Promise<ModelStatus> {
  const enabled = await getSetting<boolean>(MODEL_ENABLED_KEY, true)
  const provider = getModelProvider()
  const configured = provider ? Boolean(await provider.isAvailable()) : false
  const canRun = enabled && configured

  let reason = 'Ready.'
  if (!provider) reason = 'No AI provider is configured. Add one in Settings → AI providers.'
  else if (!configured) reason = `The ${provider.label} provider has no usable key. Add one in Settings → AI providers.`
  else if (!enabled) reason = 'External model calls are turned off in Settings → AI providers.'

  return {
    enabled,
    providerId: provider?.id ?? null,
    model: provider?.model ?? null,
    configured,
    canRun,
    reason,
  }
}

/** Throw a typed-ish error when the boundary is closed; callers catch to degrade. */
export class ModelUnavailableError extends Error {
  constructor(public readonly status: ModelStatus) {
    super(status.reason)
    this.name = 'ModelUnavailableError'
  }
}
