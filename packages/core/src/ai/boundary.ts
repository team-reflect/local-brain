import { getModelProvider } from './provider'

/**
 * The checked model boundary. Before any external-model call, callers consult
 * {@link getModelStatus} so the UI can show exactly why extraction can or
 * cannot run.
 *
 * A provider must be registered and report itself available (a key is present).
 */

export interface ModelStatus {
  providerId: string | null
  model: string | null
  /** A provider is registered and reports a usable credential. */
  configured: boolean
  /** Extraction can call the model. */
  canRun: boolean
  /** Human-readable explanation, primarily when `canRun` is false. */
  reason: string
}

export async function getModelStatus(): Promise<ModelStatus> {
  const provider = getModelProvider()
  const configured = provider ? Boolean(await provider.isAvailable()) : false

  let reason = 'Ready.'
  if (!provider) reason = 'No AI provider is configured. Add one in Settings → AI providers.'
  else if (!configured) reason = `The ${provider.label} provider has no usable key. Add one in Settings → AI providers.`

  return {
    providerId: provider?.id ?? null,
    model: provider?.model ?? null,
    configured,
    canRun: configured,
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
