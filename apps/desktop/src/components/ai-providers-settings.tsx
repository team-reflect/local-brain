import { useMemo, useState, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { cn } from '../lib/utils'
import {
  useAddAiProvider,
  useMakeDefaultAiProvider,
  useModelSettings,
  useRemoveAiProvider,
  useSetModelEnabled,
} from '../lib/queries'
import { AddAiProviderDialog } from './add-ai-provider-dialog'
import { AiProviderRow } from './ai-provider-row'
import { Button } from './button'
import { Section } from './section'

/**
 * Reflect-style Settings → AI providers: configured BYOK providers as simple
 * rows, plus a modal add flow. Provider/model config lives in settings; API keys
 * live only in the OS keychain.
 */
export function AiProvidersSettings(): ReactNode {
  const settings = useModelSettings()
  const setEnabled = useSetModelEnabled()
  const addProvider = useAddAiProvider()
  const removeProvider = useRemoveAiProvider()
  const makeDefault = useMakeDefaultAiProvider()
  const [adding, setAdding] = useState(false)
  const configured = settings.data?.providers ?? []
  const defaultProvider = useMemo(
    () => configured.find((entry) => entry.id === settings.data?.defaultProviderId) ?? configured[0],
    [configured, settings.data?.defaultProviderId],
  )

  return (
    <Section title="AI providers">
      <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        {configured.length === 0 ? (
          <p className="px-4 py-3.5 text-xs text-muted-foreground">
            No AI providers configured. Add a provider API key to use AI features — keys are stored
            in your OS keychain and calls go directly to the provider.
          </p>
        ) : (
          configured.map((config) => (
            <AiProviderRow
              key={config.id}
              config={config}
              isDefault={config.id === defaultProvider?.id}
              onMakeDefault={(id) => makeDefault.mutate(id)}
              onRemove={(id) => removeProvider.mutateAsync(id)}
            />
          ))
        )}

        <div className="px-4 py-2.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setAdding(true)}
            className="text-primary hover:bg-secondary"
          >
            <Plus aria-hidden className="size-4" strokeWidth={1.75} />
            Add provider
          </Button>
        </div>

        <label
          className={cn(
            'flex items-start justify-between gap-4 px-4 py-3.5 text-sm',
            setEnabled.isPending ? 'opacity-60' : null,
          )}
        >
          <span className="min-w-0">
            <span className="block font-medium text-foreground">Allow external model calls</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Ask and extraction stay off when this is disabled, even if provider keys are saved.
            </span>
          </span>
          <input
            type="checkbox"
            className="mt-0.5 accent-primary"
            checked={settings.data?.enabled ?? true}
            disabled={setEnabled.isPending}
            onChange={(event) => setEnabled.mutate(event.target.checked)}
          />
        </label>
      </div>

      {adding ? (
        <AddAiProviderDialog
          onAdd={(draft) => addProvider.mutateAsync(draft)}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </Section>
  )
}
