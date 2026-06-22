import {
  useEffect,
  useRef,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { ArrowUp } from 'lucide-react'
import {
  aiModelLabel,
  aiProvider,
  defaultAiProvider,
  type AiProviderConfig,
  type AiProvidersState,
} from '@local-brain/core'
import { Button } from '../button'
import { NativeSelect } from '../ui/native-select'
import type { LanguageModelSelection } from '../../lib/ai/provider'

export interface ChatModelOption {
  configId: string
  groupLabel: string
  label: string
  modelId: string
  value: string
}

function modelValue(configId: string, modelId: string): string {
  return `${encodeURIComponent(configId)}:${encodeURIComponent(modelId)}`
}

function providerGroupLabel(config: AiProviderConfig, providers: readonly AiProviderConfig[]): string {
  const providerLabel = aiProvider(config.provider).label
  const duplicated = providers.filter((entry) => entry.provider === config.provider).length > 1
  return duplicated && config.keyHint ? `${providerLabel} (${config.keyHint})` : providerLabel
}

export function buildChatModelOptions(settings: AiProvidersState | undefined): ChatModelOption[] {
  if (!settings) return []

  return settings.providers.flatMap((config) => {
    const provider = aiProvider(config.provider)
    const configuredModel = provider.models.some((model) => model.id === config.model)
      ? []
      : [{ id: config.model, label: aiModelLabel(config.provider, config.model) }]

    return [...configuredModel, ...provider.models].map((model) => ({
      configId: config.id,
      groupLabel: providerGroupLabel(config, settings.providers),
      label: model.label,
      modelId: model.id,
      value: modelValue(config.id, model.id),
    }))
  })
}

export function defaultModelValue(
  settings: AiProvidersState | undefined,
  options: readonly ChatModelOption[],
): string | null {
  if (!settings || options.length === 0) return null
  const configured = defaultAiProvider(settings)
  if (!configured) return options[0]?.value ?? null
  return (
    options.find((option) => option.configId === configured.id && option.modelId === configured.model)?.value ??
    options.find((option) => option.configId === configured.id)?.value ??
    options[0]?.value ??
    null
  )
}

export function modelSelectionForValue(
  options: readonly ChatModelOption[],
  value: string | null,
): LanguageModelSelection | null {
  const option = options.find((candidate) => candidate.value === value)
  return option ? { configId: option.configId, modelId: option.modelId } : null
}

export function ChatComposer({
  draft,
  modelOptions,
  pending,
  selectedModelValue,
  setDraft,
  setSelectedModelValue,
  onSubmit,
}: {
  draft: string
  modelOptions: readonly ChatModelOption[]
  pending: boolean
  selectedModelValue: string | null
  setDraft: (draft: string) => void
  setSelectedModelValue: (value: string) => void
  onSubmit: (event: FormEvent) => Promise<void>
}): ReactNode {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    textarea.style.height = 'auto'
    textarea.style.height = `${textarea.scrollHeight}px`
  }, [draft])

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  const optionGroups = modelOptions.reduce<ChatModelOption[][]>((groups, option) => {
    const last = groups[groups.length - 1]
    if (last?.[0]?.configId === option.configId) {
      last.push(option)
      return groups
    }
    return [...groups, [option]]
  }, [])

  const empty = draft.trim().length === 0
  return (
    <form onSubmit={onSubmit} className="flex-none px-6 pt-4 pb-6">
      <div className="mx-auto w-full max-w-2xl rounded-xl border border-border bg-card focus-within:border-ring">
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          autoFocus
          aria-label="Chat message"
          data-slot="textarea"
          className="field-sizing-content max-h-48 min-h-16 w-full resize-none overflow-y-auto bg-transparent px-3.5 pt-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        <div className="flex items-center gap-2 px-2.5 pb-2.5">
          {modelOptions.length > 0 ? (
            <NativeSelect
              aria-label="Model"
              value={selectedModelValue ?? ''}
              disabled={pending}
              onChange={(event) => setSelectedModelValue(event.target.value)}
              className="h-7 w-auto max-w-64 border-none bg-transparent py-1 pr-7 pl-1 text-xs text-muted-foreground shadow-none focus:border-transparent focus:ring-0"
            >
              {optionGroups.map((group) => (
                <optgroup key={group[0]?.configId} label={group[0]?.groupLabel}>
                  {group.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </NativeSelect>
          ) : null}
          <div className="flex-1" />
          <Button
            type="submit"
            variant="primary"
            disabled={empty || pending}
            aria-label="Send"
            className="size-8 rounded-md px-0"
          >
            <ArrowUp aria-hidden className="size-4" />
          </Button>
        </div>
      </div>
    </form>
  )
}
