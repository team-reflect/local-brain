import type { ReactNode } from 'react'
import type { AiModelOption } from '@local-brain/core'
import { Input } from './ui/input'

/**
 * Reflect-style model picker: choose from the curated provider list, while still
 * allowing a manually typed model id when a provider ships something new.
 */
export function ModelCombobox({
  id,
  value,
  models,
  onChange,
  disabled = false,
}: {
  id: string
  value: string
  models: readonly AiModelOption[]
  onChange: (value: string) => void
  disabled?: boolean
}): ReactNode {
  const listId = `${id}-options`
  return (
    <>
      <Input
        id={id}
        list={listId}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="font-mono text-xs"
      />
      <datalist id={listId}>
        {models.map((model) => (
          <option key={model.id} value={model.id}>
            {model.label}
          </option>
        ))}
      </datalist>
    </>
  )
}
