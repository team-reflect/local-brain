import { useState, type ReactNode } from 'react'
import { aiProvider, type AiProviderConfig } from '@local-brain/core'
import { sectionLabel } from '../lib/ui'
import { Alert } from './alert'
import { Button } from './button'
import { ModelCombobox } from './model-combobox'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'

export function EditAiProviderDialog({
  config,
  onSave,
  onClose,
}: {
  config: AiProviderConfig
  onSave: (model: string) => Promise<void>
  onClose: () => void
}): ReactNode {
  const provider = aiProvider(config.provider)
  const [model, setModel] = useState(config.model)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function submit(): Promise<void> {
    if (submitting) return
    setSubmitError(null)
    const modelId = model.trim()
    if (!modelId) {
      setSubmitError('Choose a default model.')
      return
    }

    setSubmitting(true)
    try {
      await onSave(modelId)
      onClose()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not save the model.')
    } finally {
      setSubmitting(false)
    }
  }

  function requestClose(): void {
    if (!submitting) onClose()
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : requestClose())}>
      <DialogContent className="w-[24rem]" aria-describedby="edit-ai-provider-description">
        <div className="border-b border-border px-4 py-3">
          <DialogTitle>Edit {provider.label}</DialogTitle>
          <DialogDescription id="edit-ai-provider-description" className="mt-1">
            Change the default model without replacing the stored API key.
          </DialogDescription>
        </div>
        <form
          className="flex flex-col gap-3 px-4 py-3"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="edit-ai-provider-model" className={sectionLabel}>
              Default model
            </label>
            <ModelCombobox
              id="edit-ai-provider-model"
              value={model}
              disabled={submitting}
              models={provider.models}
              onChange={(modelId) => {
                setModel(modelId)
                setSubmitError(null)
              }}
            />
          </div>

          {submitError ? <Alert variant="error">{submitError}</Alert> : null}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" disabled={submitting} onClick={requestClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? 'Saving…' : 'Save model'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
