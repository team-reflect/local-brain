import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  AI_PROVIDERS,
  aiProvider,
  validateApiKey,
  type AiProviderId,
} from '@local-brain/core'
import { controlClass, sectionLabel } from '../lib/ui'
import type { NewAiProvider } from '../lib/queries'
import { Alert } from './alert'
import { Button } from './button'
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
  const [unverified, setUnverified] = useState(false)
  const providerRef = useRef<HTMLSelectElement>(null)

  useEffect(() => {
    const opener = document.activeElement
    providerRef.current?.focus()
    return () => {
      if (opener instanceof HTMLElement) opener.focus()
    }
  }, [])

  function changeProvider(next: AiProviderId): void {
    const nextProvider = aiProvider(next)
    setProvider(next)
    setModel(nextProvider.models[0].id)
    setSubmitError(null)
    setUnverified(false)
  }

  async function submit(): Promise<void> {
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
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-foreground/25 pt-[12vh] backdrop-blur-[1px]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-ai-provider-title"
        className="flex w-[24rem] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-[0_8px_28px_rgba(2,6,23,0.16)]"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose()
        }}
      >
        <div className="border-b border-border px-4 py-3">
          <h3 id="add-ai-provider-title" className="text-sm font-semibold text-foreground">
            Add AI provider
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            The API key is stored in your OS keychain, never in your brain.
          </p>
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
            <select
              ref={providerRef}
              value={provider}
              onChange={(event) => changeProvider(event.target.value as AiProviderId)}
              className={controlClass}
            >
              {AI_PROVIDERS.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className={sectionLabel}>Default model</span>
            <ModelCombobox
              id="ai-provider-model"
              value={model}
              models={selectedProvider.models}
              onChange={(modelId) => {
                setModel(modelId)
                setSubmitError(null)
              }}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className={sectionLabel}>API key</span>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              onChange={(event) => {
                setApiKey(event.target.value)
                setSubmitError(null)
                setUnverified(false)
              }}
              placeholder={selectedProvider.keyPlaceholder}
              className={`${controlClass} font-mono text-xs`}
            />
          </label>

          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              className="accent-primary"
              checked={isDefault}
              onChange={(event) => setIsDefault(event.target.checked)}
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
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              {unverified ? 'Save anyway' : 'Add provider'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
