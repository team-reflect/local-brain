import { MODEL_ENABLED_KEY } from '../../ai/boundary'
import { aiProviderIdSchema, type AiProviderId } from '../../ai/provider-catalog'
import { defaultAiProvider, type AiProvidersState } from '../../ai/provider-config'
import { db } from '../../db/client'
import { batch } from '../../db/commands'
import { nowIso } from '../../db/time'
import { getSetting } from './getters'
import { setSetting } from './setters'
import { z } from 'zod'

/**
 * Typed model-boundary configuration stored in the `settings` table. This is the
 * non-secret config (kill-switch, selected provider/model); the provider *key*
 * lives only in the OS keychain (see `ipc/storage.ts`).
 */

export const MODEL_PROVIDER_KEY = 'model.provider'
export const MODEL_MODEL_KEY = 'model.model'
export const MODEL_AI_PROVIDERS_KEY = 'model.aiProviders'
export const MODEL_DEFAULT_AI_PROVIDER_KEY = 'model.defaultAiProviderId'

export const aiProviderConfigSchema = z.object({
  id: z.string().min(1),
  provider: aiProviderIdSchema,
  model: z.string().min(1),
  keyHint: z.string().catch(''),
})

export type AiProviderConfig = z.infer<typeof aiProviderConfigSchema>

export const aiProvidersSchema = z
  .array(z.unknown())
  .catch([])
  .transform((entries) =>
    entries.flatMap((entry) => {
      const parsed = aiProviderConfigSchema.safeParse(entry)
      return parsed.success ? [parsed.data] : []
    }),
  )

export const defaultAiProviderIdSchema = z.string().nullable().catch(null)

export interface ModelSettings {
  /** External-calls kill switch. */
  enabled: boolean
  /** Configured providers. API keys live in the OS keychain, not here. */
  providers: AiProviderConfig[]
  /** The configured provider id AI features use by default. */
  defaultProviderId: string | null
  /** Resolved default provider id, kept for older call sites and diagnostics. */
  provider: AiProviderId | null
  /** Resolved default model id, kept for older call sites and diagnostics. */
  model: string | null
}

export async function getModelSettings(): Promise<ModelSettings> {
  const [enabled, rawProviders, defaultProviderId] = await Promise.all([
    getSetting<boolean>(MODEL_ENABLED_KEY, true),
    getSetting<unknown[]>(MODEL_AI_PROVIDERS_KEY, []),
    getSetting<string | null>(MODEL_DEFAULT_AI_PROVIDER_KEY, null),
  ])
  const providers = aiProvidersSchema.parse(rawProviders)
  const defaultId = defaultAiProviderIdSchema.parse(defaultProviderId)
  const resolved = defaultAiProvider({ providers, defaultProviderId: defaultId })
  return {
    enabled,
    providers,
    defaultProviderId: defaultId,
    provider: resolved?.provider ?? null,
    model: resolved?.model ?? null,
  }
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

function normalizeAiProvidersState(state: AiProvidersState): AiProvidersState {
  return {
    providers: state.providers,
    defaultProviderId: defaultAiProvider(state)?.id ?? null,
  }
}

function setSettingQuery(key: string, value: unknown, updatedAt: string) {
  const valueJson = JSON.stringify(value ?? null)
  return db
    .insertInto('settings')
    .values({ key, valueJson, updatedAt })
    .onConflict((oc) => oc.column('key').doUpdateSet({ valueJson, updatedAt }))
}

export async function setAiProvidersState(
  providers: AiProviderConfig[],
  defaultProviderId: string | null,
): Promise<void> {
  const next = normalizeAiProvidersState({ providers, defaultProviderId })
  const updatedAt = nowIso()
  await batch([
    setSettingQuery(MODEL_AI_PROVIDERS_KEY, next.providers, updatedAt),
    setSettingQuery(MODEL_DEFAULT_AI_PROVIDER_KEY, next.defaultProviderId, updatedAt),
  ])
}

type AiProvidersUpdater = (
  state: AiProvidersState,
) => AiProvidersState | Promise<AiProvidersState>

let aiProvidersUpdateQueue: Promise<void> = Promise.resolve()

export function updateAiProvidersState(updater: AiProvidersUpdater): Promise<AiProvidersState> {
  const run = aiProvidersUpdateQueue
    .catch(() => undefined)
    .then(async () => {
      const settings = await getModelSettings()
      const next = normalizeAiProvidersState(
        await updater({
          providers: settings.providers,
          defaultProviderId: settings.defaultProviderId,
        }),
      )
      await setAiProvidersState(next.providers, next.defaultProviderId)
      return next
    })
  aiProvidersUpdateQueue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}
