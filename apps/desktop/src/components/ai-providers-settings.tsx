import { useMemo, useState, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import type { AiProviderConfig } from '@local-brain/core'
import {
  useAddAiProvider,
  useMakeDefaultAiProvider,
  useModelSettings,
  useRemoveAiProvider,
  useUpdateAiProviderModel,
} from '../lib/queries'
import { AddAiProviderDialog } from './add-ai-provider-dialog'
import { AiProviderRow } from './ai-provider-row'
import { Button } from './button'
import { EditAiProviderDialog } from './edit-ai-provider-dialog'
import { SettingsSection } from './settings/section'

/**
 * Reflect-style Settings → AI providers: configured BYOK providers as simple
 * rows, plus a modal add flow. Provider/model config lives in settings; API keys
 * live only in the OS keychain.
 */
export function AiProvidersSettings(): ReactNode {
  const settings = useModelSettings()
  const addProvider = useAddAiProvider()
  const removeProvider = useRemoveAiProvider()
  const makeDefault = useMakeDefaultAiProvider()
  const updateProviderModel = useUpdateAiProviderModel()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<AiProviderConfig | null>(null)
  const configured = settings.data?.providers ?? []
  const defaultProvider = useMemo(
    () => configured.find((entry) => entry.id === settings.data?.defaultProviderId) ?? configured[0],
    [configured, settings.data?.defaultProviderId],
  )

  return (
    <>
      <SettingsSection id="ai-providers">
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
              onEdit={setEditing}
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
      </SettingsSection>

      {adding ? (
        <AddAiProviderDialog
          onAdd={(draft) => addProvider.mutateAsync(draft)}
          onClose={() => setAdding(false)}
        />
      ) : null}
      {editing ? (
        <EditAiProviderDialog
          config={editing}
          onSave={(model) => updateProviderModel.mutateAsync({ id: editing.id, model })}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  )
}
