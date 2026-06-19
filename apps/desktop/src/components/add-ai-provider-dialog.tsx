import { useState, type ReactNode } from 'react'
import {
  AI_PROVIDERS,
  aiProvider,
  validateApiKey,
  type AiProviderId,
} from '@local-brain/core'
import { sectionLabel } from '../lib/ui'
import type { NewAiProvider } from '../lib/queries'
import { Alert } from './alert'
import { Button } from './button'
import { Checkbox } from './ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { NativeSelect } from './ui/native-select'
import { ModelCombobox } from './model-combobox'

export function AddAiProviderDialog({
  onAdd,
  onClose,
}: {
  onAdd: (draft: NewAiProvider) => Promise<void>
  onClose: () => void
}): ReactNode {
  const [provider, setProvider] = useState<AiProviderId>(AI_PROVIDERS[0].id)
  const selectedProvider = aiProvider(provider)
  const [model, setModel] = useState(selectedProvider.models[0].id)
  const [apiKey, setApiKey] = useState('')
  const [isDefault, setIsDefault] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [unverified, setUnverified] = useState(false)

  function changeProvider(next: AiProviderId): void {
    const nextProvider = aiProvider(next)
    setProvider(next)
    setModel(nextProvider.models[0].id)
    setSubmitError(null)
    setUnverified(false)
  }

  async function submit(): Promise<void> {
    if (submitting) return
    setSubmitError(null)
    const key = apiKey.trim()
    const modelId = model.trim()
    if (!key) {
      setSubmitError('Enter an API key.')
      return
    }
    if (!modelId) {
      setSubmitError('Choose a default model.')
      return
    }

    setSubmitting(true)
    try {
      if (!unverified) {
        const validation = await validateApiKey(provider, key)
        if (validation === 'invalid') {
          setSubmitError(`${selectedProvider.label} rejected this API key.`)
          return
        }
        if (validation === 'unreachable') {
          setUnverified(true)
          return
        }
      }
      await onAdd({ provider, model: modelId, apiKey: key, isDefault })
      onClose()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not save the provider.')
    } finally {
      setSubmitting(false)
    }
  }

  function requestClose(): void {
    if (!submitting) onClose()
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : requestClose())}>
      <DialogContent className="w-[24rem]" aria-describedby="add-ai-provider-description">
        <div className="border-b border-border px-4 py-3">
          <DialogTitle>Add AI provider</DialogTitle>
          <DialogDescription id="add-ai-provider-description" className="mt-1">
            The API key is stored in your OS keychain, never in your brain.
          </DialogDescription>
        </div>
        <form
          className="flex flex-col gap-3 px-4 py-3"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <label className="flex flex-col gap-1">
            <span className={sectionLabel}>Provider</span>
            <NativeSelect
              value={provider}
              disabled={submitting}
              onChange={(event) => changeProvider(event.target.value as AiProviderId)}
            >
              {AI_PROVIDERS.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.label}
                </option>
              ))}
            </NativeSelect>
          </label>

          <label className="flex flex-col gap-1">
            <span className={sectionLabel}>Default model</span>
            <ModelCombobox
              id="ai-provider-model"
              value={model}
              disabled={submitting}
              models={selectedProvider.models}
              onChange={(modelId) => {
                setModel(modelId)
                setSubmitError(null)
              }}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className={sectionLabel}>API key</span>
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              disabled={submitting}
              onChange={(event) => {
                setApiKey(event.target.value)
                setSubmitError(null)
                setUnverified(false)
              }}
              placeholder={selectedProvider.keyPlaceholder}
              className="font-mono text-xs"
            />
          </label>

          <label className="flex items-center gap-2 text-sm text-foreground">
            <Checkbox
              checked={isDefault}
              disabled={submitting}
              onCheckedChange={(checked) => setIsDefault(checked === true)}
            />
            Use as the default provider
          </label>

          {submitError ? <Alert variant="error">{submitError}</Alert> : null}
          {unverified ? (
            <Alert variant="warning">
              Couldn't reach {selectedProvider.label} to verify the key. Submit again to save it
              unverified.
            </Alert>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" disabled={submitting} onClick={requestClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? 'Saving…' : unverified ? 'Save anyway' : 'Add provider'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
