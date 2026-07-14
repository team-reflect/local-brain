import { useState, type ReactNode } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { aiModelLabel, aiProvider, type AiProviderConfig } from '@local-brain/core'
import { Alert } from './alert'
import { Badge } from './badge'
import { Button } from './button'

export function AiProviderRow({
  config,
  isDefault,
  onEdit,
  onMakeDefault,
  onRemove,
}: {
  config: AiProviderConfig
  isDefault: boolean
  onEdit: (config: AiProviderConfig) => void
  onMakeDefault: (id: string) => void
  onRemove: (id: string) => Promise<void>
}): ReactNode {
  const [error, setError] = useState<string | null>(null)
  const providerLabel = aiProvider(config.provider).label
  const modelLabel = aiModelLabel(config.provider, config.model)
  const name = `${providerLabel} — ${modelLabel}`
  const keyIdentity = config.keyHint ? `API key ending ${config.keyHint}` : 'stored API key'

  async function remove(): Promise<void> {
    setError(null)
    try {
      await onRemove(config.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not remove ${name}.`)
    }
  }

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">{name}</div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            API key <span className="font-mono">·····{config.keyHint || 'stored'}</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isDefault ? (
            <Badge tone="accent">Default</Badge>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onMakeDefault(config.id)}
              className="text-muted-foreground"
            >
              Make default
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Edit model for ${name}, ${keyIdentity}`}
            onClick={() => onEdit(config)}
            className="size-7 px-0 text-muted-foreground"
          >
            <Pencil aria-hidden className="size-4" strokeWidth={1.75} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Remove ${name}`}
            onClick={() => void remove()}
            className="size-7 px-0 text-muted-foreground"
          >
            <Trash2 aria-hidden className="size-4" strokeWidth={1.75} />
          </Button>
        </div>
      </div>
      {error ? <Alert variant="error" className="mt-3">{error}</Alert> : null}
    </div>
  )
}
