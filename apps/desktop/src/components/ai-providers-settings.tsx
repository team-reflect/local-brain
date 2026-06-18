import { useMemo, useState, type ReactNode } from 'react'
import {
  AI_PROVIDERS,
  aiModelLabel,
  aiProvider,
  validateApiKey,
  type AiProviderId,
} from '@local-brain/core'
import { cn } from '../lib/utils'
import {
  useAddAiProvider,
  useMakeDefaultAiProvider,
  useModelSettings,
  useModelStatus,
  useRemoveAiProvider,
  useSetModelEnabled,
} from '../lib/queries'
import { Section } from './section'

export function AiProvidersSettings(): ReactNode {
  const status = useModelStatus()
  const settings = useModelSettings()
  const setEnabled = useSetModelEnabled()
  const addProvider = useAddAiProvider()
  const removeProvider = useRemoveAiProvider()
  const makeDefault = useMakeDefaultAiProvider()
  const [provider, setProvider] = useState<AiProviderId>(AI_PROVIDERS[0].id)
  const selectedProvider = aiProvider(provider)
  const [model, setModel] = useState(selectedProvider.models[0].id)
  const [apiKey, setApiKey] = useState('')
  const [isDefault, setIsDefault] = useState(false)
  const [message, setMessage] = useState<{ tone: 'error' | 'warning'; text: string } | null>(null)
  const data = status.data
  const configured = settings.data?.providers ?? []
  const defaultProvider = useMemo(
    () => configured.find((entry) => entry.id === settings.data?.defaultProviderId) ?? configured[0],
    [configured, settings.data?.defaultProviderId],
  )

  function changeProvider(next: AiProviderId): void {
    const nextProvider = aiProvider(next)
    setProvider(next)
    setModel(nextProvider.models[0].id)
    setMessage(null)
  }

  async function submit(allowUnverified = false): Promise<void> {
    const key = apiKey.trim()
    const modelId = model.trim()
    if (!key || !modelId) {
      setMessage({ tone: 'error', text: 'Enter an API key and model.' })
      return
    }

    if (!allowUnverified) {
      const validation = await validateApiKey(provider, key)
      if (validation === 'invalid') {
        setMessage({ tone: 'error', text: `${selectedProvider.label} rejected this API key.` })
        return
      }
      if (validation === 'unreachable') {
        setMessage({
          tone: 'warning',
          text: `Couldn't reach ${selectedProvider.label} to verify the key. Save again to keep it unverified.`,
        })
        return
      }
    }

    try {
      await addProvider.mutateAsync({ provider, model: modelId, apiKey: key, isDefault })
      setApiKey('')
      setIsDefault(false)
      setMessage(null)
    } catch (error) {
      setMessage({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Could not save the provider.',
      })
    }
  }

  return (
    <Section title="AI providers">
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-muted-foreground">
          Ask and model-backed extraction call providers using your own API keys. Provider
          choices and default models are stored in settings; API keys stay in the OS keychain.
        </p>

        {configured.length === 0 ? (
          <div className="rounded-md border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
            No AI providers configured. Add a provider API key to use Ask and extraction.
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border border-border bg-card">
            {configured.map((entry) => {
              const isDefaultEntry = entry.id === defaultProvider?.id
              const label = `${aiProvider(entry.provider).label} - ${aiModelLabel(entry.provider, entry.model)}`
              return (
                <div
                  key={entry.id}
                  className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 last:border-b-0"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{label}</div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      API key <span className="font-mono">.....{entry.keyHint || 'stored'}</span>
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {isDefaultEntry ? (
                      <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-accent-foreground">
                        Default
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={makeDefault.isPending}
                        onClick={() => makeDefault.mutate(entry.id)}
                        className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                      >
                        Make default
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={removeProvider.isPending}
                      onClick={() => removeProvider.mutate(entry.id)}
                      className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <div className="rounded-md border border-border bg-card px-4 py-3">
          <h3 className="mb-3 text-sm font-medium text-foreground">Add provider</h3>
          <div className="grid gap-3 md:grid-cols-[10rem_minmax(0,1fr)]">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Provider</span>
              <select
                value={provider}
                onChange={(event) => changeProvider(event.target.value as AiProviderId)}
                className="h-8 rounded-md border border-border bg-background px-2 text-sm"
              >
                {AI_PROVIDERS.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Default model</span>
              <input
                list="ai-provider-models"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                className="h-8 rounded-md border border-border bg-background px-2 font-mono text-xs"
              />
              <datalist id="ai-provider-models">
                {selectedProvider.models.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </datalist>
            </label>
            <label className="flex flex-col gap-1 md:col-span-2">
              <span className="text-xs font-medium text-muted-foreground">API key</span>
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={apiKey}
                onChange={(event) => {
                  setApiKey(event.target.value)
                  setMessage(null)
                }}
                placeholder={selectedProvider.keyPlaceholder}
                className="h-8 rounded-md border border-border bg-background px-2 font-mono text-xs"
              />
            </label>
          </div>

          <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(event) => setIsDefault(event.target.checked)}
            />
            Use as the default provider
          </label>

          {message ? (
            <div
              className={cn(
                'mt-3 rounded-md border px-3 py-2 text-xs',
                message.tone === 'error'
                  ? 'border-destructive/40 bg-destructive/5 text-destructive'
                  : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
              )}
            >
              {message.text}
            </div>
          ) : null}

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              disabled={addProvider.isPending || !apiKey.trim() || !model.trim()}
              onClick={() => {
                void submit(message?.tone === 'warning')
              }}
              className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-40"
            >
              {message?.tone === 'warning' ? 'Save anyway' : 'Add provider'}
            </button>
          </div>
        </div>

        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={settings.data?.enabled ?? true}
            onChange={(event) => setEnabled.mutate(event.target.checked)}
          />
          Allow external model calls (master kill switch)
        </label>

        <div className="rounded-md border border-border bg-card px-4 py-3">
          {data ? (
            <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-xs">
              <dt className="text-muted-foreground">Key stored</dt>
              <dd className="font-mono text-foreground">
                {configured.length > 0 ? 'yes (keychain)' : 'no'}
              </dd>
              <dt className="text-muted-foreground">External calls</dt>
              <dd className="font-mono text-foreground">{data.enabled ? 'enabled' : 'disabled'}</dd>
              <dt className="text-muted-foreground">Provider</dt>
              <dd className="font-mono text-foreground">{data.providerId ?? '-'}</dd>
              <dt className="text-muted-foreground">Model</dt>
              <dd className="font-mono text-foreground">{data.model ?? '-'}</dd>
              <dt className="text-muted-foreground">Status</dt>
              <dd
                className={cn(
                  'font-mono',
                  data.canRun
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-amber-600 dark:text-amber-400',
                )}
              >
                {data.canRun ? 'ready' : 'not ready'}
              </dd>
              <dt className="text-muted-foreground">Detail</dt>
              <dd className="text-foreground">{data.reason}</dd>
            </dl>
          ) : (
            <span className="text-muted-foreground">Checking model status...</span>
          )}
        </div>
      </div>
    </Section>
  )
}
